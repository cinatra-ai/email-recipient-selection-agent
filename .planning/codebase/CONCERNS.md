# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**SKILL.md vs. oas.json prompt divergence:**
- Issue: The agent's behaviour is defined in two places: `skills/email-recipient-selection/SKILL.md` (human-readable spec) and the `system` prompt string embedded inside `cinatra/oas.json` (the runtime-authoritative prompt). These must be kept in sync manually. The SKILL.md references `confirmedRecipientsRef` as a return field; the oas.json system prompt does NOT include `confirmedRecipientsRef` in the Step 7 return envelope — it returns `campaignId` instead.
- Files: `skills/email-recipient-selection/SKILL.md` (line 163), `cinatra/oas.json` (line 277, Step 7)
- Impact: Operator tooling or documentation built from SKILL.md will show a different output contract than what the LLM actually returns at runtime. Downstream orchestrators wiring `confirmedRecipientsRef` from the SKILL.md spec will find the field absent in actual output.
- Fix approach: Reconcile Step 7 in both documents. Either add `confirmedRecipientsRef` to the oas.json return envelope or remove it from SKILL.md and use `objectId` from `objects_save` directly.

**`objects_save` rawData includes `campaignId` in oas.json but SKILL.md forbids it:**
- Issue: The `system` prompt in `cinatra/oas.json` (Step 6) instructs the LLM to include `campaignId` and `cinatra_agent_run_id` in the `objects_save` rawData. `skills/email-recipient-selection/SKILL.md` (Step 5) explicitly states "Do NOT include `campaignId` in `rawData`."
- Files: `cinatra/oas.json` (line 277 Step 6), `skills/email-recipient-selection/SKILL.md` (line 150)
- Impact: The persisted recipient bundle object will have different fields depending on which prompt version is authoritative, breaking downstream consumers that rely on a stable schema.
- Fix approach: Decide the canonical contract and update both files. The SKILL.md rationale ("runtime's automatic `agent_run_id` propagation tags the object") suggests omitting `campaignId` is intentional; remove it from the oas.json system prompt accordingly.

**`sourceListSnapshotAt` timestamp is LLM-generated (not server-sourced):**
- Issue: Both SKILL.md and oas.json specify that `sourceListSnapshotAt` is "set by the LLM when `crm_list_members_get` was called". This is a hallucination-prone design: the LLM emits a timestamp it generates itself rather than reading one from the API response.
- Files: `skills/email-recipient-selection/SKILL.md` (line 96), `cinatra/oas.json` (line 277 Step 3)
- Impact: The snapshot timestamp in the stored bundle is unreliable — subject to model drift, incorrect timezone formatting, or plausible-but-wrong values.
- Fix approach: Either read the timestamp from the CRM API response (if available) or have the runtime layer inject a trusted timestamp; do not rely on the LLM to generate authoritative timestamps.

**`tsconfig.json` includes `src/` but no `src/` directory exists:**
- Issue: `tsconfig.json` configures `"rootDir": "src"` and `"include": ["src/**/*.ts", "src/**/*.tsx"]` but the repo contains no `src/` directory. The agent is content-only (SKILL.md + oas.json).
- Files: `tsconfig.json`
- Impact: Running `tsc` standalone would produce TS18003 "No inputs were found" (CI correctly detects this case and skips typecheck for content-only extensions, but the tsconfig is misleading and could confuse contributors).
- Fix approach: Remove `rootDir`/`include`/`outDir` from tsconfig or replace with a no-op config appropriate for a content-only package.

**`package.json` missing `cinatra.kind`:**
- Issue: `package.json` has a `cinatra` block with `apiVersion`, `dependencies`, and `agentDependencies`, but no `cinatra.kind` field. The `extension-kind-gate.mjs` dispatches based on `pkg?.cinatra?.kind`; without it, kind is `undefined` and the gate emits "no kind-specific gate" and exits 0 silently instead of running the agent OAS validation.
- Files: `package.json`, `extension-kind-gate.mjs` (line 359-362)
- Impact: The OAS retired-primitive scan is silently skipped in the standalone extracted-repo CI, meaning banned primitives could be re-introduced without being caught by the `kind-gates` CI job. (The `ci.yml` hardcodes a step that calls `node extension-kind-gate.mjs` directly, so it does run — but only because the CI step is explicit, not because the gate dispatches correctly.)
- Fix approach: Add `"kind": "agent"` to the `cinatra` block in `package.json`.

**`agentDependencies` is a non-standard duplicate of `cinatra.dependencies`:**
- Issue: `package.json` has both `cinatra.dependencies` (an array with full dependency objects) and a top-level `cinatra.agentDependencies` map. The Cinatra platform spec uses only `cinatra.dependencies`; `agentDependencies` appears to be a legacy or redundant field.
- Files: `package.json` (lines 11-25)
- Impact: Potential confusion about which field is authoritative; unused fields increase maintenance surface.
- Fix approach: Remove `cinatra.agentDependencies` if it is not consumed by any runtime tooling.

## Known Bugs

**`confirmedRecipientsRef` missing from runtime output:**
- Symptoms: The agent's documented primary output (`confirmedRecipientsRef`) is not present in the Step 7 return JSON specified in the oas.json system prompt. The prompt returns `campaignId`, `recipientCount`, `confirmedRecipients`, and `summary` — no `confirmedRecipientsRef`.
- Files: `cinatra/oas.json` (line 277)
- Trigger: Any orchestrator downstream that reads `confirmedRecipientsRef` from this agent's output will receive `undefined`.
- Workaround: Downstream consumers must currently derive the ref from the `objects_save` call response before Step 7, but the LLM is not instructed to surface it.

**`campaignId` output not wired through `scope_gate`:**
- Symptoms: The `scope_gate` node (InputMessageNode) outputs only `accountScope`. The `campaignId` pass-through goes directly `start → generate` via DataFlowEdge. If `scope_gate` modifies or blocks the flow, `campaignId` still flows to `generate` unaffected — this is correct. However, the `approval_gate` node outputs only `userResponse`, and `userResponse` is not listed in the SKILL.md return contract.
- Files: `cinatra/oas.json` (line 340-360)
- Trigger: Not a crash bug; the `userResponse` output from `approval_gate` passes through to `end` but is undocumented in SKILL.md, creating a hidden implicit output.

## Security Considerations

**LLM-controlled `rawData` persisted to object store without schema enforcement:**
- Risk: The `objects_save` call passes LLM-generated `rawData` directly to the cinatra object store. There is no schema validation layer between the LLM output and persistence. A jailbreak or prompt injection via malicious CRM contact data (e.g., a contact name containing injection instructions) could cause the LLM to write unexpected fields into the bundle.
- Files: `skills/email-recipient-selection/SKILL.md` (Step 5), `cinatra/oas.json` (line 277 Step 6)
- Current mitigation: The `typeHint` scopes the object type; the LLM is instructed on the exact rawData shape.
- Recommendations: Add server-side schema validation on the `@cinatra-ai/campaigns:recipients` typeHint before storing, rejecting unexpected top-level fields.

**CRM data passed through LLM context without sanitization:**
- Risk: Full CRM contact records (`name`, `email`, `title`) are materialized into the LLM's context window during Step 4. Maliciously crafted CRM data (e.g., prompt-injection payloads in `title` or `name` fields) could hijack the LLM's instructions.
- Files: `skills/email-recipient-selection/SKILL.md` (Step 4), `cinatra/oas.json` (line 277 Step 4)
- Current mitigation: None detected.
- Recommendations: Sanitize or truncate contact fields before injecting into LLM context; consider structured tool-call schemas that prevent free-text field values from being interpreted as instructions.

**`.npmrc` present in repo:**
- Risk: `.npmrc` exists at repo root. Contents are `auto-install-peers=false` (no token present), but the file is committed and could be a vector for accidentally committing registry auth tokens in future.
- Files: `.npmrc`
- Current mitigation: Current content is benign.
- Recommendations: Add `.npmrc` to `.gitignore` for any file that might contain auth tokens, or document that this specific `.npmrc` is intentionally committed for CI behaviour only.

## Performance Bottlenecks

**Sequential per-contact CRM API calls (N+1 pattern):**
- Problem: Step 4 calls `crm_contact_get({ id: contactId })` once per contact in the list, sequentially. For large lists, this creates an N+1 API call pattern (one call per contact plus one call per unique accountId for `crm_account_get`).
- Files: `skills/email-recipient-selection/SKILL.md` (Step 4), `cinatra/oas.json` (line 277 Step 4)
- Cause: The CRM facade exposes only single-record get operations; no bulk-fetch primitive exists for contacts in the tool discipline.
- Improvement path: Add a `crm_contacts_get_batch` primitive to the CRM facade, or implement client-side parallelism if the LLM runtime supports concurrent tool calls.

**`maxRecipients` cap at 200 is enforced by LLM, not runtime:**
- Problem: The cap enforcement (Step 5 in oas.json) relies on the LLM to count and block. An LLM counting error or hallucination can silently pass oversized lists through.
- Files: `cinatra/oas.json` (line 277 Step 5)
- Cause: The cap is described as a `cinatra.json.limits.maxRecipients` config reference, but no `cinatra.json` file exists in this repo — the cap value (200) is hardcoded in the prompt string.
- Improvement path: Enforce the cap server-side in the cinatra runtime before passing results to `objects_save`; remove reliance on LLM counting for a hard limit.

## Fragile Areas

**LLM prompt in `cinatra/oas.json` is a 1,000+ character inline string:**
- Files: `cinatra/oas.json` (line 277, `data.system` field)
- Why fragile: The entire agent logic is encoded as a single minified prose string inside a JSON value. Any edit requires careful escaping, there is no diff-friendliness, and the full step logic is invisible to static analysis tools. A typo or truncation silently produces a broken agent.
- Safe modification: Always edit SKILL.md first as the source of truth, then propagate changes to the oas.json `system` field. Use a code review checklist to verify both are in sync.
- Test coverage: No automated test validates that SKILL.md and oas.json system prompt are semantically equivalent.

**`extension-kind-gate.mjs` is a vendored copy, not a shared dependency:**
- Files: `extension-kind-gate.mjs`
- Why fragile: The file comment states it is "shipped INTO each extracted agent/workflow repo by the extraction script". If the monorepo updates the banned primitive list or gate logic, this copy becomes stale and the repo's CI will not catch regressions that the monorepo gate would.
- Safe modification: Treat this file as read-only in this repo; changes must originate in the monorepo extraction script.
- Test coverage: No test in this repo verifies the gate matches the monorepo version.

**`scope_gate` default `accountScope` is `{"type":"all-contacts"}`:**
- Files: `cinatra/oas.json` (line 34, `start` node inputs)
- Why fragile: The default value for `accountScope` is the explicitly unsupported legacy type `"all-contacts"`. If the input is not overridden by the operator, the agent will immediately return an `unsupported_account_scope` error. This is a poor default that creates a confusing failure mode for new users.
- Safe modification: Change the default to `{}` or `{"type":"list","listId":""}` with appropriate empty-state handling.

## Scaling Limits

**maxRecipients hard cap of 200:**
- Current capacity: 200 contacts per run (hardcoded in oas.json system prompt).
- Limit: Lists exceeding 200 contacts are blocked with an error before persistence.
- Scaling path: Override via agent install settings (referenced in the prompt but the mechanism — `cinatra.json.limits.maxRecipients` — has no corresponding config file in this repo).

## Dependencies at Risk

**`@cinatra-ai/reviewer-agent` dependency with `"range": "*"`:**
- Risk: The `cinatra.dependencies` array specifies `"range": "*"` for the reviewer-agent dependency, meaning any published version is acceptable. A breaking change to the reviewer-agent API (e.g., `renderer` contract changes for `@cinatra-ai/reviewer-agent:contacts-output`) would silently break the `approval_gate` node.
- Files: `package.json` (lines 12-21)
- Impact: The approval HITL screen could break at runtime without a version constraint catching it.
- Migration plan: Pin to a minimum semver range (e.g., `"^0.1.0"`) matching the `agentDependencies` entry which already uses `^0.1.0`.

**Hardcoded `preferredModel: "gpt-5.5"` in oas.json:**
- Risk: The LLM node specifies `"preferredModel": "gpt-5.5"`. If this model is deprecated or renamed by the provider, the agent will fail at runtime with no graceful fallback.
- Files: `cinatra/oas.json` (line 284)
- Impact: Complete agent failure if the model is unavailable.
- Migration plan: Use a stable model alias or add a `fallbackModel` field to the cinatra LLM config.

## Missing Critical Features

**No `cinatra.json` limits config file:**
- Problem: The oas.json system prompt references `cinatra.json.limits.maxRecipients` as the source for the cap value, but no `cinatra.json` file exists in this repo. The cap is hardcoded as `200` in the prompt string.
- Blocks: Operators cannot override `maxRecipients` via agent install settings as the prompt implies they can.

**No `accountIds` materialization path:**
- Problem: `crm_list_members_get` returns both `contactIds` and `accountIds`, but `accountIds` are explicitly ignored. There is no supported path to build a recipient list from account-level list members.
- Blocks: Campaigns targeting account-based lists (e.g., lists returned with `objectType: "account"`) will silently produce zero recipients with only a summary warning, not an actionable error.

## Test Coverage Gaps

**Zero tests in the repository:**
- What's not tested: All logic — OAS structure validity, prompt content, gate behaviour for edge cases (empty list, null contacts, oversized list, unsupported scope types), data flow wiring.
- Files: Entire repo — no test files detected.
- Risk: Regressions in any of the above concern areas (SKILL.md/oas.json divergence, missing `confirmedRecipientsRef`, bad defaults) would go undetected until runtime failures in production.
- Priority: High — the `extension-kind-gate.mjs` itself has exported pure functions (`validateAgent`, `validateBpmnSanity`, `validateWorkflowPackageShape`) that are directly unit-testable without any @cinatra-ai dependency, yet no tests exist for them.

**No integration test for the LLM prompt contract:**
- What's not tested: The correctness of the `system` prompt (step ordering, tool call discipline, return envelope shape) is untested. Prompt regressions are invisible until an agent run fails.
- Files: `cinatra/oas.json` (line 277)
- Risk: Silent breakage of the output contract (e.g., missing `confirmedRecipientsRef`, wrong rawData shape) undetected until downstream orchestrator failures.
- Priority: Medium — prompt contract tests are non-trivial but snapshot/golden-output tests of structured prompt sections are feasible.

---

*Concerns audit: 2026-06-09*
