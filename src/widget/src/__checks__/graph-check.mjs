import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeReachablePath, computeReachableQuestionSet, pruneAnswersToReachableSet, resolveEdge } from "../lib/graph.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..", "..", "..", "..");
const dataDir = path.join(repo, "data");
const files = fs.readdirSync(dataDir)
  .filter((file) => file.endsWith(".json") && file !== "fund-package.schema.json")
  .sort();

function choicesFor(question) {
  if (question.options?.length) return question.options.map((option) => option.value);
  if (question.answerType === "boolean") return [true, false];
  if (question.answerType === "currency" || question.answerType === "number") {
    const vals = new Set([question.validation?.min ?? 0, question.validation?.max ?? 1000]);
    for (const edge of question.edges) if ("operator" in edge.condition) {
      const value = edge.condition.value;
      vals.add(value);
      vals.add(Math.max(question.validation?.min ?? 0, value - 1));
      vals.add(value + 1);
    }
    return [...vals].filter((value) => Number.isFinite(value) && value >= (question.validation?.min ?? -Infinity) && value <= (question.validation?.max ?? Infinity));
  }
  if (question.answerType === "date") return [question.validation?.minDate ?? "2026-01-01"];
  return ["sample"];
}

function walkAll(graph) {
  const byId = new Map(graph.questions.map((question) => [question.id, question]));
  const terminalId = graph.terminals[0].id;
  const results = [];

  function rec(id, answers, pathIds) {
    const question = byId.get(id);
    if (!question) throw new Error(`missing question ${id}`);
    for (const choice of choicesFor(question)) {
      const nextAnswers = { ...answers, [id]: choice };
      const edge = resolveEdge(question, nextAnswers);
      const nextPath = [...pathIds, id];
      if (edge.target.type === "terminal") {
        if (edge.target.id !== terminalId) throw new Error(`wrong terminal ${edge.target.id}`);
        results.push({ answers: nextAnswers, pathIds: nextPath });
      } else {
        rec(edge.target.id, nextAnswers, nextPath);
      }
    }
  }

  rec(graph.entryQuestionId, {}, []);
  return results;
}

function findDivergentBranch(paths) {
  for (const branchA of paths) {
    for (const branchB of paths) {
      if (branchA === branchB) continue;
      const commonPrefix = [];
      for (let index = 0; index < Math.min(branchA.pathIds.length, branchB.pathIds.length); index += 1) {
        if (branchA.pathIds[index] !== branchB.pathIds[index]) break;
        commonPrefix.push(branchA.pathIds[index]);
      }
      const sharedDownstream = branchA.pathIds.find((id, index) => index >= commonPrefix.length && branchB.pathIds.includes(id));
      if (commonPrefix.length > 0 && sharedDownstream) {
        return {
          branchA,
          branchB,
          branchQuestionId: commonPrefix[commonPrefix.length - 1],
          branchSpecificId: branchA.pathIds.find((id) => !branchB.pathIds.includes(id)),
          sharedDownstream,
        };
      }
    }
  }
  return null;
}

for (const file of files) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
  const graph = pkg.questionGraph;
  const paths = walkAll(graph);
  const terminalId = graph.terminals[0].id;
  const uniquePaths = new Set(paths.map((item) => item.pathIds.join(" > ")));
  const lengths = [...new Set(paths.map((item) => item.pathIds.length))].sort((a, b) => a - b);
  const allTerminal = paths.every((item) => computeReachablePath(graph.questions, graph.entryQuestionId, terminalId, item.answers).terminalReached);
  console.log(`${pkg.fund.id}: walked ${paths.length} answer combinations; unique question paths=${uniquePaths.size}; terminal=${allTerminal}; lengths=${lengths.join(",")}`);

  const branch = findDivergentBranch(paths);
  if (branch?.branchSpecificId) {
    const changedAnswers = { ...branch.branchA.answers, [branch.branchQuestionId]: branch.branchB.answers[branch.branchQuestionId] };
    const newPath = computeReachablePath(graph.questions, graph.entryQuestionId, terminalId, changedAnswers).path;
    const pruned = pruneAnswersToReachableSet(changedAnswers, computeReachableQuestionSet(graph.questions, graph.entryQuestionId, terminalId, changedAnswers));
    console.log(`${pkg.fund.id} branch change prunes: ${pruned.pruned.join(",") || "(none)"}`);
    if (!pruned.pruned.includes(branch.branchSpecificId)) throw new Error(`${pkg.fund.id}: old branch answer ${branch.branchSpecificId} was not pruned`);
    if (pruned.answers[branch.sharedDownstream] !== branch.branchA.answers[branch.sharedDownstream]) throw new Error(`${pkg.fund.id}: shared downstream answer ${branch.sharedDownstream} was not preserved`);
  }
}
