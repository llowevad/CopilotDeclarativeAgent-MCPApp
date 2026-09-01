import cors, { type CorsOptions } from "cors";
import express, { type ErrorRequestHandler } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, loadQuestionnaireHtml } from "./mcp-server.js";
import { getAllFundPackages, loadFundPackages } from "./data.js";

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const app = express();

const DEV_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://m365.cloud.microsoft",
  "https://{sha256-of-server-domain}.widget-renderer.usercontent.microsoft.com",
];

const configuredOrigins = getConfiguredCorsOrigins();
const allowedOrigins = new Set(configuredOrigins);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    console.warn(`Denied CORS origin: ${origin}`);
    return callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "mcp-session-id"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Access logging exists so "is the Copilot host actually reaching this server?" is answered
// with evidence instead of inference. Without it, a host that never calls the server and a
// host whose call is rejected look identical from the outside: an agent with no tools.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const rpcMethod = typeof req.body?.method === "string" ? ` rpc=${req.body.method}` : "";
    console.log(
      `[req] ${req.method} ${req.originalUrl}${rpcMethod} -> ${res.statusCode} ${Date.now() - start}ms` +
        ` ua="${req.headers["user-agent"] ?? "-"}" origin="${req.headers.origin ?? "-"}" accept="${req.headers.accept ?? "-"}"`,
    );
  });
  next();
});

app.get("/", (_req, res) => {
  res.json({ name: "grant-eligibility-mcp-server", status: "ok", fundsLoaded: getAllFundPackages().length });
});

// TODO(Warden/Phase 3): insert Entra SSO auth middleware here before /mcp. See .squad/design/auth-design.md.

// This server is stateless: every request builds a fresh McpServer that is closed as soon
// as the response is written, so there is no session to stream server-initiated messages
// on. The Streamable HTTP spec says a server that does not offer an SSE stream at this
// endpoint must answer GET with 405. Letting these reach the transport instead opens a
// standalone SSE stream that the `finally` block below immediately closes the server out
// from under, so the client holds a socket that never delivers anything and hangs. A host
// that opens that channel while connecting never finishes discovery and shows no tools.
app.get("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: this server is stateless and does not offer an SSE stream on GET." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: this server is stateless and has no session to terminate." },
    id: null,
  });
});

app.post("/mcp", async (req, res) => {
  normaliseAcceptHeader(req);
  const server = createMcpServer();
  // Respond as text/event-stream rather than application/json. Microsoft's own working
  // MCP servers answer POST /mcp with SSE, and `enableJsonResponse: true` makes the
  // transport reply with plain JSON instead — a shape the Copilot MCP client does not
  // appear to accept, which surfaces as an agent that registers but exposes no tools.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  } finally {
    await server.close();
  }
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled request error", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

loadFundPackages();

const httpServer = app.listen(PORT, () => {
  console.log(`Grant Eligibility MCP server running at http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
void loadQuestionnaireHtml();

process.on("SIGTERM", () => httpServer.close(() => process.exit(0)));
process.on("SIGINT", () => httpServer.close(() => process.exit(0)));

/**
 * The MCP Streamable HTTP transport rejects a POST unless the client accepts BOTH
 * application/json and text/event-stream, answering 406 — which breaks the very common
 * `Accept: * / *`, and surfaces to the user as an agent with no tools at all. Because
 * `enableJsonResponse` is on, POST replies are JSON regardless of what we widen to here.
 *
 * Only POST reaches this: GET and DELETE are answered with 405 above.
 */
function normaliseAcceptHeader(req: express.Request): void {
  const accept = req.headers.accept ?? "";
  const acceptsJson = accept.includes("application/json");
  const acceptsSse = accept.includes("text/event-stream");
  if (!acceptsJson || !acceptsSse) {
    req.headers.accept = "application/json, text/event-stream";
  }
}

function getConfiguredCorsOrigins(): string[] {
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (rawOrigins !== undefined) {
    const origins = rawOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length === 0) throw new Error("CORS_ALLOWED_ORIGINS was set but did not contain any origins.");
    return origins;
  }

  if (process.env.NODE_ENV === "production" || process.env.WEBSITE_SITE_NAME) {
    throw new Error("CORS_ALLOWED_ORIGINS must be set in production, including the Copilot widget renderer origin.");
  }

  return DEV_ALLOWED_ORIGINS;
}
