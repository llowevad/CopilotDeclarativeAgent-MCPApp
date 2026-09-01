import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AnswerValue, Condition, FundPackage, FundSummary, Question, QuestionGraph } from "./types.js";

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ always: z.boolean() }).strict(),
    z.object({ answer: z.string(), exists: z.boolean() }).strict(),
    z.object({ answer: z.string(), equals: z.unknown() }).strict(),
    z.object({ answer: z.string(), notEquals: z.unknown() }).strict(),
    z.object({ answer: z.string(), in: z.array(z.unknown()).min(1) }).strict(),
    z.object({ answer: z.string(), includesAny: z.array(z.unknown()).min(1) }).strict(),
    z.object({ answer: z.string(), includesAll: z.array(z.unknown()).min(1) }).strict(),
    z.object({ answer: z.string(), operator: z.enum(["lt", "lte", "gt", "gte"]), value: z.number() }).strict(),
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

const packageSchema: z.ZodType<FundPackage> = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    fund: z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        displayName: z.string().min(1),
        shortSummary: z.string().min(1),
        category: z.string(),
        sector: z.string(),
        audience: z.array(z.string()).min(1),
        fundingRange: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), min: z.number().min(0), max: z.number().min(0) }).strict(),
        applicationWindow: z.object({ opens: z.string(), deadline: z.string(), timezone: z.string() }).strict(),
        questionGraphId: z.string().regex(/^[a-z][a-z0-9-]*$/),
        eligibilityRuleSetId: z.string().regex(/^[a-z][a-z0-9-]*$/),
        programGuideUrl: z.string().min(1).optional(),
        recommendationSignals: z
          .object({ keywords: z.array(z.string()), goodFit: z.array(z.string()).min(1), poorFit: z.array(z.string()).min(1) })
          .strict(),
      })
      .strict(),
    evaluationGuidance: z
      .object({
        reviewPriorities: z.string().min(1).max(360),
        borderlineHandling: z.string().min(1).max(300),
        definitions: z.string().min(1).max(240),
        communicationEmphasis: z.string().min(1).max(240),
      })
      .strict(),
    questionGraph: z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9-]*$/),
        entryQuestionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
        progress: z.object({ strategy: z.literal("current-path-estimate"), unit: z.literal("question"), displayHint: z.string().optional() }).strict(),
        questions: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z][a-z0-9-]*$/),
                prompt: z.string().min(1),
                helpText: z.string(),
                answerType: z.enum(["single-select", "multi-select", "boolean", "number", "currency", "date"]),
                required: z.boolean(),
                options: z.array(z.object({ value: z.string(), label: z.string(), helpText: z.string().optional() }).strict()).optional(),
                validation: z
                  .object({
                    min: z.number().optional(),
                    max: z.number().optional(),
                    minLength: z.number().int().min(0).optional(),
                    maxLength: z.number().int().min(1).optional(),
                    pattern: z.string().optional(),
                    minDate: z.string().optional(),
                    maxDate: z.string().optional(),
                  })
                  .strict()
                  .optional(),
                edges: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), label: z.string().optional(), condition: conditionSchema, target: z.object({ type: z.enum(["question", "terminal"]), id: z.string().regex(/^[a-z][a-z0-9-]*$/) }).strict() }).strict()).min(1),
              })
              .strict(),
          )
          .min(1),
        terminals: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), status: z.literal("ready-for-confirmation"), title: z.string(), message: z.string() }).strict()).min(1),
      })
      .strict(),
    eligibilityRules: z
      .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), criterion: z.string(), appliesWhen: conditionSchema.optional(), condition: conditionSchema, severity: z.enum(["hard-disqualifier", "soft-advisory"]), remediation: z.string() }).strict())
      .min(1),
  })
  .strict();

let fundPackages: FundPackage[] = [];
let fundsById = new Map<string, FundPackage>();

export function loadFundPackages(): void {
  const defaultDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");
  const dataDir = process.env.FUND_DATA_DIR ? path.resolve(process.env.FUND_DATA_DIR) : defaultDataDir;
  const files = fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith(".json") && file !== "fund-package.schema.json")
    .sort();

  const parsed = files.map((file) => parseFundFile(path.join(dataDir, file)));
  const byId = new Map<string, FundPackage>();
  for (const item of parsed) {
    if (byId.has(item.fund.id)) throw new Error(`Duplicate fund id: ${item.fund.id}`);
    validateGraph(item);
    byId.set(item.fund.id, item);
  }

  fundPackages = parsed;
  fundsById = byId;
  console.log(`Loaded ${fundPackages.length} fund package(s): ${fundPackages.map((item) => item.fund.id).join(", ")}`);
}

function parseFundFile(filePath: string): FundPackage {
  const json = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const result = packageSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid fund package ${path.basename(filePath)}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function validateGraph(pkg: FundPackage): void {
  const graph = pkg.questionGraph;
  if (pkg.fund.questionGraphId !== graph.id) throw new Error(`${pkg.fund.id}: fund.questionGraphId does not match questionGraph.id`);
  if (graph.terminals.length !== 1) throw new Error(`${pkg.fund.id}: questionGraph must have exactly one terminal`);

  const questions = new Map(graph.questions.map((question) => [question.id, question]));
  const terminals = new Set(graph.terminals.map((terminal) => terminal.id));
  if (!questions.has(graph.entryQuestionId)) throw new Error(`${pkg.fund.id}: entryQuestionId is missing`);

  for (const question of graph.questions) {
    for (const edge of question.edges) {
      const found = edge.target.type === "question" ? questions.has(edge.target.id) : terminals.has(edge.target.id);
      if (!found) throw new Error(`${pkg.fund.id}: edge ${edge.id} targets missing ${edge.target.type} ${edge.target.id}`);
    }
  }

  const pathLengths: number[] = [];
  walkPaths(graph.entryQuestionId, graph, questions, new Set<string>(), 0, pathLengths);
  if (pathLengths.length === 0) throw new Error(`${pkg.fund.id}: graph has no path to confirmation terminal`);
  const tooShort = pathLengths.filter((length) => length < 5);
  if (tooShort.length > 0) throw new Error(`${pkg.fund.id}: every path must include at least 5 questions before confirmation`);
}

function walkPaths(questionId: string, graph: QuestionGraph, questions: Map<string, Question>, seen: Set<string>, length: number, pathLengths: number[]): void {
  if (seen.has(questionId)) throw new Error(`${graph.id}: cycle detected at ${questionId}`);
  const question = questions.get(questionId);
  if (!question) throw new Error(`${graph.id}: missing question ${questionId}`);

  const nextSeen = new Set(seen).add(questionId);
  const nextLength = length + 1;
  for (const edge of question.edges) {
    if (edge.target.type === "terminal") pathLengths.push(nextLength);
    else walkPaths(edge.target.id, graph, questions, nextSeen, nextLength, pathLengths);
  }
}

export function getAllFundPackages(): FundPackage[] {
  return fundPackages;
}

export function getFundPackage(fundId: string): FundPackage | undefined {
  return fundsById.get(fundId);
}

export function getFundSummaries(): FundSummary[] {
  return fundPackages.map(toFundSummary);
}

export function toFundSummary(pkg: FundPackage): FundSummary {
  return {
    fundId: pkg.fund.id,
    name: pkg.fund.displayName,
    shortDescription: pkg.fund.shortSummary,
    category: pkg.fund.category,
    summaryEligibility: summarizeEligibility(pkg),
    estimatedQuestionCount: pkg.questionGraph.questions.length,
    ...(pkg.fund.programGuideUrl ? { sourceUrl: pkg.fund.programGuideUrl } : {}),
  };
}

export function filterValidAnswers(pkg: FundPackage, answers: Record<string, AnswerValue> | undefined): {
  answers: Record<string, AnswerValue>;
  warnings: Array<{ code: string; questionId?: string; message: string }>;
} {
  const output: Record<string, AnswerValue> = {};
  const warnings: Array<{ code: string; questionId?: string; message: string }> = [];
  const questions = new Map(pkg.questionGraph.questions.map((question) => [question.id, question]));

  for (const [questionId, value] of Object.entries(answers ?? {})) {
    const question = questions.get(questionId);
    if (!question) {
      warnings.push({ code: "UNKNOWN_QUESTION", questionId, message: `Ignored answer for unknown question ${questionId}.` });
      continue;
    }
    if (!isAnswerTypeValid(question, value)) {
      warnings.push({ code: "INVALID_ANSWER_TYPE", questionId, message: `Ignored answer for ${questionId} because its value type does not match ${question.answerType}.` });
      continue;
    }
    const invalidValues = getInvalidOptionValues(question, value);
    if (invalidValues.length > 0) {
      for (const invalidValue of invalidValues) {
        warnings.push({
          code: "INVALID_ANSWER_VALUE",
          questionId,
          message: `Ignored answer for ${questionId} because ${JSON.stringify(invalidValue)} is not a valid option value.`,
        });
      }
      continue;
    }
    output[questionId] = value;
  }

  return { answers: output, warnings };
}

function isAnswerTypeValid(question: Question, value: AnswerValue): boolean {
  switch (question.answerType) {
    case "single-select":
    case "date":
      return typeof value === "string";
    case "multi-select":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "boolean":
      return typeof value === "boolean";
    case "number":
    case "currency":
      return typeof value === "number";
  }
}

function getInvalidOptionValues(question: Question, value: AnswerValue): string[] {
  if (question.answerType !== "single-select" && question.answerType !== "multi-select") return [];
  const validValues = new Set((question.options ?? []).map((option) => option.value));
  if (question.answerType === "single-select") return typeof value === "string" && !validValues.has(value) ? [value] : [];
  return Array.isArray(value) ? value.filter((item) => !validValues.has(item)) : [];
}

function summarizeEligibility(pkg: FundPackage): string {
  const hardCriteria = pkg.eligibilityRules.filter((rule) => rule.severity === "hard-disqualifier").map((rule) => rule.criterion);
  return hardCriteria.slice(0, 3).join(" ");
}
