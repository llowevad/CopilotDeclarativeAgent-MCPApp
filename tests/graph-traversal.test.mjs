import assert from "node:assert/strict";
import test from "node:test";
import { computeReachablePath, computeReachableQuestionSet, pruneAnswersToReachableSet } from "../src/widget/src/lib/graph.ts";
import { enumerateAnswerPaths, loadFundPackages, matchingEdges, validAnswerSamples } from "./helpers.mjs";

for (const { file, doc } of loadFundPackages()) {
  test(`${file}: enumerated paths terminate at the single terminal, are seven questions, acyclic, and cover every question`, () => {
    const paths = enumerateAnswerPaths(doc);
    const allVisited = new Set();
    const terminalId = doc.questionGraph.terminals[0].id;
    assert.ok(paths.length > 0, "paths were enumerated");
    for (const item of paths) {
      assert.equal(item.path.length, 7, `${item.path.join(" > ")} is exactly seven questions`);
      assert.equal(new Set(item.path).size, item.path.length, "path has no cycles");
      item.path.forEach((id) => allVisited.add(id));
      const computed = computeReachablePath(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, item.answers);
      assert.equal(computed.terminalReached, true, "computed path reaches terminal");
      assert.deepEqual(computed.path, item.path, "widget graph traversal follows the enumerated path");
    }
    assert.deepEqual([...doc.questionGraph.questions.map((question) => question.id)].filter((id) => !allVisited.has(id)), [], "every question is reachable on some path");
  });

  test(`${file}: every question and representative valid answer has exactly one matching edge`, () => {
    for (const question of doc.questionGraph.questions) {
      for (const value of validAnswerSamples(question)) {
        const matches = matchingEdges(question, { [question.id]: value });
        assert.equal(matches.length, 1, `${question.id}=${JSON.stringify(value)} matched ${matches.length} edges`);
      }
    }
  });

  test(`${file}: back-navigation pruning preserves still-reachable answers and clears unreachable branch answers`, () => {
    const terminalId = doc.questionGraph.terminals[0].id;
    const paths = enumerateAnswerPaths(doc);
    const branchA = paths.find((item) => item.path.includes(doc.fund.id.startsWith("neighborhood") ? "food-pantry-partner" : "clinic-annual-patients"));
    const branchB = paths.find((item) => item.path.includes(doc.fund.id.startsWith("neighborhood") ? "food-land-access" : "clinic-broadband-plan"));
    assert.ok(branchA && branchB, "two divergent branches exist");

    const branchQuestionId = doc.fund.id.startsWith("neighborhood") ? "food-project-type" : "clinic-project-focus";
    const changedToB = { ...branchA.answers, [branchQuestionId]: branchB.answers[branchQuestionId] };
    const newPath = computeReachablePath(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, changedToB).path;
    const pruned = pruneAnswersToReachableSet(changedToB, computeReachableQuestionSet(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, changedToB));
    assert.ok(pruned.pruned.includes(doc.fund.id.startsWith("neighborhood") ? "food-pantry-partner" : "clinic-annual-patients"), "old branch answer is pruned");
    assert.equal(pruned.answers[branchQuestionId], branchB.answers[branchQuestionId], "changed branch answer is preserved");
    const sharedDownstream = doc.fund.id.startsWith("neighborhood") ? "food-matching-funds" : "clinic-local-match";
    assert.equal(pruned.answers[sharedDownstream], branchA.answers[sharedDownstream], "shared downstream answer remains reachable and is preserved");

    const preBranchId = doc.fund.id.startsWith("neighborhood") ? "food-service-area" : "clinic-service-county";
    const preChanged = { ...branchA.answers, [preBranchId]: validAnswerSamples(doc.questionGraph.questions.find((q) => q.id === preBranchId)).find((v) => v !== branchA.answers[preBranchId]) };
    const prePath = computeReachablePath(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, preChanged).path;
    const prePruned = pruneAnswersToReachableSet(preChanged, computeReachableQuestionSet(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, preChanged));
    assert.deepEqual(prePruned.pruned, [], "changing a pre-branch answer on a non-structural branch prunes nothing");
    assert.equal(prePruned.answers[branchQuestionId], branchA.answers[branchQuestionId], "later branch answer stays reachable");

    const noEffectId = doc.fund.id.startsWith("neighborhood") ? "food-matching-funds" : "clinic-local-match";
    const noEffectChanged = { ...branchA.answers, [noEffectId]: branchA.answers[noEffectId] === 0 ? 1 : 0 };
    const noEffectPath = computeReachablePath(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, noEffectChanged).path;
    const noEffectPruned = pruneAnswersToReachableSet(noEffectChanged, computeReachableQuestionSet(doc.questionGraph.questions, doc.questionGraph.entryQuestionId, terminalId, noEffectChanged));
    assert.deepEqual(noEffectPruned.pruned, [], "changing an answer with no downstream effect prunes nothing");
    assert.deepEqual(noEffectPath, branchA.path, "path is unchanged");
  });
}
