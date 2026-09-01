export interface ConditionEvaluationOptions {
  triStateUnknown?: boolean;
  includeUnknown?: boolean;
}

export type ConditionEvaluationResult = boolean | undefined;

export function isAnswerPresent(value: unknown): boolean;
export function deepEqual(left: unknown, right: unknown): boolean;
export function evaluateCondition<Condition, Answers extends Record<string, unknown>>(
  condition: Condition,
  answers?: Answers,
  options?: ConditionEvaluationOptions,
): ConditionEvaluationResult;
export function conditionCanMatch<Condition, Answers extends Record<string, unknown>>(
  condition: Condition,
  answers?: Answers,
  options?: ConditionEvaluationOptions,
): boolean;
export function resolveMatchingEdges<Edge extends { condition: unknown }, Answers extends Record<string, unknown>>(
  edges: Edge[],
  answers?: Answers,
  options?: ConditionEvaluationOptions,
): Edge[];
