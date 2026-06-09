<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                     Cinatra Runtime / Orchestrator           │
│          (invokes flow via DataFlowEdge wiring)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ inputs: campaignId, agent_run_id,
                           │         accountScope (JSON string)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Flow: email-recipient-selection-flow           │
│               `cinatra/oas.json`                             │
│                                                              │
│  StartNode (start)                                           │
│      │                                                       │
│      ▼                                                       │
│  InputMessageNode (scope_gate)                               │
│    HITL: @cinatra-ai/email-outreach-agent:list-picker        │
│    Operator selects a saved CRM list                         │
│      │  accountScope output                                  │
│      ▼                                                       │
│  ApiNode (generate)                                          │
│    POST {{CINATRA_BASE_URL}}/api/llm-bridge                  │
│    LLM: gpt-5.5 (OpenAI)                                     │
│    Skill prompt: `skills/email-recipient-selection/SKILL.md` │
│    MCP tools: crm_list_get, crm_list_members_get,            │
│               crm_contact_get, crm_account_get,              │
│               objects_save                                   │
│      │  campaignId, recipientCount, confirmedRecipients      │
│      ▼                                                       │
│  InputMessageNode (approval_gate)                            │
│    HITL: @cinatra-ai/reviewer-agent:contacts-output          │
│    Operator reviews and approves the recipient list          │
│      │  userResponse                                         │
│      ▼                                                       │
│  EndNode (end)                                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ outputs: campaignId, recipientCount,
                           │          confirmedRecipients, userResponse
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Cinatra Object Store                                        │
│  typeHint: @cinatra-ai/campaigns:recipients                  │
│  (persisted via objects_save MCP call inside ApiNode)        │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Flow definition | Declares all nodes, edges, inputs/outputs | `cinatra/oas.json` |
| StartNode (`start`) | Receives flow inputs from orchestrator | `cinatra/oas.json` ($referenced_components.start) |
| InputMessageNode (`scope_gate`) | HITL — operator picks a saved CRM list; emits `accountScope` | `cinatra/oas.json` ($referenced_components.scope_gate) |
| ApiNode (`generate`) | LLM agent execution — resolves CRM list to recipient bundle, persists via `objects_save` | `cinatra/oas.json` ($referenced_components.generate) |
| InputMessageNode (`approval_gate`) | HITL — operator reviews resolved recipients via reviewer-agent renderer | `cinatra/oas.json` ($referenced_components.approval_gate) |
| EndNode (`end`) | Aggregates final outputs for downstream DataFlowEdge wiring | `cinatra/oas.json` ($referenced_components.end) |
| Skill prompt | LLM behavioral specification — 6-step execution protocol | `skills/email-recipient-selection/SKILL.md` |
| Extension CI gate | Zero-dependency OAS/BPMN sanity checks for extracted repo CI | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** LLM-as-workflow-node (Cinatra Agent Flow)

**Key Characteristics:**
- No imperative application code — the entire agent logic lives as a natural language prompt in `skills/email-recipient-selection/SKILL.md`, executed via the Cinatra LLM-bridge at runtime.
- Control flow is declared in `cinatra/oas.json` as a directed graph of StartNode → InputMessageNode → ApiNode → InputMessageNode → EndNode.
- Data flow is explicit: every inter-node data wire is a named `DataFlowEdge` in `cinatra/oas.json`.
- Two HITL (human-in-the-loop) pause points: `scope_gate` (list picker) and `approval_gate` (recipient review).
- Persistence happens inside the LLM step via MCP `objects_save`, not in application code.

## Layers

**Flow Declaration Layer:**
- Purpose: Structural definition of the agent — nodes, edges, inputs, outputs, renderers, metadata
- Location: `cinatra/oas.json`
- Contains: `agentspec_version: 26.1.0`, flow nodes, ControlFlowEdges, DataFlowEdges, HITL renderer refs
- Depends on: Cinatra runtime to interpret and execute the graph
- Used by: Cinatra orchestrator, downstream agents via DataFlowEdge wiring

**Skill / Prompt Layer:**
- Purpose: Defines the LLM's behavior — what tools to call, in what order, with what error handling
- Location: `skills/email-recipient-selection/SKILL.md`
- Contains: Input spec, 6-step execution protocol, tool discipline, error envelopes, output contract
- Depends on: MCP primitive surface (crm_list_get, crm_list_members_get, crm_contact_get, crm_account_get, objects_save)
- Used by: ApiNode `generate` in `cinatra/oas.json` (system prompt baked into `data.system`)

**CI / Validation Layer:**
- Purpose: Extracted-repo CI gate — validates OAS against banned MCP primitives; validates BPMN shape for workflow kinds
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate` — all pure functions
- Depends on: Node.js builtins only (no registry dependencies)
- Used by: `.github/workflows/ci.yml` (`kind-gates` job)

## Data Flow

### Primary Request Path

1. Orchestrator passes `campaignId`, `agent_run_id`, `accountScope` to StartNode (`cinatra/oas.json` — start)
2. `scope_gate` (InputMessageNode) pauses for operator — operator selects a CRM list via `@cinatra-ai/email-outreach-agent:list-picker` renderer; emits `accountScope` JSON string
3. `scope_gate_to_generate_accountScope` DataFlowEdge delivers `accountScope` to `generate` ApiNode
4. `generate` ApiNode POSTs to `{{CINATRA_BASE_URL}}/api/llm-bridge` with system/user prompt; LLM executes 6-step protocol:
   - Step 1: Parse `accountScope`; reject non-`list` types with structured error
   - Step 2: `crm_list_get({ id: listId })` — fetch list metadata (name, objectType)
   - Step 3: `crm_list_members_get({ listId })` — fetch contactIds
   - Step 4: `crm_contact_get({ id })` per contactId + `crm_account_get({ id })` per unique accountId (cached)
   - Step 5 (cap enforcement): Abort if resolved count exceeds `maxRecipients` (default 200); do NOT truncate
   - Step 6: `objects_save({ typeHint: "@cinatra-ai/campaigns:recipients", rawData: {...} })` — persists bundle; returns UUID
5. `generate` emits `campaignId`, `recipientCount`, `confirmedRecipients`
6. `approval_gate` (InputMessageNode) pauses for operator review via `@cinatra-ai/reviewer-agent:contacts-output`; emits `userResponse`
7. EndNode aggregates all outputs; orchestrator wires `confirmedRecipientsRef` downstream

### Error / Early-Exit Paths

1. `accountScope.type !== "list"`: LLM returns `{"error":"unsupported_account_scope",...}` and stops
2. `crm_list_get` returns null: LLM returns empty-list envelope (recipientCount: 0)
3. `contactIds.length === 0`: LLM returns empty-list envelope
4. Resolved count > `maxRecipients`: LLM returns error JSON; `objects_save` is NOT called
5. Individual `crm_contact_get` null: contact skipped (stale ref); flow continues

**State Management:**
- No in-process state. The recipient bundle is persisted to the Cinatra object store by the LLM via `objects_save`. The returned UUID (`confirmedRecipientsRef`) is passed downstream via DataFlowEdge.

## Key Abstractions

**Cinatra Flow (OAS JSON):**
- Purpose: Declarative directed graph that the Cinatra runtime executes. No imperative code.
- Examples: `cinatra/oas.json`
- Pattern: `component_type` nodes linked by `ControlFlowEdge` and `DataFlowEdge` arrays

**Skill Prompt:**
- Purpose: Specifies LLM behavior as a structured markdown document consumed by the ApiNode system prompt
- Examples: `skills/email-recipient-selection/SKILL.md`
- Pattern: Markdown with `## Inputs`, `## Steps`, `## Tool discipline`, `## Error handling` sections

**MCP Tool Facade:**
- Purpose: Provider-agnostic CRM access surface; all CRM reads go through `crm_*` primitives, never legacy `lists_*` / `contacts_*`
- Pattern: Five allowed primitives: `crm_list_get`, `crm_list_members_get`, `crm_contact_get`, `crm_account_get`, `objects_save`

**Recipient Bundle:**
- Purpose: The persistent output of the agent — a typed Cinatra object containing the resolved contacts plus provenance metadata
- Pattern: `objects_save({ typeHint: "@cinatra-ai/campaigns:recipients", rawData: { confirmedRecipients[], sourceListId, sourceListName, sourceListMemberType, sourceListSnapshotAt } })`

## Entry Points

**Flow Entry:**
- Location: `cinatra/oas.json` (StartNode `start`)
- Triggers: Cinatra orchestrator invokes the flow with `campaignId`, `agent_run_id`, `accountScope`
- Responsibilities: Accept inputs, hand off to scope_gate

**CI Gate Entry:**
- Location: `extension-kind-gate.mjs` (`main()` / `runGate()`)
- Triggers: `node extension-kind-gate.mjs --package-root .` in `.github/workflows/ci.yml`
- Responsibilities: Parse package.json kind, dispatch to `validateAgent` or `validateWorkflow`, exit 0/1

## Architectural Constraints

- **No imperative logic:** All CRM resolution, filtering, and persistence logic lives in the LLM prompt (`skills/email-recipient-selection/SKILL.md`). There is no `src/` directory.
- **Scope restriction:** Only `accountScope.type === "list"` is supported. Legacy `"all-contacts"` and `"segment"` types are explicitly rejected.
- **Cap enforcement (no truncation):** When resolved recipients exceed `maxRecipients`, the agent must fail/block — silent truncation is forbidden. The SKILL.md and the system prompt baked into `cinatra/oas.json` both enforce this.
- **MCP primitive whitelist:** Only 5 MCP calls are permitted. Legacy `lists_*`, `contacts_*`, `accounts_*` primitives are banned and enforced by `extension-kind-gate.mjs`.
- **Provenance fields:** Every persisted bundle must carry `sourceListId`, `sourceListName`, `sourceListMemberType`, `sourceListSnapshotAt` at the bundle level. Per-row contacts stay pure (no provenance).
- **Server-side truth:** `listName`, `memberCount`, `snapshotAt` from `accountScope` are informational only — the LLM always re-fetches via `crm_list_get` / `crm_list_members_get`.
- **Threading:** Single LLM invocation per flow run; no parallelism within the agent step.
- **Global state:** None — stateless LLM call + external object store.
- **Circular imports:** Not applicable (no `src/` code).

## Anti-Patterns

### Trusting operator-supplied accountScope metadata

**What happens:** Using `accountScope.listName`, `accountScope.memberCount`, or `accountScope.snapshotAt` as truth
**Why it's wrong:** The operator snapshot may be stale; server-side data will differ
**Do this instead:** Only trust `accountScope.listId`. Always re-fetch via `crm_list_get` / `crm_list_members_get`. See `skills/email-recipient-selection/SKILL.md` Step 2.

### Calling legacy CRM primitives

**What happens:** Calling `lists_list`, `contacts_get`, `accounts_list`, etc. directly
**Why it's wrong:** These primitives are retired; the ban is enforced at CI by `extension-kind-gate.mjs` and at the runtime by the MCP facade
**Do this instead:** Use `crm_list_get`, `crm_list_members_get`, `crm_contact_get`, `crm_account_get`

### Silent recipient truncation at maxRecipients

**What happens:** Silently capping the array to `maxRecipients` and proceeding
**Why it's wrong:** The operator would not know the list was truncated; partial campaigns go out without consent
**Do this instead:** Return a structured error JSON before `objects_save`; require the operator to pick a smaller list

## Error Handling

**Strategy:** Graceful structured-envelope early exit with JSON error objects; per-item null skipping for stale CRM references.

**Patterns:**
- Unsupported scope type → return `{"error":"unsupported_account_scope",...}` immediately (no tool calls)
- List not found / empty → return `{"confirmedRecipientsRef":"","recipientCount":0,"confirmedRecipients":[],"summary":"..."}`
- Per-contact null response → skip silently; do not abort the run
- maxRecipients exceeded → return error JSON; do NOT call `objects_save`
- All other steps → run to completion; surface errors in `summary` field

## Cross-Cutting Concerns

**Logging:** Not applicable — no application code. LLM produces a `summary` string in its JSON output.
**Validation:** Input validation is performed by the LLM in Step 1 (scope type check). CI gate (`extension-kind-gate.mjs`) validates OAS structure pre-publish.
**Authentication:** Handled by the Cinatra runtime — `CINATRA_BASE_URL` is injected at runtime; MCP credentials are managed by the host platform.

---

*Architecture analysis: 2026-06-09*
