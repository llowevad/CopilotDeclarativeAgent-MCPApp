declare module "../../../../shared/condition.mjs" {
  import type { Answers, AnswerValue, Condition, EdgeDef } from "./types";

  export function isAnswerPresent(value: AnswerValue | undefined | null): boolean;
  export function deepEqual(left: unknown, right: unknown): boolean;
  export function evaluateCondition(condition: Condition, answers?: Answers, options?: { triStateUnknown?: boolean; includeUnknown?: boolean }): boolean | undefined;
  export function conditionCanMatch(condition: Condition, answers?: Answers, options?: { triStateUnknown?: boolean; includeUnknown?: boolean }): boolean;
  export function resolveMatchingEdges(edges: EdgeDef[], answers?: Answers, options?: { triStateUnknown?: boolean; includeUnknown?: boolean }): EdgeDef[];
}
