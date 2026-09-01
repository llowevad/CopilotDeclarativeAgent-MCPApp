# Grant Eligibility Advisor — deploy and test

Hand-authored Microsoft 365 app package. No Agents Toolkit, no token interpolation — every file in this folder is the literal thing that ships.

This folder contains the complete source of the declarative agent app package:

- `manifest.json` — Teams app manifest
- `declarativeAgent.json` — declarative agent definition with inline instructions
- `ai-plugin.json` — plugin manifest that wires the agent to the remote MCP server
- `color.png` / `outline.png` — the app icons

**To upload:** zip these five files (`manifest.json`, `declarativeAgent.json`, `ai-plugin.json`, `color.png`, `outline.png`) at the **root** of the archive — not nested in a folder — then upload the zip to Microsoft 365 Copilot (see [Upload](#upload)).

## Package contents

Five files, at the **root** of the zip (not nested in a folder — nesting is the most common upload failure):

- `manifest.json` — Teams app manifest v1.24, references the declarative agent via `copilotAgents.declarativeAgents`
- `declarativeAgent.json` — declarative agent manifest v1.8, with the full instructions embedded inline
- `ai-plugin.json` — plugin manifest v2.4, pointing at the remote MCP server with **pinned** tools

> **The `x-` prefix trap.** The v2.4 schema allows any `x-` prefixed extension property, so
> `x-mcp_tool_description` (as seen in some samples) validates cleanly — but the runtime only
> reads `mcp_tool_description`. The schema states that when that property is *absent* the
> runtime **must** fall back to dynamic tool discovery, so the `x-` form silently produces an
> agent whose action registers with **zero functions**. Use `mcp_tool_description` (no `x-`
> prefix) so the tools reach the runtime.
- `color.png` — 192×192, symbol inside the central 120×120 safe region
- `outline.png` — 32×32, white on transparent

## Prerequisite

**Upload custom apps** must be enabled in Teams Admin Center → **Teams apps** → **Setup policies** → **Global (Org-wide default)**. Without it, the upload option is hidden entirely rather than failing with a useful message.

## Upload

Teams → **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom app** → select the zip.

The agent then appears in Microsoft 365 Copilot. Test at `https://m365.cloud.microsoft/chat`.

## Test cases

Ask *"What grants are available?"*, pick the fund, then answer the widget exactly as below. Full detail including expected per-criterion results is in `tests\fixtures\eligibility-cases.md`.

| # | Fund | Answers | Expected outcome |
|---|---|---|---|
| 1 | Food Resilience | nonprofit · low-access neighborhood · **20000** · mobile pantry · yes · 3000 · within 30 days | **appears eligible** |
| 2 | Food Resilience | as above but **25001** | **not eligible** — cites the 25,000 cap |
| 3 | Rural Clinic | independent rural clinic · rural · telehealth equipment · 250 · 6000 · within 60 days · **yes** | **appears eligible** |
| 4 | Rural Clinic | as above but privacy attestation **no** | **not eligible** — cites privacy attestation |

### What to watch for

The agent — not the server — performs the evaluation, so these are the behaviours that actually matter:

- **Calls `get_eligibility_criteria` before judging.** It should not evaluate from the browsing summary or from memory.
- **Uses "appears eligible based on your answers."** Never guarantees an award.
- **Quotes the fund's own remediation text** on a failure rather than inventing advice. Case 2 should surface *"Reduce the grant request to 25000 USD or less, or split costs so only eligible expenses are requested from this fund."* Case 4 should surface the privacy policy/training remediation.
- **Only hard-disqualifier failures block a positive outcome.** Soft-advisory gaps are reported afterwards as ways to strengthen the application, not as rejections.
- **Evaluates on stored values, not display labels.** The submitted message carries both — `Answer: Nonprofit organization  [value: nonprofit]` — and criteria test the value.

### Widget behaviour to exercise

- Answer through to the summary, then go **back** and change the branch question (project type / project focus). Branch-specific answers should clear with an undo offer; **shared answers must survive**.
- Every path is 7 questions and every branch converges on the same confirmation screen — there are no early exits.

## Before real use

Auth is currently `None`, which Microsoft documents as development and testing only. The exit path is Entra SSO — register an Entra app, create an SSO auth config in the Teams Developer Portal, preauthorize the client, then replace the auth block with:

```json
"auth": { "type": "OAuthPluginVault", "reference_id": "<auth-config-id>" }
```

Note that DCR is **not** an option here: Entra ID does not implement RFC 7591 dynamic client registration.

## If something misbehaves

- **Widget doesn't render** — confirm `resources/read` returns ~730 KB rather than a fallback page, and that the widget-renderer origin is in `CORS_ALLOWED_ORIGINS` on the App Service.
- **Agent invents a criterion** — that is an instruction defect, not a data one. The instruction text is in `declarativeAgent.json`; `appPackage\declarativeAgent.json` is the source of truth for it.
- **Tools missing in Copilot** — turn on developer mode (`-developer on`) and open the debug card. If the **Actions** section lists the action but its `Function | Status` table is empty, the tools are not reaching the runtime. Check, in order: `spec.mcp_tool_description` is spelled without an `x-` prefix; the top-level `functions` array is populated; every function name also appears in `run_for_functions`. With dynamic discovery instead, `functions` must be `[]` and `run_for_functions` must be `["*"]`, and newly discovered tools are screened by runtime validation before activation, which can delay them.
- **Verify the server independently of Copilot** — `POST /mcp` must answer `initialize`, `notifications/initialized` (202), and `tools/list` (200). `GET /mcp` must return **405**, not hang: this server is stateless and offers no SSE channel, and a hanging GET stalls a host that opens that channel while connecting.
