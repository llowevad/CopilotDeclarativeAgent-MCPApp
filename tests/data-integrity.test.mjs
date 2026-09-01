import assert from "node:assert/strict";
import test from "node:test";
import { loadFundPackages, refsInCondition, runNodeScript } from "./helpers.mjs";

test("data\validate.mjs passes as part of the test suite", () => {
  const result = runNodeScript("data\\validate.mjs");
  assert.equal(result.status, 0, `data validator failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
});

for (const { file, doc } of loadFundPackages()) {
  test(`${file}: one terminal, no dangling graph references, no orphans, valid rules, evaluation guidance`, () => {
    const questions = doc.questionGraph.questions;
    const terminals = doc.questionGraph.terminals;
    assert.equal(terminals.length, 1, "fund must have exactly one terminal");
    assert.equal(terminals[0].status, "ready-for-confirmation");
    assert.ok(doc.evaluationGuidance, "evaluationGuidance is present");
    const guidanceText = Object.values(doc.evaluationGuidance).join("\n");
    assert.ok(guidanceText.length > 0 && guidanceText.length <= 1140, "evaluationGuidance is non-empty and within schema cap");

    const questionIds = new Set(questions.map((question) => question.id));
    assert.ok(questionIds.has(doc.questionGraph.entryQuestionId), "entry question exists");
    const reachable = new Set([doc.questionGraph.entryQuestionId]);
    const pathLengths = [];

    function walk(questionId, seen, length) {
      assert.ok(!seen.has(questionId), `cycle at ${questionId}`);
      const question = questions.find((item) => item.id === questionId);
      assert.ok(question, `question ${questionId} exists`);
      for (const edge of question.edges) {
        refsInCondition(edge.condition).forEach((ref) => assert.ok(questionIds.has(ref), `${edge.id} references real question ${ref}`));
        if (edge.target.type === "terminal") {
          assert.equal(edge.target.id, terminals[0].id, `${edge.id} targets the single terminal`);
          pathLengths.push(length + 1);
        } else {
          assert.ok(questionIds.has(edge.target.id), `${edge.id} has no dangling question target`);
          reachable.add(edge.target.id);
          walk(edge.target.id, new Set(seen).add(questionId), length + 1);
        }
      }
    }
    walk(doc.questionGraph.entryQuestionId, new Set(), 0);
    assert.deepEqual([...questionIds].filter((id) => !reachable.has(id)), [], "no orphan questions");
    assert.ok(pathLengths.length > 0, "all paths reach a terminal");
    assert.ok(Math.min(...pathLengths) >= 5, "minimum path length is at least five questions");

    for (const rule of doc.eligibilityRules) {
      refsInCondition(rule.condition).forEach((ref) => assert.ok(questionIds.has(ref), `${rule.id} condition references real question ${ref}`));
      refsInCondition(rule.appliesWhen).forEach((ref) => assert.ok(questionIds.has(ref), `${rule.id} appliesWhen references real question ${ref}`));
      assert.ok(rule.remediation?.length > 0, `${rule.id} has remediation`);
    }
  });
}
