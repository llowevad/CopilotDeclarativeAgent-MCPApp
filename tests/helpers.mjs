import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = path.join(repoRoot, "data");

export function loadFundPackages() {
  return fs.readdirSync(dataDir)
    .filter((file) => file.endsWith(".json") && file !== "fund-package.schema.json")
    .sort()
    .map((file) => ({ file, doc: JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) }));
}

export function refsInCondition(condition, refs = []) {
  if (!condition || typeof condition !== "object") return refs;
  if (typeof condition.answer === "string") refs.push(condition.answer);
  for (const key of ["all", "any"]) if (Array.isArray(condition[key])) condition[key].forEach((item) => refsInCondition(item, refs));
  if (condition.not) refsInCondition(condition.not, refs);
  return refs;
}

export function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function evaluateCondition(condition, answers) {
  if ("always" in condition) return condition.always;
  if ("all" in condition) return condition.all.every((item) => evaluateCondition(item, answers));
  if ("any" in condition) return condition.any.some((item) => evaluateCondition(item, answers));
  if ("not" in condition) return !evaluateCondition(condition.not, answers);
  const value = answers[condition.answer];
  if ("exists" in condition) return (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && !(typeof value === "string" && value.trim() === "")) === condition.exists;
  if ("equals" in condition) return same(value, condition.equals);
  if ("notEquals" in condition) return !same(value, condition.notEquals);
  if ("in" in condition) return condition.in.some((candidate) => same(value, candidate));
  if ("includesAny" in condition) return Array.isArray(value) && condition.includesAny.some((candidate) => value.some((item) => same(item, candidate)));
  if ("includesAll" in condition) return Array.isArray(value) && condition.includesAll.every((candidate) => value.some((item) => same(item, candidate)));
  if ("operator" in condition) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return false;
    if (condition.operator === "lt") return numeric < condition.value;
    if (condition.operator === "lte") return numeric <= condition.value;
    if (condition.operator === "gt") return numeric > condition.value;
    return numeric >= condition.value;
  }
  return false;
}

function collectOperatorThresholds(condition, answerId, values = new Set()) {
  if (!condition || typeof condition !== "object") return values;
  if (condition.answer === answerId && "operator" in condition) {
    values.add(condition.value);
    values.add(condition.value - 1);
    values.add(condition.value + 1);
  }
  for (const key of ["all", "any"]) if (Array.isArray(condition[key])) condition[key].forEach((item) => collectOperatorThresholds(item, answerId, values));
  if (condition.not) collectOperatorThresholds(condition.not, answerId, values);
  return values;
}

export function validAnswerSamples(question) {
  if (question.options) return question.options.map((option) => option.value);
  if (question.answerType === "boolean") return [true, false];
  if (question.answerType === "number" || question.answerType === "currency") {
    const min = question.validation?.min ?? 0;
    const max = question.validation?.max ?? 100000;
    const values = new Set([min, max, 0, 1, 199, 200, 2500, 5000, 25000, 25001, 75000]);
    question.edges.forEach((edge) => collectOperatorThresholds(edge.condition, question.id, values));
    return [...values].filter((value) => Number.isFinite(value) && value >= min && value <= max).sort((a, b) => a - b);
  }
  if (question.answerType === "date") return [question.validation?.minDate ?? "2026-10-01"];
  return ["sample"];
}

export function matchingEdges(question, answers) {
  return question.edges.filter((edge) => evaluateCondition(edge.condition, answers));
}

export function enumerateAnswerPaths(pkg) {
  const questions = new Map(pkg.questionGraph.questions.map((question) => [question.id, question]));
  const terminalId = pkg.questionGraph.terminals[0].id;
  const paths = new Map();

  function walk(questionId, answers, path, seen) {
    assert(!seen.has(questionId), `cycle detected at ${questionId}`);
    const question = questions.get(questionId);
    assert(question, `question ${questionId} exists`);
    const nextSeen = new Set(seen).add(questionId);
    for (const value of validAnswerSamples(question)) {
      const nextAnswers = { ...answers, [questionId]: value };
      const matches = matchingEdges(question, nextAnswers);
      assert.equal(matches.length, 1, `${pkg.fund.id}:${questionId} answer ${JSON.stringify(value)} must match exactly one edge`);
      const target = matches[0].target;
      const nextPath = [...path, questionId];
      if (target.type === "terminal") {
        assert.equal(target.id, terminalId, "path terminates at the single terminal");
        const key = nextPath.join(" > ");
        if (!paths.has(key)) paths.set(key, { path: nextPath, answers: nextAnswers });
      } else {
        walk(target.id, nextAnswers, nextPath, nextSeen);
      }
    }
  }

  walk(pkg.questionGraph.entryQuestionId, {}, [], new Set());
  return [...paths.values()];
}

export function runNodeScript(scriptRelativePath) {
  return spawnSync(process.execPath, [scriptRelativePath], { cwd: repoRoot, encoding: "utf8" });
}

export function assertNoStrayServerProcesses(port) {
  const command = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*src\\server\\dist\\index.js*' } | Select-Object -ExpandProperty ProcessId`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
  assert.equal(output, "", `no MCP server node process remains after testing port ${port}`);
}

export async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function collectAuthoredStrings(value, output = new Set()) {
  if (typeof value === "string" && value.length >= 3) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectAuthoredStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectAuthoredStrings(item, output));
  return output;
}
