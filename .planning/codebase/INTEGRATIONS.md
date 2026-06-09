# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra LLM Bridge:**
- Service: `CINATRA_BASE_URL/api/llm-bridge` — the internal Cinatra LLM execution API
  - Invoked by the `generate` ApiNode in `cinatra/oas.json`
  - HTTP method: POST
  - Auth: runtime-injected via `{{CINATRA_BASE_URL}}` template variable
  - Preferred LLM: `openai` / `gpt-5.5` (declared in `cinatra_llm.preferredProvider` / `preferredModel` in `cinatra/oas.json`)

**Cinatra Marketplace:**
- Service: Cinatra Marketplace MCP proxy (registry.cinatra.ai)
  - Used at publish time via the reusable GitHub Actions release workflow
  - Auth: `CINATRA_MARKETPLACE_VENDOR_TOKEN` (GitHub Actions org secret)
  - Not called at runtime

## MCP Tool Primitives (CRM Facade)

The agent's LLM prompt (defined in `cinatra/oas.json` `generate.data.system` and `skills/email-recipient-selection/SKILL.md`) calls exactly five MCP primitives at runtime. These are provided by the Cinatra platform's CRM facade layer — no direct third-party CRM SDK is bundled:

- `crm_list_get({ id })` — fetch CRM list metadata (name, objectType)
- `crm_list_members_get({ listId })` — fetch list members; returns `{ contactIds, accountIds }`
- `crm_contact_get({ id })` — expand a contactId to a full CrmContact row (name, email, title, accountId)
- `crm_account_get({ id })` — resolve parent account name by accountId (cached per unique accountId)
- `objects_save({ typeHint, rawData })` — persist the recipient bundle as a Cinatra object with typeHint `@cinatra-ai/campaigns:recipients`; returns a UUID `objectId` used as `confirmedRecipientsRef`

Retired primitives (`lists_*`, `objects_list({type:"...contact"})`) are explicitly banned and scanned for by `extension-kind-gate.mjs`.

## Data Storage

**Databases:**
- None directly. The agent does not own a database.
- Contact/list/account data is read from the CRM via the provider-agnostic MCP facade (`crm_list_get`, `crm_list_members_get`, `crm_contact_get`, `crm_account_get`).

**Cinatra Object Store:**
- The recipient bundle is persisted via `objects_save` with typeHint `@cinatra-ai/campaigns:recipients`. This is the Cinatra platform's internal object store.
- Schema written:
  ```json
  {
    "confirmedRecipients": [...],
    "sourceListId": "<string>",
    "sourceListName": "<string>",
    "sourceListMemberType": "contact",
    "sourceListSnapshotAt": "<ISO timestamp>"
  }
  ```

**File Storage:**
- Not applicable

**Caching:**
- In-prompt LLM-side caching only: `crm_account_get` results are cached per unique `accountId` within a single agent run to avoid redundant calls.

## Authentication & Identity

**Auth Provider:**
- Cinatra platform runtime — injects `agent_run_id`, `campaignId`, and `{{CINATRA_BASE_URL}}` at execution time.
- No external OAuth or identity provider is integrated in this agent.

## Human-in-the-Loop (HITL) Surfaces

Two HITL screens pause execution for human review:

- **Scope selection** (`scope_gate` node): renderer `@cinatra-ai/email-outreach-agent:list-picker`
  - Surface ID: `email-recipient-selection:step-0:scope`
  - Also applies the `email_send_events` cooldown filter UX (operator can toggle to include filtered recipients)
- **Approval gate** (`approval_gate` node): renderer `@cinatra-ai/reviewer-agent:contacts-output`
  - Surface ID: `reviewer:approval-gate:input`
  - Risk class: `approval`, requires human confirmation before the flow proceeds to `end`

## Monitoring & Observability

**Error Tracking:**
- Not detected — no third-party error tracking SDK (Sentry, Datadog, etc.) is present.

**Logs:**
- Structured error envelopes returned as JSON from the LLM step (e.g., `{"error":"unsupported_account_scope",...}`). Platform-level logging is handled by the Cinatra runtime.

## CI/CD & Deployment

**Hosting:**
- Cinatra Marketplace (registry.cinatra.ai)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/ci.yml`
  - Runs on push/PR to `main`
  - Node 24, corepack/pnpm
  - Validates `package.json` first-party dep shape
  - Skips install/typecheck/test for source mirrors (host-internal `@cinatra-ai/*` peers)
  - Runs `npm pack --dry-run` for package shape validation
  - Runs `node extension-kind-gate.mjs --package-root .` for OAS retired-primitive scan
- GitHub Actions: `.github/workflows/release.yml`
  - Triggered by published GitHub Release or `workflow_dispatch` on a tag
  - Delegates to `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml@main`

## Webhooks & Callbacks

**Incoming:**
- Not applicable — this is a flow-based agent, not a webhook receiver.

**Outgoing:**
- Not applicable — all external calls are synchronous MCP tool invocations within the agent run.

## Environment Configuration

**Required env vars (runtime):**
- `CINATRA_BASE_URL` — base URL for the Cinatra LLM bridge API (used in `cinatra/oas.json` `generate.url`)

**Secrets location:**
- `CINATRA_MARKETPLACE_VENDOR_TOKEN` — GitHub Actions org secret, used only at publish time

---

*Integration audit: 2026-06-09*
