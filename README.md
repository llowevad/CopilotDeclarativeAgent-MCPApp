# MCPApp-Sample

MCPApp-Sample is a hand-authored Microsoft 365 Copilot declarative agent sample. It combines a custom Model Context Protocol (MCP) server with an interactive MCP App widget.

Scenario:

- A user asks what grant programs are available.
- The agent opens a branching eligibility questionnaire for the selected fund.
- The widget sends confirmed answers back to the agent, and the agent evaluates them against fund criteria.

This project is **not built with Microsoft 365 Agents Toolkit**. The manifests, MCP server contract, widget contract, and deployment shape are written by hand. That makes the sample useful if you want to understand how the pieces connect without scaffolding hiding the details.

## Demo

![Animated walkthrough of the Grant Eligibility Advisor: the user opens the questionnaire, answers the branching questions, confirms, and the agent returns an eligibility outcome](images/DA_MCPApp.gif)

## Architecture overview

At a high level the sample has three moving parts and a data store:

- **Declarative agent** — the Copilot-facing app. It owns the instructions and conversation starters, decides when to call MCP tools, and produces the final eligibility explanation. It never renders the questionnaire itself.
- **MCP server** — a stateless Node.js service exposing four read-only tools over Streamable HTTP at `POST /mcp`. It serves fund data, the question graph, and evaluation criteria, and hosts the widget resource. It never computes a verdict.
- **MCP App widget** — a single-page UI the host renders. It walks the user through a branching questionnaire, supports Back, and sends the confirmed answer summary to the agent.
- **Fund package JSON** — trusted, repo-controlled files loaded at server startup. They carry each fund's details, question graph, and eligibility criteria.

The verdict is deliberately split out: the server provides data, the widget collects answers, and only the agent renders the eligibility outcome — using the safer wording *appears eligible based on your answers*.

## Sequence

![Sequence diagram of the grant eligibility flow, from the user asking about grants through the branching questionnaire to the agent's eligibility outcome](images/sequence.png)

## Widget walkthrough

**1. Interacting with the questionnaire.** The widget renders one question at a time and follows the branch rules from the fund JSON. Earlier answers stay visible and editable above the current question.

![Interacting with the eligibility questionnaire widget](images/widget-01-interacting.png)

**2. Confirming answers.** Every path reaches the same summary and confirmation screen. The user reviews the complete answer set and can jump back to change any answer before confirming.

![Confirm your answers summary screen](images/widget-02-confirm.png)

**3. Answers sent.** After confirmation the widget shows a read-only receipt of what was submitted and hands the turn back to the agent. The widget does not make the eligibility decision.

![Your answers were sent receipt](images/widget-03-sent.png)

**4. Agent result.** The agent fetches the fund criteria, evaluates the confirmed answers, and returns the outcome with specific ways to strengthen the application and a suggested next step.

![Agent eligibility result based on answers](images/widget-04-agent-result.png)

## `src/widget` and cross-origin access

**What `src/widget` is.** This folder holds the source for the MCP App widget — the React + Fluent UI single-page app that renders the branching eligibility questionnaire. `build.mts` bundles it with Vite into a single `questionnaire.html` (plus `questionnaire.js`) and copies the output into `src/server/assets/`. The MCP server then serves that bundle as a `ui://grant-eligibility/questionnaire.html` resource, registered with `registerAppResource` from `@modelcontextprotocol/ext-apps`, and links it to the `start_questionnaire` tool via `_meta.ui.resourceUri`. This is the [MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview) pattern for adding interactive UI to an MCP server.
Reference: [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview) · [Build an MCP App](https://modelcontextprotocol.io/extensions/apps/build)

**Why `*.widget-renderer.usercontent.microsoft.com` is in the CORS allow-list.** Microsoft 365 Copilot doesn't render the widget from its own origin — it loads the widget's HTML/JS into a sandboxed iframe served from a per-server subdomain of `widget-renderer.usercontent.microsoft.com` (the subdomain is a SHA-256 hash of the MCP server's own domain), isolating each widget's origin from the host and from other widgets. That sandboxed origin is what actually issues the browser-side requests back to this MCP server, so the server's CORS policy must explicitly allow it, or the browser blocks the widget's calls even though the host itself trusts the server.
Reference: [MCP apps in Microsoft 365 Copilot — Build interactive UI widgets](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps)

## Prerequisites

Planned stack:

- Node.js 22
- TypeScript 5.7
- Microsoft 365 Copilot or Copilot Chat with custom app upload enabled
- Azure subscription for App Service deployment
- Microsoft Entra app registration for single sign-on before any real hand-off

## Deploying the web app

The MCP server is deployed to Azure App Service with [`infra/deploy.ps1`](infra/deploy.ps1). This is the only script needed to build and ship the server — it is not used for packaging the Copilot agent manifest or for provisioning Azure resources.

**What it does, in order:**

1. Confirms the active `az` subscription matches `-ExpectedSubscriptionId` (or `$env:AZURE_SUBSCRIPTION_ID`) and stops if it doesn't.
2. Runs `npm run build` at the repo root, which builds the widget bundle and compiles the server.
3. Stages a deployable copy of the server into `infra/build/server-package/`: `src/server/dist`, `src/server/assets`, `src/server/shared`, `data`, plus `package.json`/`package-lock.json`.
4. Runs `npm install --omit=dev --ignore-scripts` inside that staging folder so only production dependencies ship.
5. Zips the staged folder to `infra/build/mcpapp-server.zip` (built with forward-slash entry names so Linux App Service accepts it).
6. Computes the widget's sandboxed CORS origin (`https://<sha256-of-hostname>.widget-renderer.usercontent.microsoft.com`) for the target App Service hostname and sets it, along with `m365.cloud.microsoft`, as `CORS_ALLOWED_ORIGINS`.
7. Sets remaining App Service settings (`NODE_ENV`, `WEBSITE_NODE_DEFAULT_VERSION`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`) and the Node runtime, then deploys the zip with `az webapp deploy`.

**Usage:**

```powershell
# Requires: az CLI logged in, an existing App Service already provisioned
.\infra\deploy.ps1 `
  -ResourceGroupName "rg-mcpapp-sample-wus2-<suffix>" `
  -AppName "mcpapp-sample-<suffix>" `
  -ExpectedSubscriptionId "<subscription-guid>"
```

All parameters are optional:

| Parameter | Default | Purpose |
|---|---|---|
| `-ResourceGroupName` | `rg-mcpapp-sample-wus2-<hash>` | Resource group of the target App Service |
| `-AppName` | `mcpapp-sample-<hash>` | App Service name to deploy to |
| `-PackagePath` | `infra/build/mcpapp-server.zip` | Where the deployable zip is written |
| `-ExpectedSubscriptionId` | `$env:AZURE_SUBSCRIPTION_ID` | Safety check against deploying to the wrong subscription |

The default resource group/app names are derived from a short hash of the subscription ID, so re-running with no parameters targets the same App Service consistently once it exists.

## Disclaimer

This project is provided as-is as a reference implementation and sample for educational and demonstration purposes only. It is not intended for production use without thorough review, testing, and hardening appropriate to your environment.

By using this code, you accept full responsibility for any modifications, deployments, and outcomes. The authors make no warranties—express or implied—regarding the suitability, reliability, or security of this solution for any particular purpose. Use of related platforms is subject to their respective terms of service and licensing agreements.

> **In short:** Learn from it, build on it, but validate everything before relying on it.
