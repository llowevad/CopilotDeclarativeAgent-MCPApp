export type AnswerValue = string | number | boolean | string[];

export interface Money {
  currency: string;
  min: number;
  max: number;
}

export interface ApplicationWindow {
  opens: string;
  deadline: string;
  timezone: string;
}

export interface RecommendationSignals {
  keywords: string[];
  goodFit: string[];
  poorFit: string[];
}

export interface Fund {
  id: string;
  displayName: string;
  shortSummary: string;
  category: string;
  sector: string;
  audience: string[];
  fundingRange: Money;
  applicationWindow: ApplicationWindow;
  questionGraphId: string;
  eligibilityRuleSetId: string;
  programGuideUrl?: string;
  recommendationSignals: RecommendationSignals;
}

export interface EvaluationGuidance {
  reviewPriorities: string;
  borderlineHandling: string;
  definitions: string;
  communicationEmphasis: string;
}

export type AnswerType = "single-select" | "multi-select" | "boolean" | "number" | "currency" | "date";

export interface QuestionOption {
  value: string;
  label: string;
  helpText?: string;
}

export type Condition =
  | { always: boolean }
  | { answer: string; exists: boolean }
  | { answer: string; equals: unknown }
  | { answer: string; notEquals: unknown }
  | { answer: string; in: unknown[] }
  | { answer: string; includesAny: unknown[] }
  | { answer: string; includesAll: unknown[] }
  | { answer: string; operator: "lt" | "lte" | "gt" | "gte"; value: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface EdgeTarget {
  type: "question" | "terminal";
  id: string;
}

export interface Edge {
  id: string;
  label?: string;
  condition: Condition;
  target: EdgeTarget;
}

export interface QuestionValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minDate?: string;
  maxDate?: string;
}

export interface Question {
  id: string;
  prompt: string;
  helpText: string;
  answerType: AnswerType;
  required: boolean;
  options?: QuestionOption[];
  validation?: QuestionValidation;
  edges: Edge[];
}

export interface Terminal {
  id: string;
  status: "ready-for-confirmation";
  title: string;
  message: string;
}

export interface QuestionGraph {
  id: string;
  entryQuestionId: string;
  progress: {
    strategy: "current-path-estimate";
    unit: "question";
    displayHint?: string;
  };
  questions: Question[];
  terminals: Terminal[];
}

export interface EligibilityRule {
  id: string;
  criterion: string;
  appliesWhen?: Condition;
  condition: Condition;
  severity: "hard-disqualifier" | "soft-advisory";
  remediation: string;
}

export interface FundPackage {
  schemaVersion: "1.0.0";
  fund: Fund;
  evaluationGuidance: EvaluationGuidance;
  questionGraph: QuestionGraph;
  eligibilityRules: EligibilityRule[];
}

export interface FundSummary {
  fundId: string;
  name: string;
  shortDescription: string;
  category: string;
  summaryEligibility: string;
  estimatedQuestionCount: number;
  sourceUrl?: string;
}
