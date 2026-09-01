import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test, { after } from "node:test";
import { assertNoStrayServerProcesses, collectAuthoredStrings, getFreePort, loadFundPackages, repoRoot } from "./helpers.mjs";

const contractedTools = ["list_funds", "get_fund_details", "start_questionnaire", "get_eligibility_criteria"];
let child;
let port;
let baseUrl;

async function startServer() {
  if (child) return;
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["src\\server\\dist\\index.js"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  // Generous on purpose: `npm test` runs all four test files in parallel immediately
  // after a build, so this cold start contends for CPU and a warm-path measurement
  // (~2s) is not representative. A 10s deadline was observed to flake here. This only
  // affects how long a genuine start failure takes to surface, never the success path.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start on ${port}. Output:\n${output}`);
}

after(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (port) assertNoStrayServerProcesses(port);
});

// The transport answers POST with an SSE stream (`text/event-stream`), matching how
// Microsoft's own MCP servers respond, so responses arrive as `event:`/`data:` frames
// rather than a bare JSON body. Parse either shape so the tests assert on the payload
// and not on the transport encoding.
async function readMcpResponse(res) {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
  }
  throw new Error(`No SSE data frame in response: ${text.slice(0, 200)}`);
}

async function rpc(method, params = {}) {
  await startServer();
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 100000), method, params }),
  });
  assert.equal(res.status, 200, `${method} HTTP status`);
  const body = await readMcpResponse(res);
  assert.ok(!body.error, `${method} should not return JSON-RPC transport error: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function callTool(name, args = {}) {
  return rpc("tools/call", { name, arguments: args });
}

test("POST /mcp accepts a wildcard Accept header instead of rejecting it with 406", async () => {
  await startServer();
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "*/*" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(res.status, 200, "wildcard Accept should not 406");
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/, "POST replies stream as SSE");
  const body = await readMcpResponse(res);
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), [...contractedTools].sort());
});

test("GET /mcp returns 405 immediately instead of opening a stream that never delivers", async () => {
  await startServer();
  // The regression this guards: a stateless server that lets GET reach the transport opens
  // an SSE stream, then closes the McpServer out from under it, so the client hangs forever.
  // A Copilot host opening that channel during connect never finishes discovery.
  for (const accept of ["application/json", "text/event-stream", "*/*"]) {
    const started = Date.now();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: { accept },
      signal: AbortSignal.timeout(5000),
    });
    await res.arrayBuffer();
    assert.equal(res.status, 405, `GET with Accept: ${accept} must be 405`);
    assert.equal(res.headers.get("allow"), "POST", "405 should advertise Allow: POST");
    assert.ok(Date.now() - started < 5000, `GET with Accept: ${accept} must not hang`);
  }
});

test("DELETE /mcp returns 405 rather than pretending a session was torn down", async () => {
  await startServer();
  const res = await fetch(`${baseUrl}/mcp`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  await res.arrayBuffer();
  assert.equal(res.status, 405);
});

test("a full initialize handshake completes and then lists tools", async () => {
  await startServer();
  const post = (body) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

  const initRes = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "handshake-test", version: "1.0" } },
  });
  assert.equal(initRes.status, 200, "initialize");
  assert.equal((await readMcpResponse(initRes)).result.protocolVersion, "2025-11-25");

  const notifyRes = await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  await notifyRes.arrayBuffer();
  assert.equal(notifyRes.status, 202, "notifications/initialized should be accepted");

  const listRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = (await readMcpResponse(listRes)).result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(listed, [...contractedTools].sort());
});

test("tools/list exposes exactly the four contracted read-only tools with expected UI metadata", async () => {
  const result = await rpc("tools/list");
  const names = result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, contractedTools.toSorted());
  for (const tool of result.tools) assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is read-only`);
  const start = result.tools.find((tool) => tool.name === "start_questionnaire");
  assert.equal(start._meta?.ui?.resourceUri, "ui://grant-eligibility/questionnaire.html");
  assert.deepEqual(start._meta?.ui?.visibility, ["model", "app"]);
});

test("tool calls return the contracted content and structuredContent shapes", async () => {
  const funds = await callTool("list_funds");
  assert.equal(funds.content[0].type, "text");
  assert.ok(Array.isArray(funds.structuredContent.funds));
  assert.equal(funds.structuredContent.funds.length, 2);
  const fundId = funds.structuredContent.funds[0].fundId;

  const details = await callTool("get_fund_details", { fundId });
  assert.equal(details.content[0].type, "text");
  assert.ok(details.structuredContent.fund.fundId);
  assert.deepEqual(details.structuredContent.availableActions, ["start_questionnaire"]);

  const questionnaire = await callTool("start_questionnaire", { fundId });
  assert.equal(questionnaire.content[0].type, "text");
  assert.equal(questionnaire.structuredContent.mode, "questionnaire");
  assert.ok(Array.isArray(questionnaire.structuredContent.questionnaire.questions));
  assert.equal(questionnaire.structuredContent.questionnaire.terminal.status, "ready-for-confirmation");
  assert.equal(questionnaire._meta.ui.resourceUri, "ui://grant-eligibility/questionnaire.html");

  const criteria = await callTool("get_eligibility_criteria", { fundId });
  assert.equal(criteria.content[0].type, "text");
  assert.ok(Array.isArray(criteria.structuredContent.eligibilityCriteria));
  assert.ok(criteria.structuredContent.evaluationGuidance.reviewPriorities);
});

test("resources/read on the ui URI returns the MCP App HTML MIME type", async () => {
  const result = await rpc("resources/read", { uri: "ui://grant-eligibility/questionnaire.html" });
  assert.equal(result.contents[0].uri, "ui://grant-eligibility/questionnaire.html");
  assert.equal(result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(result.contents[0].text, /<!DOCTYPE html>|<html/i);
});

test("invalid input is rejected cleanly without crashing", async () => {
  const unknown = await callTool("start_questionnaire", { fundId: "not-a-real-fund" });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.structuredContent.error.code, "UNKNOWN_FUND");
  assert.match(unknown.content[0].text, /Valid available funds/);

  const missing = await callTool("get_fund_details", {});
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /Invalid arguments|fundId/);

  const health = await fetch(`${baseUrl}/`);
  assert.equal(health.status, 200, "server still responds after invalid calls");
});

test("tool responses contain no computed eligibility verdict", async () => {
  const authored = new Set();
  loadFundPackages().forEach(({ doc }) => collectAuthoredStrings(doc, authored));
  const verdictWords = /\b(eligible|ineligible|qualifies|approved|denied|pass|fail)\b/i;
  const calls = [
    ["list_funds", {}],
    ["get_fund_details", { fundId: "neighborhood-food-resilience-microgrant" }],
    ["start_questionnaire", { fundId: "neighborhood-food-resilience-microgrant" }],
    ["get_eligibility_criteria", { fundId: "neighborhood-food-resilience-microgrant" }],
  ];
  for (const [name, args] of calls) {
    const result = await callTool(name, args);
    const authoredByLength = [...authored].sort((a, b) => b.length - a.length);
    const stripped = JSON.stringify(result, (key, value) => {
      if (typeof value !== "string") return value;
      let text = value;
      for (const authoredText of authoredByLength) text = text.split(authoredText).join("");
      return text;
    });
    assert.doesNotMatch(stripped, verdictWords, `${name} has no verdict words after removing authored fund/criteria prose`);
    assert.doesNotMatch(stripped, /"(eligible|ineligible|qualifies|approved|denied|pass|fail|verdict|outcome)"\s*:/i, `${name} has no verdict-shaped computed fields`);
  }
});
