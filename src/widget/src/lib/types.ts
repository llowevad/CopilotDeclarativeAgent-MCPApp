export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

export type AnswerType = "single-select" | "multi-select" | "boolean" | "number" | "currency" | "date";

export interface OptionDef {
  value: string;
  label: string;
  helpText?: string;
}

export interface ValidationDef {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minDate?: string;
  maxDate?: string;
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

export interface EdgeDef {
  id: string;
  label?: string;
  condition: Condition;
  target: { type: "question" | "terminal"; id: string };
}

export interface QuestionDef {
  id: string;
  prompt: string;
  helpText: string;
  answerType: AnswerType;
  required: boolean;
  options?: OptionDef[];
  validation?: ValidationDef;
  edges: EdgeDef[];
}

export interface TerminalDef {
  id: string;
  status: "ready-for-confirmation";
  title?: string;
  message?: string;
  summary?: boolean;
}

export interface QuestionnairePayload {
  mode?: "questionnaire";
  fund: { fundId: string; name: string; shortDescription?: string; category?: string; fundingRange?: { currency?: string } };
  questionnaire: {
    version?: string;
    startQuestionId: string;
    questions: QuestionDef[];
    terminal: TerminalDef;
    progress?: { displayHint?: string; strategy?: string; unit?: string };
  };
  prefill?: { answers?: Answers; warnings?: Array<{ code: string; questionId?: string; message: string }> };
  display?: { title?: string; submitLabel?: string };
}

export interface SummaryItem {
  questionId: string;
  question: string;
  answer: AnswerValue;
  answerText: string;
}
