import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { evaluateCondition, resolveMatchingEdges } from "../shared/condition.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(dir, "fund-package.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validatePackage = ajv.compile(schema);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "fund-package.schema.json");
const answerTypes = new Set(schema.$defs.question.properties.answerType.enum);
const severities = new Set(schema.$defs.rule.properties.severity.enum);
const targetTypes = new Set(schema.$defs.edge.properties.target.properties.type.enum);
const guidanceProperties = schema.$defs.evaluationGuidance.properties;
const guidanceFields = Object.keys(guidanceProperties);
const guidanceMaxChars = guidanceFields.reduce((total, field) => total + guidanceProperties[field].maxLength, 0);
const guidanceDenylist = ["ignore previous", "disregard", "guarantee", "always approve"];
let failures = 0;

const fail = (file, msg) => { failures++; console.error(`FAIL ${file}: ${msg}`); };
const pass = (file, msg) => console.log(`PASS ${file}: ${msg}`);
const assert = (cond, file, msg) => { if (!cond) fail(file, msg); };
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
function isId(s) { return typeof s === "string" && /^[a-z][a-z0-9-]*$/.test(s); }

function refsInCondition(c, refs = []) {
  if (!c || typeof c !== "object") return refs;
  if (typeof c.answer === "string") refs.push(c.answer);
  for (const k of ["all", "any"]) if (Array.isArray(c[k])) c[k].forEach((x) => refsInCondition(x, refs));
  if (c.not) refsInCondition(c.not, refs);
  return refs;
}

function sampleValues(q) {
  if (q.options) return q.options.map((o) => o.value);
  if (q.answerType === "boolean") return [true, false];
  if (q.answerType === "currency" || q.answerType === "number") {
    const vals = new Set([0, 1, 199, 200, 2500, 5000, 25000, 25001, 75000]);
    if (q.validation?.min !== undefined) vals.add(q.validation.min);
    if (q.validation?.max !== undefined) vals.add(q.validation.max);
    return [...vals].filter((n) => (q.validation?.min === undefined || n >= q.validation.min) && (q.validation?.max === undefined || n <= q.validation.max));
  }
  if (q.answerType === "date") return ["2026-10-01"];
  return ["sample"];
}

function validateWithJsonSchema(doc, file) {
  if (!validatePackage(doc)) fail(file, `JSON Schema validation failed ${ajv.errorsText(validatePackage.errors, { separator: "; " })}`);
  else pass(file, "JSON Schema validation passed");
}

function minimalSchemaCheck(doc, file) {
  assert(doc.schemaVersion === "1.0.0", file, "schemaVersion must be 1.0.0");
  assert(isId(doc.fund?.id), file, "fund.id must be kebab-case");
  assert(typeof doc.fund?.displayName === "string", file, "fund.displayName required");
  assert(doc.evaluationGuidance && typeof doc.evaluationGuidance === "object", file, "evaluationGuidance required");
  assert(doc.fund?.questionGraphId === doc.questionGraph?.id, file, "fund.questionGraphId must match questionGraph.id");
  assert(Array.isArray(doc.questionGraph?.questions), file, "questionGraph.questions required");
  assert(Array.isArray(doc.questionGraph?.terminals), file, "questionGraph.terminals required");
  assert(Array.isArray(doc.eligibilityRules), file, "eligibilityRules required");
}

function validateEvaluationGuidance(doc, file) {
  const guidance = doc.evaluationGuidance;
  if (!guidance || typeof guidance !== "object") return;
  let totalChars = 0;
  for (const field of guidanceFields) {
    const value = guidance[field];
    assert(typeof value === "string" && value.trim().length > 0, file, `evaluationGuidance.${field} must be non-empty`);
    if (typeof value === "string") {
      totalChars += value.length;
      assert(value.length <= guidanceProperties[field].maxLength, file, `evaluationGuidance.${field} exceeds ${guidanceProperties[field].maxLength} characters`);
    }
  }
  assert(totalChars > 0, file, "evaluationGuidance must contain text");
  assert(totalChars <= guidanceMaxChars, file, `evaluationGuidance exceeds ${guidanceMaxChars} characters`);
  const normalized = guidanceFields.map((field) => guidance[field] ?? "").join("\n").toLowerCase();
  for (const phrase of guidanceDenylist) {
    assert(!normalized.includes(phrase), file, `evaluationGuidance contains denied phrase "${phrase}"`);
  }
  if (failures === 0) pass(file, `evaluationGuidance present, non-empty, ${totalChars}/${guidanceMaxChars} chars, denylist clean (${guidanceDenylist.join(", ")})`);
}

for (const file of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  validateWithJsonSchema(doc, file);
  minimalSchemaCheck(doc, file);
  validateEvaluationGuidance(doc, file);

  const questions = doc.questionGraph.questions;
  const terminals = doc.questionGraph.terminals;
  const qIds = new Set();
  const tIds = new Set();
  const byQ = Object.fromEntries(questions.map((q) => [q.id, q]));
  const terminalId = terminals[0]?.id;

  assert(terminals.length === 1, file, `fund must have exactly one terminal; found ${terminals.length}`);
  for (const t of terminals) {
    assert(isId(t.id), file, `invalid terminal id ${t.id}`);
    assert(!tIds.has(t.id), file, `duplicate terminal id ${t.id}`);
    assert(t.status === "ready-for-confirmation", file, `${t.id} status must be ready-for-confirmation`);
    tIds.add(t.id);
  }

  for (const q of questions) {
    assert(isId(q.id), file, `invalid question id ${q.id}`);
    assert(!qIds.has(q.id), file, `duplicate question id ${q.id}`);
    qIds.add(q.id);
    assert(answerTypes.has(q.answerType), file, `invalid answerType for ${q.id}`);
    assert(Array.isArray(q.edges) && q.edges.length > 0, file, `${q.id} must have explicit edges`);
    if (["single-select", "multi-select"].includes(q.answerType)) assert(Array.isArray(q.options) && q.options.length > 0, file, `${q.id} needs options`);
  }
  assert(qIds.has(doc.questionGraph.entryQuestionId), file, "entryQuestionId must exist");

  for (const q of questions) for (const e of q.edges) {
    assert(isId(e.id), file, `${q.id} has invalid edge id ${e.id}`);
    assert(targetTypes.has(e.target?.type), file, `${q.id}.${e.id} target type invalid`);
    assert(e.target?.type === "question" ? qIds.has(e.target.id) : tIds.has(e.target?.id), file, `${q.id}.${e.id} dangling target ${e.target?.id}`);
    if (e.target?.type === "terminal") assert(e.target.id === terminalId, file, `${q.id}.${e.id} must target the single confirmation terminal`);
    for (const ref of refsInCondition(e.condition)) assert(qIds.has(ref), file, `${q.id}.${e.id} references unknown answer ${ref}`);
  }

  const reachableQ = new Set([doc.questionGraph.entryQuestionId]);
  const reachableT = new Set();
  const visiting = new Set();
  const done = new Set();
  let structuralPathCount = 0;
  let minLen = Infinity;
  let maxLen = 0;

  function structuralWalk(id, depth) {
    if (!qIds.has(id)) return;
    if (visiting.has(id)) { fail(file, `cycle detected at ${id}`); return; }
    visiting.add(id);
    const q = byQ[id];
    if (!q.edges?.length) fail(file, `dead-end question ${id}`);
    for (const e of q.edges) {
      if (e.target.type === "question") {
        reachableQ.add(e.target.id);
        structuralWalk(e.target.id, depth + 1);
      } else {
        reachableT.add(e.target.id);
        structuralPathCount++;
        minLen = Math.min(minLen, depth);
        maxLen = Math.max(maxLen, depth);
        assert(e.target.id === terminalId, file, `path from ${id} reached non-confirmation terminal ${e.target.id}`);
      }
    }
    visiting.delete(id);
    done.add(id);
  }
  structuralWalk(doc.questionGraph.entryQuestionId, 1);

  for (const id of qIds) assert(reachableQ.has(id), file, `orphan question ${id}`);
  for (const id of tIds) assert(reachableT.has(id), file, `unreachable terminal ${id}`);
  assert(Number.isFinite(minLen), file, "no complete path reaches a terminal");
  assert(minLen >= 5, file, `minimum path length must be at least 5 questions; found ${minLen}`);

  const sampledAnswerSets = [];
  const sampledEdges = new Set();
  function sampleWalk(qid, answers, visited) {
    if (visited.has(qid)) { fail(file, `sample traversal cycle at ${qid}`); return; }
    const q = byQ[qid];
    const nextVisited = new Set(visited).add(qid);
    for (const v of sampleValues(q)) {
      const nextAnswers = { ...answers, [qid]: v };
      const matches = resolveMatchingEdges(q.edges, nextAnswers);
      assert(matches.length === 1, file, `${qid} with answer ${JSON.stringify(v)} matched ${matches.length} edges`);
      if (matches.length !== 1) continue;
      sampledEdges.add(`${qid}.${matches[0].id}`);
      const target = matches[0].target;
      if (target.type === "terminal") {
        assert(target.id === terminalId, file, `sample path reached non-confirmation terminal ${target.id}`);
        sampledAnswerSets.push(nextAnswers);
      } else {
        sampleWalk(target.id, nextAnswers, nextVisited);
      }
    }
  }
  sampleWalk(doc.questionGraph.entryQuestionId, {}, new Set());
  for (const q of questions) for (const e of q.edges) {
    assert(sampledEdges.has(`${q.id}.${e.id}`), file, `${q.id}.${e.id} is not reached by sampled answers`);
  }

  for (const r of doc.eligibilityRules) {
    assert(isId(r.id), file, `invalid rule id ${r.id}`);
    assert(severities.has(r.severity), file, `invalid severity ${r.id}`);
    assert(typeof r.criterion === "string" && r.criterion.length >= 20, file, `${r.id} criterion must be a clear self-contained statement`);
    assert(typeof r.remediation === "string" && r.remediation.length >= 20, file, `${r.id} remediation must be specific and actionable`);
    const conditionRefs = refsInCondition(r.condition);
    const appliesRefs = refsInCondition(r.appliesWhen);
    for (const ref of conditionRefs.concat(appliesRefs)) assert(qIds.has(ref), file, `${r.id} references unknown question ${ref}`);
    const relevantSets = r.appliesWhen ? sampledAnswerSets.filter((answers) => evaluateCondition(r.appliesWhen, answers) === true) : sampledAnswerSets;
    if (r.appliesWhen) assert(relevantSets.length > 0, file, `${r.id} appliesWhen is not reachable on any sampled path`);
    for (const answers of relevantSets) {
      for (const ref of conditionRefs) assert(has(answers, ref), file, `${r.id} references ${ref}, which is not asked on an applicable path`);
    }
  }

  if (failures === 0) pass(file, `${qIds.size} questions, ${tIds.size} terminal, ${doc.eligibilityRules.length} rules, ${structuralPathCount} distinct paths, min/max path length ${minLen}/${maxLen}`);
}
if (failures) { console.error(`${failures} validation failure(s)`); process.exit(1); }
console.log(`All ${files.length} fund package(s) passed.`);
