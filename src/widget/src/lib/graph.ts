import type { Answers, AnswerValue, Condition, EdgeDef, QuestionDef, SummaryItem } from "./types";
import { evaluateCondition as sharedEvaluateCondition, isAnswerPresent, resolveMatchingEdges } from "../../../../shared/condition.mjs";

export class GraphDefectError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  return sharedEvaluateCondition(condition, answers) === true;
}

export function validateGraph(questions: QuestionDef[], startQuestionId: string, terminalId: string): void {
  const questionIds = new Set(questions.map((q) => q.id));
  if (!questionIds.has(startQuestionId)) throw new GraphDefectError(`Start question not found: ${startQuestionId}`, "GRAPH_START_MISSING");
  for (const question of questions) {
    for (const edge of question.edges) {
      if (edge.target.type === "question" && !questionIds.has(edge.target.id)) {
        throw new GraphDefectError(`Question ${question.id} has edge ${edge.id} to unknown question ${edge.target.id}.`, "GRAPH_TARGET_MISSING");
      }
      if (edge.target.type === "terminal" && edge.target.id !== terminalId) {
        throw new GraphDefectError(`Question ${question.id} has edge ${edge.id} to unknown terminal ${edge.target.id}.`, "GRAPH_TERMINAL_MISSING");
      }
    }
  }
}

export function resolveEdge(question: QuestionDef, answers: Answers): EdgeDef {
  const matches = question.edges.filter((edge) => evaluateCondition(edge.condition, answers));
  if (matches.length !== 1) {
    throw new GraphDefectError(
      `Expected exactly one matching edge from ${question.id}, found ${matches.length}: ${matches.map((e) => e.id).join(", ") || "none"}.`,
      matches.length === 0 ? "GRAPH_NO_MATCHING_EDGE" : "GRAPH_MULTIPLE_MATCHING_EDGES",
    );
  }
  return matches[0];
}

export function computeReachablePath(questions: QuestionDef[], startQuestionId: string, terminalId: string, answers: Answers) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const path: string[] = [];
  let currentId = startQuestionId;
  const seen = new Set<string>();

  while (true) {
    const question = byId.get(currentId);
    if (!question) throw new GraphDefectError(`Unknown question in path: ${currentId}`, "GRAPH_TARGET_MISSING");
    if (seen.has(currentId)) throw new GraphDefectError(`Question graph loop detected at ${currentId}.`, "GRAPH_LOOP");
    seen.add(currentId);
    path.push(currentId);

    if (!isAnswerPresent(answers[currentId])) return { path, terminalReached: false };
    const edge = resolveEdge(question, answers);
    if (edge.target.type === "terminal") {
      if (edge.target.id !== terminalId) throw new GraphDefectError(`Unknown terminal ${edge.target.id}.`, "GRAPH_TERMINAL_MISSING");
      return { path, terminalReached: true };
    }
    currentId = edge.target.id;
  }
}


export function computeReachableQuestionSet(questions: QuestionDef[], startQuestionId: string, terminalId: string, answers: Answers): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const reachable = new Set<string>();

  const visit = (id: string, visiting: Set<string>): void => {
    if (visiting.has(id)) throw new GraphDefectError(`Question graph loop detected at ${id}.`, "GRAPH_LOOP");
    if (reachable.has(id)) return;
    const question = byId.get(id);
    if (!question) throw new GraphDefectError(`Unknown question in reachable set: ${id}`, "GRAPH_TARGET_MISSING");

    reachable.add(id);
    const nextVisiting = new Set(visiting).add(id);
    let edges: EdgeDef[];
    if (isAnswerPresent(answers[id])) {
      try {
        edges = [resolveEdge(question, answers)];
      } catch (error) {
        if (!(error instanceof GraphDefectError) || error.code !== "GRAPH_NO_MATCHING_EDGE") throw error;
        edges = resolveMatchingEdges(question.edges, answers, { triStateUnknown: true, includeUnknown: true });
      }
    } else {
      edges = resolveMatchingEdges(question.edges, answers, { triStateUnknown: true, includeUnknown: true });
    }

    for (const edge of edges) {
      if (edge.target.type === "terminal") {
        if (edge.target.id !== terminalId) throw new GraphDefectError(`Unknown terminal ${edge.target.id}.`, "GRAPH_TERMINAL_MISSING");
      } else {
        visit(edge.target.id, nextVisiting);
      }
    }
  };

  visit(startQuestionId, new Set());
  return reachable;
}

export function pruneAnswersToReachableSet(answers: Answers, reachable: Set<string>) {
  if (!(reachable instanceof Set)) throw new TypeError("pruneAnswersToReachableSet requires a Set of reachable question ids.");
  const kept: Answers = {};
  const pruned: string[] = [];
  for (const [key, value] of Object.entries(answers)) {
    if (reachable.has(key)) kept[key] = value;
    else pruned.push(key);
  }
  return { answers: kept, pruned };
}

export function validateAnswer(question: QuestionDef, value: AnswerValue | undefined): string | null {
  if (question.required && !isAnswerPresent(value)) return "This question is required.";
  if (!isAnswerPresent(value)) return null;
  const validation = question.validation;

  if ((question.answerType === "number" || question.answerType === "currency") && typeof value !== "number") return "Enter a valid number.";
  if (typeof value === "number") {
    if (validation?.min !== undefined && value < validation.min) return `Enter at least ${validation.min}.`;
    if (validation?.max !== undefined && value > validation.max) return `Enter no more than ${validation.max}.`;
  }
  if (typeof value === "string") {
    if (validation?.minLength !== undefined && value.length < validation.minLength) return `Enter at least ${validation.minLength} characters.`;
    if (validation?.maxLength !== undefined && value.length > validation.maxLength) return `Enter no more than ${validation.maxLength} characters.`;
    if (validation?.pattern && !new RegExp(validation.pattern).test(value)) return "Use the required format.";
    if (question.answerType === "date") {
      if (validation?.minDate && value < validation.minDate) return `Choose a date on or after ${validation.minDate}.`;
      if (validation?.maxDate && value > validation.maxDate) return `Choose a date on or before ${validation.maxDate}.`;
    }
  }
  return null;
}

export function formatAnswer(question: QuestionDef, value: AnswerValue, currency = "USD"): string {
  if (question.answerType === "boolean") return value === true ? "Yes" : "No";
  if (question.answerType === "currency" && typeof value === "number") return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  if (question.answerType === "multi-select" && Array.isArray(value)) {
    return value.map((v) => question.options?.find((o) => o.value === v)?.label ?? String(v)).join(", ");
  }
  if (typeof value === "string") return question.options?.find((o) => o.value === value)?.label ?? value;
  return String(value);
}

export function buildSummary(questions: QuestionDef[], path: string[], answers: Answers, currency = "USD"): SummaryItem[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return path
    .map((id) => byId.get(id))
    .filter((q): q is QuestionDef => !!q && isAnswerPresent(answers[q.id]))
    .map((q) => ({ questionId: q.id, question: q.prompt, answer: answers[q.id], answerText: formatAnswer(q, answers[q.id], currency) }));
}

export function shortestRemainingQuestionCount(questions: QuestionDef[], fromQuestionId: string, terminalId: string, answers: Answers): number {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const visit = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    const q = byId.get(id);
    if (!q) return 0;
    const nextSeen = new Set(seen).add(id);
    let targets = q.edges.map((e) => e.target);
    if (isAnswerPresent(answers[id])) {
      try { targets = [resolveEdge(q, answers).target]; } catch (error) {
        console.warn("Could not resolve progress estimate path.", error);
        return 0;
      }
    }
    const distances = targets.map((target) => target.type === "terminal" && target.id === terminalId ? 0 : 1 + visit(target.id, nextSeen));
    return Math.min(...distances);
  };
  return visit(fromQuestionId, new Set());
}
