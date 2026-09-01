import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSummary } from "../src/widget/src/lib/graph.ts";
import { loadFundPackages, repoRoot } from "./helpers.mjs";

test("summary payload carries both display labels and raw stored values", () => {
  const pkg = loadFundPackages().find((item) => item.doc.fund.id === "neighborhood-food-resilience-microgrant").doc;
  const pathIds = ["food-applicant-type", "food-service-area", "food-request-amount", "food-project-type", "food-pantry-partner", "food-matching-funds", "food-launch-readiness"];
  const answers = {
    "food-applicant-type": "nonprofit",
    "food-service-area": "low-access-neighborhood",
    "food-request-amount": 12000,
    "food-project-type": "mobile-pantry",
    "food-pantry-partner": true,
    "food-matching-funds": 3000,
    "food-launch-readiness": "within-30-days",
  };
  const summary = buildSummary(pkg.questionGraph.questions, pathIds, answers);
  const applicant = summary.find((item) => item.questionId === "food-applicant-type");
  assert.equal(applicant.answer, "nonprofit", "structuredContent summary keeps the raw stored value");
  assert.equal(applicant.answerText, "Nonprofit organization", "structuredContent summary keeps the display label");
  assert.notEqual(applicant.answer, applicant.answerText, "regression fixture materially differs in value and label");
});

test("submission text composer source includes questionId, display label, and raw value", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src", "widget", "src", "questionnaire", "QuestionnaireApp.tsx"), "utf8");
  assert.match(source, /function composeSubmissionText\(/, "composer exists");
  assert.match(source, /questionId: \$\{item\.questionId\}/, "message includes questionId");
  assert.match(source, /Answer: \$\{item\.answerText\}  \[value: \$\{raw\}\]/, "message includes display label and raw stored value");
  assert.match(source, /updateModelContext\(\{ structuredContent: \{ fundId: .*fundName: .*answers, summary \} \}\)/s, "structuredContent includes answers and summary");
});

test("composeSubmissionText is exported for direct runtime regression testing", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src", "widget", "src", "questionnaire", "QuestionnaireApp.tsx"), "utf8");
  assert.match(source, /export function composeSubmissionText\(/, "composeSubmissionText should be exported so tests can execute the confirmed-answer message contract directly instead of relying on static source inspection");
});
