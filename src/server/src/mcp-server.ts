import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
// @ts-expect-error Shared condition runtime helper is copied into the server package before build.
import { resolveMatchingEdges } from "../shared/condition.mjs";
import { filterValidAnswers, getAllFundPackages, getFundPackage, getFundSummaries, toFundSummary } from "./data.js";
import type { AnswerValue, Condition, EligibilityRule, EvaluationGuidance, FundPackage } from "./types.js";

const QUESTIONNAIRE_URI = "ui://grant-eligibility/questionnaire.html";
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

const answerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
let questionnaireHtml: string | undefined;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "grant-eligibility-mcp-server", version: "1.0.0" });

  server.registerTool(
    "list_funds",
    {
      title: "List grant funds",
      description:
        "Lists available grant or funding programs that the user can explore or apply for. Use this when the user asks what grants, funds, programs, or opportunities are available, or asks which questionnaire they can start.",
      inputSchema: {
        category: z.string().optional().describe("Optional category filter such as education, community, research, or small business. Matches JSON fund categories."),
        search: z.string().max(100).optional().describe("Optional user search text for fund name or description. Do not use for fund-specific logic."),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ category, search }): Promise<CallToolResult> => {
      const normalizedCategory = category?.trim().toLowerCase();
      const normalizedSearch = search?.trim().toLowerCase();
      const funds = getFundSummaries().filter((fund) => {
        const categoryMatches = normalizedCategory ? fund.category.toLowerCase() === normalizedCategory : true;
        const searchMatches = normalizedSearch
          ? `${fund.name} ${fund.shortDescription} ${fund.category}`.toLowerCase().includes(normalizedSearch)
          : true;
        return categoryMatches && searchMatches;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              summary: formatFundList(funds),
              results: funds.map((fund) => ({
                fundId: fund.fundId,
                name: fund.name,
                shortDescription: fund.shortDescription,
                ...(fund.sourceUrl ? { sourceUrl: fund.sourceUrl } : {}),
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_fund_details",
    {
      title: "Get fund details",
      description:
        "Gets browsing details for one grant or funding program, including purpose, a short eligibility summary, expected questionnaire length, and application guidance from JSON. Use this before answering general questions about a specific fund or before helping the user decide whether to start its questionnaire. Do not use this tool for final eligibility assessment.",
      inputSchema: {
        fundId: z.string().min(1).describe("Identifier of the fund to describe. Must match a fundId from list_funds or JSON data."),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ fundId }): Promise<CallToolResult> => {
      const pkg = getFundPackage(fundId);
      if (!pkg) return unknownFundResult(fundId);

      const summary = toFundSummary(pkg);
      const applicationNotes = applicationNotesFor(pkg);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              name: pkg.fund.displayName,
              fundId: pkg.fund.id,
              ...(pkg.fund.programGuideUrl ? { sourceUrl: pkg.fund.programGuideUrl } : {}),
              details: `${pkg.fund.displayName}\nPurpose: ${pkg.fund.shortSummary}\nShort eligibility summary: ${summary.summaryEligibility}\nExpected questionnaire length: ${summary.estimatedQuestionCount} questions.\nApplication notes: ${applicationNotes}\nTo continue, start the questionnaire for ${pkg.fund.id}.`,
            }),
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "start_questionnaire",
    {
      title: "Start eligibility questionnaire",
      description:
        "Opens the interactive MCP App questionnaire for a selected fund. Use this only when the user wants to answer eligibility questions for a specific fund. The tool returns the full generic question graph for the widget; it does not determine final eligibility.",
      inputSchema: {
        fundId: z.string().min(1).describe("Identifier of the fund whose questionnaire should be opened."),
        answers: z
          .record(z.string(), answerValueSchema)
          .optional()
          .describe("Optional prefill answers keyed by questionId, used only when reopening or resuming from known context."),
        startAtQuestionId: z.string().optional().describe("Optional questionId to focus when reopening after edit or recovery. Must be reachable under supplied answers."),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: QUESTIONNAIRE_URI, visibility: ["model", "app"] } },
    },
    async ({ fundId, answers, startAtQuestionId }): Promise<CallToolResult> => {
      const pkg = getFundPackage(fundId);
      if (!pkg) return unknownFundResult(fundId);

      const prefill = filterValidAnswers(pkg, answers as Record<string, AnswerValue> | undefined);
      const knownQuestion = startAtQuestionId ? pkg.questionGraph.questions.some((question) => question.id === startAtQuestionId) : false;
      const reachableQuestion = startAtQuestionId ? getReachableQuestionIds(pkg, prefill.answers).has(startAtQuestionId) : false;
      if (startAtQuestionId && !knownQuestion) {
        prefill.warnings.push({ code: "UNKNOWN_START_QUESTION", questionId: startAtQuestionId, message: `Unknown start question ${startAtQuestionId}; opening at the first question.` });
      } else if (startAtQuestionId && !reachableQuestion) {
        prefill.warnings.push({ code: "UNREACHABLE_START_QUESTION", questionId: startAtQuestionId, message: `Start question ${startAtQuestionId} is not reachable under the supplied answers; opening at the first question.` });
      }
      const startQuestionId = startAtQuestionId && knownQuestion && reachableQuestion ? startAtQuestionId : pkg.questionGraph.entryQuestionId;

      return {
        content: [
          {
            type: "text",
            text: `Questionnaire for ${pkg.fund.displayName} loaded with ${pkg.questionGraph.questions.length} questions. ${
              prefill.warnings.length === 0 ? "No prefill warnings." : `${prefill.warnings.length} prefill warning(s) were found.`
            }`,
          },
        ],
        structuredContent: {
          mode: "questionnaire",
          fund: {
            fundId: pkg.fund.id,
            name: pkg.fund.displayName,
            shortDescription: pkg.fund.shortSummary,
            category: pkg.fund.category,
            fundingRange: pkg.fund.fundingRange,
          },
          questionnaire: {
            version: pkg.schemaVersion,
            startQuestionId,
            questions: pkg.questionGraph.questions,
            terminal: { ...pkg.questionGraph.terminals[0], summary: true },
          },
          prefill,
          display: { title: `${pkg.fund.displayName} questionnaire`, submitLabel: "Confirm answers" },
        },
        _meta: { ui: { resourceUri: QUESTIONNAIRE_URI, visibility: ["model", "app"] } },
      };
    },
  );

  server.registerTool(
    "get_eligibility_criteria",
    {
      title: "Get eligibility criteria",
      description:
        "Returns the selected fund's eligibility criteria and evaluation guidance for agent-side assessment. Call this after the user submits confirmed questionnaire answers and before producing any eligibility outcome. Do not use browsing-time summaries or memory in place of this tool. The result provides the authoritative per-fund criteria, severity, remediation, and evaluationGuidance needed to compare each confirmed answer and explain gaps.",
      inputSchema: {
        fundId: z.string().min(1).describe("Identifier of the fund whose eligibility criteria should be retrieved for assessment. Must match a fundId from list_funds or JSON data."),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ fundId }): Promise<CallToolResult> => {
      const pkg = getFundPackage(fundId);
      if (!pkg) return unknownFundResult(fundId);
      const eligibilityCriteria = pkg.eligibilityRules.map(ruleToCriteria);
      const evaluationGuidance = pkg.evaluationGuidance;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              fundName: pkg.fund.displayName,
              fundId: pkg.fund.id,
              criteriaVersion: pkg.fund.eligibilityRuleSetId,
              ...(pkg.fund.programGuideUrl ? { sourceUrl: pkg.fund.programGuideUrl } : {}),
              criteriaPacket: formatCriteriaPacket(pkg, eligibilityCriteria, evaluationGuidance),
            }),
          },
        ],
      };
    },
  );

  registerAppResource(
    server,
    "Grant Eligibility Questionnaire",
    QUESTIONNAIRE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Interactive grant eligibility questionnaire widget",
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [{ uri: QUESTIONNAIRE_URI, mimeType: RESOURCE_MIME_TYPE, text: await loadQuestionnaireHtml() }],
    }),
  );

  return server;
}

export async function loadQuestionnaireHtml(): Promise<string> {
  if (questionnaireHtml !== undefined) return questionnaireHtml;
  const filePath = path.join(ASSETS_DIR, "questionnaire.html");
  try {
    questionnaireHtml = await fs.readFile(filePath, "utf8");
    console.log(`Loaded questionnaire widget resource from ${filePath}`);
    return questionnaireHtml;
  } catch (error) {
    console.error(`Failed to load questionnaire widget resource from ${filePath}`, error);
    throw error;
  }
}

function formatFundList(funds: ReturnType<typeof getFundSummaries>): string {
  if (funds.length === 0) return "No grant funds matched the current filters. Try again later or broaden the search.";
  const rows = funds.map((fund) => `- ${fund.name} (${fund.fundId}): ${fund.shortDescription}`).join("\n");
  return `${funds.length} grant fund(s) available:\n${rows}\nStart a questionnaire by fund name or fundId.`;
}

function applicationNotesFor(pkg: FundPackage): string {
  const range = pkg.fund.fundingRange;
  return `Applications are open from ${pkg.fund.applicationWindow.opens} through ${pkg.fund.applicationWindow.deadline} (${pkg.fund.applicationWindow.timezone}). Funding range: ${range.currency} ${range.min}-${range.max}.`;
}

function ruleToCriteria(rule: EligibilityRule): {
  id: string;
  criterion: string;
  appliesWhen?: Condition;
  conditionSummary: string;
  severity: EligibilityRule["severity"];
  remediation: string;
} {
  return {
    id: rule.id,
    criterion: rule.criterion,
    ...(rule.appliesWhen ? { appliesWhen: rule.appliesWhen } : {}),
    conditionSummary: JSON.stringify(rule.condition),
    severity: rule.severity,
    remediation: rule.remediation,
  };
}

function formatCriteriaPacket(
  pkg: FundPackage,
  eligibilityCriteria: ReturnType<typeof ruleToCriteria>[],
  evaluationGuidance: EvaluationGuidance,
): string {
  const criteriaText = eligibilityCriteria
    .map((item, index) => {
      const appliesWhen = item.appliesWhen ? `\n  Applies when: ${JSON.stringify(item.appliesWhen)}` : "";
      return `${index + 1}. ${item.id}\n  Criterion: ${item.criterion}${appliesWhen}\n  Condition summary: ${item.conditionSummary}\n  Severity: ${item.severity}\n  Remediation: ${item.remediation}`;
    })
    .join("\n\n");

  return `Authoritative criteria packet for ${pkg.fund.displayName} (${pkg.fund.id})\nCriteria version: ${pkg.fund.eligibilityRuleSetId}\n\nCriteria:\n${criteriaText}\n\nEvaluation guidance:\n- Review priorities: ${evaluationGuidance.reviewPriorities}\n- Borderline handling: ${evaluationGuidance.borderlineHandling}\n- Definitions: ${evaluationGuidance.definitions}\n- Communication emphasis: ${evaluationGuidance.communicationEmphasis}`;
}

function unknownFundResult(fundId: string): CallToolResult {
  const validFunds = getAllFundPackages().map((pkg) => `${pkg.fund.displayName} (${pkg.fund.id})`).join(", ");
  return {
    isError: true,
    content: [{ type: "text", text: `UNKNOWN_FUND: No fund found for "${fundId}". Valid available funds: ${validFunds}.` }],
    structuredContent: { error: { code: "UNKNOWN_FUND", fundId, validFunds: getFundSummaries() } },
  };
}

function getReachableQuestionIds(pkg: FundPackage, answers: Record<string, AnswerValue>): Set<string> {
  const questions = new Map(pkg.questionGraph.questions.map((question) => [question.id, question]));
  const reachable = new Set<string>();

  function visit(questionId: string): void {
    if (reachable.has(questionId)) return;
    reachable.add(questionId);
    const question = questions.get(questionId);
    if (!question) return;
    for (const edge of resolveMatchingEdges(question.edges, answers, { triStateUnknown: true, includeUnknown: true })) {
      if (edge.target.type === "question") visit(edge.target.id);
    }
  }

  visit(pkg.questionGraph.entryQuestionId);
  return reachable;
}
