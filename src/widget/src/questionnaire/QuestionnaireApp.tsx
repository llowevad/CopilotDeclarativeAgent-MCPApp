import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Body1,
  Button,
  Card,
  Checkbox,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Subtitle1,
  Text,
  Title3,
} from "@fluentui/react-components";
import { ArrowLeftRegular, CheckmarkCircleRegular, EditRegular } from "@fluentui/react-icons";
import { useMcpApp, useMcpTheme, useMcpToolData } from "../hooks/useMcpApp";
import { getPalette, paletteToCssVars } from "./theme";
import {
  GraphDefectError,
  buildSummary,
  computeReachableQuestionSet,
  computeReachablePath,
  pruneAnswersToReachableSet,
  resolveEdge,
  shortestRemainingQuestionCount,
  validateAnswer,
  validateGraph,
} from "../lib/graph";
import type { AnswerValue, Answers, QuestionDef, QuestionnairePayload, SummaryItem } from "../lib/types";
import "./styles.css";

type Stage = "question" | "summary" | "confirmed";
type UndoState = { answers: Answers; currentId: string; stage: Stage; message: string } | null;
type GraphState =
  | { ok: true; path: string[]; terminalReached: boolean; reachableQuestionIds: Set<string> }
  | { ok: false; code: string; message: string };

function normalizePayload(data: QuestionnairePayload | null): QuestionnairePayload | null {
  if (!data || data.mode !== "questionnaire") return null;
  if (!data.fund || typeof data.fund.fundId !== "string" || typeof data.fund.name !== "string") return null;
  const questionnaire = data.questionnaire;
  if (!questionnaire || typeof questionnaire.startQuestionId !== "string" || !Array.isArray(questionnaire.questions) || questionnaire.questions.length === 0) return null;
  if (!questionnaire.terminal || typeof questionnaire.terminal.id !== "string") return null;
  return data;
}

function computeGraphState(payload: QuestionnairePayload, answers: Answers): GraphState {
  try {
    const { questions, startQuestionId, terminal } = payload.questionnaire;
    validateGraph(questions, startQuestionId, terminal.id);
    const pathState = computeReachablePath(questions, startQuestionId, terminal.id, answers);
    return {
      ok: true,
      ...pathState,
      reachableQuestionIds: computeReachableQuestionSet(questions, startQuestionId, terminal.id, answers),
    };
  } catch (error) {
    const defect = error instanceof GraphDefectError ? error : null;
    return {
      ok: false,
      code: defect?.code ?? "QUESTIONNAIRE_ERROR",
      message: error instanceof Error ? error.message : "The questionnaire could not be rendered.",
    };
  }
}

export function normalizeCurrency(currency: string | undefined): string {
  if (!currency) return "USD";
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(0);
    return currency;
  } catch (error) {
    console.warn(`Unsupported questionnaire currency "${currency}"; falling back to USD.`, error);
    return "USD";
  }
}

export function currencyPrefix(currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export function QuestionnaireApp() {
  const { app, error: appError, theme } = useMcpApp();
  const payload = normalizePayload(useMcpToolData<QuestionnairePayload>());
  const [answers, setAnswers] = useState<Answers>({});
  const [currentId, setCurrentId] = useState<string>("");
  const [stage, setStage] = useState<Stage>("question");
  const [notice, setNotice] = useState<string>("");
  const [undoState, setUndoState] = useState<UndoState>(null);
  const [submitError, setSubmitError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [graphError, setGraphError] = useState<GraphState | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!payload) return;
    const initialAnswers = payload.prefill?.answers ?? {};
    setAnswers(initialAnswers);
    setCurrentId(payload.questionnaire.startQuestionId);
    setStage("question");
    setNotice(payload.prefill?.warnings?.map((w) => w.message).join(" ") ?? "");
    setUndoState(null);
    setSubmitError("");
    setSubmitting(false);
    setGraphError(null);
  }, [payload]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentId, stage]);

  const graphState = useMemo(() => {
    if (!payload) return null;
    return computeGraphState(payload, answers);
  }, [payload, answers]);

  useEffect(() => {
    if (!payload || !app || !graphState?.ok) return;
    const compact = {
      structuredContent: {
        checkpointType: "questionnaire-progress",
        fundId: payload.fund.fundId,
        fundName: payload.fund.name,
        currentQuestionId: stage === "question" ? currentId : undefined,
        answeredQuestionIds: graphState.path.filter((id) => answers[id] !== undefined),
        answers,
      },
    };
    void app.updateModelContext(compact).catch((error) => {
      console.warn("Could not save questionnaire progress checkpoint.", error);
    });
  }, [app, answers, currentId, graphState, payload, stage]);

  if (appError) return <Shell><ErrorState title="Widget connection failed" message="The Copilot host bridge could not initialize. Ask the agent to reopen the questionnaire." /></Shell>;
  if (!payload) return <Shell><RecoveryState app={app} /></Shell>;
  const activeGraphError = graphError && !graphError.ok ? graphError : graphState && !graphState.ok ? graphState : null;
  if (activeGraphError) return <Shell><RecoveryState app={app} title={activeGraphError.code} message={activeGraphError.message} /></Shell>;

  const { questions, terminal } = payload.questionnaire;
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const path = graphState?.ok ? graphState.path : [payload.questionnaire.startQuestionId];
  const current = questionById.get(currentId) ?? questionById.get(path[path.length - 1]);
  if (!current) return <Shell><ErrorState title="GRAPH_TARGET_MISSING" message={`Current question not found: ${currentId || path[path.length - 1]}.`} /></Shell>;
  const currency = normalizeCurrency(payload.fund.fundingRange?.currency);
  const prefix = currencyPrefix(currency);
  const summary = buildSummary(questions, path, answers, currency);
    const currentIndex = Math.max(0, path.indexOf(current.id));
    const validation = validateAnswer(current, answers[current.id]);
    const canGoBack = stage === "summary" ? path.length > 0 : currentIndex > 0;
    const missingRequired = path.some((id) => {
      const q = questionById.get(id);
      return q ? !!validateAnswer(q, answers[id]) : true;
    });

    const applyAnswer = (question: QuestionDef, value: AnswerValue | undefined) => {
      setGraphError(null);
      const previous = { answers, currentId, stage, message: notice };
      const nextAnswers: Answers = { ...answers };
      if (value === undefined || (Array.isArray(value) && value.length === 0)) delete nextAnswers[question.id];
      else nextAnswers[question.id] = value;
      const nextState = computeGraphState(payload, nextAnswers);
      if (!nextState.ok) {
        setGraphError(nextState);
        return;
      }
      const { answers: prunedAnswers, pruned } = pruneAnswersToReachableSet(nextAnswers, nextState.reachableQuestionIds);
      setAnswers(prunedAnswers);
      if (pruned.length > 0) {
        setUndoState(previous);
        setNotice(`${pruned.length} later answer${pruned.length === 1 ? " was" : "s were"} cleared because your path changed.`);
      } else {
        setNotice("");
        setUndoState(null);
      }
      if (!nextState.path.includes(currentId)) setCurrentId(question.id);
      setStage("question");
    };

    const goBack = () => {
      setSubmitError("");
      if (stage === "summary") {
        setCurrentId(path[path.length - 1]);
        setStage("question");
        return;
      }
      if (currentIndex > 0) setCurrentId(path[currentIndex - 1]);
    };

    const goNext = () => {
      setSubmitError("");
      const currentValidation = validateAnswer(current, answers[current.id]);
      if (currentValidation) {
        setNotice(currentValidation);
        return;
      }
      let edge;
      try {
        edge = resolveEdge(current, answers);
      } catch (error) {
        const defect = error instanceof GraphDefectError ? error : null;
        setGraphError({
          ok: false,
          code: defect?.code ?? "QUESTIONNAIRE_ERROR",
          message: error instanceof Error ? error.message : "The questionnaire could not navigate to the next question.",
        });
        return;
      }
      if (edge.target.type === "terminal") setStage("summary");
      else setCurrentId(edge.target.id);
    };

    const jumpToQuestion = (id: string) => {
      setCurrentId(id);
      setStage("question");
      setSubmitError("");
    };

    const restoreUndo = () => {
      if (!undoState) return;
      setAnswers(undoState.answers);
      setCurrentId(undoState.currentId);
      setStage(undoState.stage);
      setNotice("Restored cleared answers.");
      setUndoState(null);
    };

    const confirm = async () => {
      if (submitting) return;
      if (!app) {
        setSubmitError("The host connection is not ready. Please try again in a moment.");
        return;
      }
      if (missingRequired) {
        setSubmitError("Complete every required reachable question before confirming.");
        return;
      }
      const text = composeSubmissionText(payload.fund.fundId, payload.fund.name, summary);
      setSubmitting(true);
      try {
        await app.updateModelContext({ structuredContent: { fundId: payload.fund.fundId, fundName: payload.fund.name, answers, summary } });
        await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        setStage("confirmed");
        setSubmitError("");
      } catch {
        setSubmitError("Could not send confirmed answers to Copilot. Your answers are still here; try Confirm again.");
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <Shell>
        <div className="header">
          <div>
            <Badge appearance="filled">{payload.fund.category ?? "Grant"}</Badge>
            <h1 className="title" tabIndex={-1} ref={headingRef}>{payload.display?.title ?? payload.fund.name}</h1>
            {payload.fund.shortDescription && <Text>{payload.fund.shortDescription}</Text>}
          </div>
        </div>
        {notice && <MessageBar intent="info"><MessageBarBody>{notice} {undoState && <Button appearance="transparent" onClick={restoreUndo}>Undo</Button>}</MessageBarBody></MessageBar>}
        {submitError && <MessageBar intent="error"><MessageBarBody>{submitError}</MessageBarBody></MessageBar>}
        {stage === "confirmed" ? (
          <ConfirmedState fundName={payload.fund.name} summary={summary} />
        ) : stage === "summary" ? (
          <SummaryScreen terminal={terminal} summary={summary} submitLabel={payload.display?.submitLabel} onEdit={jumpToQuestion} onBack={goBack} onConfirm={confirm} disabled={missingRequired || submitting} />
        ) : (
          <>
            <Progress path={path} currentId={current.id} currentIndex={currentIndex} questions={questions} answers={answers} terminalId={terminal.id} />
            <QuestionHistory path={path} currentId={current.id} summary={summary} onJump={jumpToQuestion} />
            <QuestionStep question={current} value={answers[current.id]} error={validation} currencyPrefix={prefix} onChange={(value) => applyAnswer(current, value)} />
            <div className="navRow">
              <Button icon={<ArrowLeftRegular />} onClick={goBack} disabled={!canGoBack}>Back</Button>
              <Button appearance="primary" onClick={goNext} disabled={!!validation}>Next</Button>
            </div>
          </>
        )}
      </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
  const theme = useMcpTheme();
  return <main className="shell" style={paletteToCssVars(getPalette(theme))}>{children}</main>;
}

function Progress({ path, currentId, currentIndex, questions, answers, terminalId }: { path: string[]; currentId: string; currentIndex: number; questions: QuestionDef[]; answers: Answers; terminalId: string }) {
  const remaining = shortestRemainingQuestionCount(questions, currentId, terminalId, answers);
  const estimate = Math.max(currentIndex + 1, currentIndex + 1 + remaining);
  return (
    <section aria-label="Progress" className="progressBlock">
      <Text size={200}>Question {currentIndex + 1} of about {estimate}</Text>
      <ProgressBar value={(currentIndex + 1) / estimate} aria-label={`Question ${currentIndex + 1} of about ${estimate}`} />
    </section>
  );
}

function AnsweredRow({ question, answerText, onClick, ariaLabel }: { question: string; answerText: string; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      className="answeredCard"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className="answeredCard__question">{question}</span>
      <span className="answeredCard__answer">{answerText}</span>
      <span className="answeredCard__editIcon" aria-hidden="true"><EditRegular /></span>
    </button>
  );
}

function QuestionHistory({ path, currentId, summary, onJump }: { path: string[]; currentId: string; summary: SummaryItem[]; onJump: (id: string) => void }) {
  const currentIndex = path.indexOf(currentId);
  const previousItems = summary.filter((item) => path.indexOf(item.questionId) < currentIndex);
  if (previousItems.length === 0) return null;
  return (
    <nav className="answeredCards" aria-label="Previously answered questions">
      {previousItems.map((item) => (
        <AnsweredRow
          key={item.questionId}
          question={item.question}
          answerText={item.answerText}
          onClick={() => onJump(item.questionId)}
          ariaLabel={`Edit: ${item.question}: ${item.answerText}`}
        />
      ))}
    </nav>
  );
}

function QuestionStep({ question, value, error, currencyPrefix, onChange }: { question: QuestionDef; value: AnswerValue | undefined; error: string | null; currencyPrefix: string; onChange: (value: AnswerValue | undefined) => void }) {
  return (
    <Card className="questionCard">
      <Subtitle1 as="h2" className="questionCard__prompt">{question.prompt}</Subtitle1>
      {question.helpText && (
        <div className="questionCallout" role="note" aria-label="Guidance">
          <span className="questionCallout__icon" aria-hidden="true">ℹ</span>
          <span className="questionCallout__text">{question.helpText}</span>
        </div>
      )}
      <Field validationState={error ? "error" : "none"} validationMessage={error ?? undefined} required={question.required}>
        <AnswerInput question={question} value={value} currencyPrefix={currencyPrefix} onChange={onChange} />
      </Field>
    </Card>
  );
}

function AnswerInput({ question, value, currencyPrefix, onChange }: { question: QuestionDef; value: AnswerValue | undefined; currencyPrefix: string; onChange: (value: AnswerValue | undefined) => void }) {
  if (question.answerType === "single-select") {
    const strValue = typeof value === "string" ? value : "";
    return (
      <RadioGroup value={strValue} onChange={(_, data) => onChange(data.value)}>
        {question.options?.map((o) => {
          const noteId = o.helpText ? `${question.id}-${o.value}-note` : undefined;
          return (
            <div key={o.value} className={`optionItem${strValue === o.value ? " optionItem--selected" : ""}`}>
              <Radio value={o.value} label={o.label} input={noteId ? { "aria-describedby": noteId } : undefined} />
              {o.helpText && <p id={noteId} className="optionNote">{o.helpText}</p>}
            </div>
          );
        })}
      </RadioGroup>
    );
  }
  if (question.answerType === "multi-select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="checkboxStack">
        {question.options?.map((o) => {
          const noteId = o.helpText ? `${question.id}-${o.value}-note` : undefined;
          const isChecked = selected.includes(o.value);
          return (
            <div key={o.value} className={`optionItem${isChecked ? " optionItem--selected" : ""}`}>
              <Checkbox
                label={o.label}
                checked={isChecked}
                onChange={(_, data) => onChange(data.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))}
                input={noteId ? { "aria-describedby": noteId } : undefined}
              />
              {o.helpText && <p id={noteId} className="optionNote">{o.helpText}</p>}
            </div>
          );
        })}
      </div>
    );
  }
  if (question.answerType === "boolean") {
    return <RadioGroup value={typeof value === "boolean" ? String(value) : ""} onChange={(_, data) => onChange(data.value === "true")}><Radio value="true" label="Yes" /><Radio value="false" label="No" /></RadioGroup>;
  }
  if (question.answerType === "number" || question.answerType === "currency") {
    return <Input type="number" inputMode="decimal" value={typeof value === "number" ? String(value) : ""} min={question.validation?.min} max={question.validation?.max} contentBefore={question.answerType === "currency" ? currencyPrefix : undefined} onChange={(_, data) => onChange(data.value.trim() === "" ? undefined : Number(data.value))} />;
  }
  if (question.answerType === "date") {
    return <Input type="date" value={typeof value === "string" ? value : ""} onChange={(_, data) => onChange(data.value || undefined)} />;
  }
  return <Input value={typeof value === "string" ? value : ""} onChange={(_, data) => onChange(data.value)} />;
}

function SummaryScreen({ terminal, summary, submitLabel, onEdit, onBack, onConfirm, disabled }: { terminal: { title?: string; message?: string }; summary: SummaryItem[]; submitLabel?: string; onEdit: (id: string) => void; onBack: () => void; onConfirm: () => void; disabled: boolean }) {
  return (
    <Card className="questionCard">
      <Subtitle1 as="h2">{terminal.title ?? "Confirm your answers"}</Subtitle1>
      {terminal.message && <Body1 className="helpText">{terminal.message}</Body1>}
      <Divider />
      <div className="answeredCards">
        {summary.map((item) => (
          <AnsweredRow
            key={item.questionId}
            question={item.question}
            answerText={item.answerText}
            onClick={() => onEdit(item.questionId)}
            ariaLabel={`Edit: ${item.question}: ${item.answerText}`}
          />
        ))}
      </div>
      <div className="navRow">
        <Button icon={<ArrowLeftRegular />} onClick={onBack}>Back</Button>
        <Button appearance="primary" onClick={onConfirm} disabled={disabled}>{submitLabel ?? "Confirm answers"}</Button>
      </div>
    </Card>
  );
}

function ConfirmedState({ fundName, summary }: { fundName: string; summary: SummaryItem[] }) {
  return (
    <Card className="questionCard confirmed">
      <CheckmarkCircleRegular fontSize={32} />
      <Subtitle1>Your answers were sent.</Subtitle1>
      <Body1>Copilot will assess eligibility for {fundName} in the conversation. This widget does not make the eligibility decision.</Body1>
      {summary.length > 0 && (
        <>
          <Divider />
          <div className="confirmedAnswerList" aria-label="Submitted answers">
            {summary.map((item, index) => (
              <div key={item.questionId} className="confirmedAnswerItem">
                <Text size={200} className="confirmedAnswerItem__q">{index + 1}. {item.question}</Text>
                <Text weight="semibold" className="confirmedAnswerItem__a">{item.answerText}</Text>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function RecoveryState({ app, title = "Questionnaire not loaded", message = "No questionnaire data is available in this iframe. Ask Copilot to reopen it, or restart the questionnaire." }: { app: ReturnType<typeof useMcpApp>["app"]; title?: string; message?: string }) {
  const askToReopen = () => void app?.sendMessage({ role: "user", content: [{ type: "text", text: "Please reopen my grant eligibility questionnaire using the latest saved progress checkpoint if one is available." }] }).catch((error) => {
    console.warn("Could not send questionnaire reopen request.", error);
  });
  return <ErrorState title={title} message={message} action={<Button appearance="primary" onClick={askToReopen} disabled={!app}>Ask Copilot to reopen</Button>} />;
}

function ErrorState({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return <Card className="questionCard"><Subtitle1 as="h1">{title}</Subtitle1><Body1>{message}</Body1>{action}</Card>;
}

export function composeSubmissionText(fundId: string, fundName: string, summary: SummaryItem[]) {
  const lines = [
    `Confirmed questionnaire answers for ${fundName} (${fundId}):`,
    "",
    "Each entry gives the questionId, the display label shown to me, and the exact stored value in brackets.",
    "Evaluate the eligibility criteria against the questionId and the stored value, not the display label.",
    "",
  ];
  summary.forEach((item, index) => {
    const raw = Array.isArray(item.answer) ? item.answer.map((v) => String(v)).join(", ") : String(item.answer);
    lines.push(`${index + 1}. ${item.question}`);
    lines.push(`   questionId: ${item.questionId}`);
    lines.push(`   Answer: ${item.answerText}  [value: ${raw}]`);
    lines.push("");
  });
  lines.push(`Please assess my eligibility for ${fundName} using the fund's eligibility criteria.`);
  return lines.join("\n");
}
