# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo. There is no `src/` TypeScript application code. The implementation lives in two artifacts:

- `skills/email-recipient-selection/SKILL.md` — the LLM system prompt that defines the agent's behaviour
- `cinatra/oas.json` — the OpenAgent Spec (OAS) manifest consumed by the Cinatra runtime
- `extension-kind-gate.mjs` — a self-contained, zero-dependency CI validation script (Node.js ESM)

Conventions below cover both the prompt-authoring style and the gate script style.

## Naming Patterns

**Files:**
- Skill prompt: `skills/<skill-slug>/SKILL.md` (kebab-case slug, UPPERCASE filename)
- OAS manifest: `cinatra/oas.json` (fixed location, lowercase)
- Gate script: `extension-kind-gate.mjs` (kebab-case, `.mjs` ESM extension)
- Workflow config: `ci.yml` (lowercase, in `.github/workflows/`)

**Functions (gate script):**
- camelCase for all exported and internal functions: `parseArgs`, `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`, `walkLlmStrings`, `scanOasString`
- Descriptive verb-noun naming: `validate*` for validators, `find*` for finders, `scan*` for scanners, `walk*` for tree-walkers

**Variables:**
- camelCase throughout: `packageRoot`, `bpmnPrefixes`, `openTags`, `rootAttrs`
- Constants: `SCREAMING_SNAKE_CASE` for module-level sets/arrays/regex: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `PRIMITIVE_PATTERNS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`

**Types:**
- No TypeScript types in gate script (plain `.mjs`). TypeScript config (`tsconfig.json`) targets a `src/` directory that does not currently exist — it is a placeholder for future typed source.

## Code Style

**Formatting:**
- No Prettier or ESLint config detected in the repo. The gate script follows consistent 2-space indentation implicitly.
- Line length is moderate (~100 chars), no enforced formatter.

**Linting:**
- No ESLint/Biome config detected. Linting is not enforced in CI beyond Node.js parse-time.

**Module system:**
- ESM throughout. `package.json` declares `"type": "module"`. Gate script uses `import { ... } from "node:fs"` with the `node:` protocol prefix.
- Only Node built-ins are used — no npm dependencies in the gate script (enforced by design comment in the file header).

## Import Organization

**Order (gate script):**
1. Node built-in imports with `node:` prefix (`node:fs`, `node:path`)
2. No third-party or internal imports exist

**Path Aliases:**
- Not applicable — no TypeScript source to alias.

## Prompt Authoring Conventions (SKILL.md)

**Structure:**
- YAML frontmatter (`---`) with `name` and `description` fields at the top
- Persona/role declaration at the opening paragraph
- `## Inputs` section with explicit field names and validation rules
- `## Tool discipline` section listing the exact MCP primitives allowed (exactly 5 named)
- `## Steps` section with numbered `### STEP N — <verb phrase>` subsections
- `## Error handling` summary section at the end
- `## Current scope note` for explicitly calling out retired/out-of-scope functionality

**Prompt style:**
- Imperative voice: "Parse `accountScope` as JSON", "Call `crm_list_get`", "Return EXACTLY"
- Inline JSON schema examples use fenced code blocks with `json` language tag
- Field names in backticks throughout
- "Do NOT" / "MUST" / "NEVER" used for hard rules; all-caps signals a constraint the LLM must not violate
- Retry/skip behaviour stated explicitly per step (e.g., `crm_contact_get` null → skip, do NOT abort)

## OAS Manifest Conventions

**Location:** `cinatra/oas.json`
- `agentspec_version` pinned explicitly (e.g., `"26.1.0"`)
- `component_type` is `"Flow"` for agent extensions
- `id` uses kebab-case matching the package slug
- `inputs`/`outputs` declared with `title` (camelCase field name) and `type`

## Error Handling

**Gate script pattern:**
- All validator functions are pure: they accept data and return `string[]` errors (never throw for business-logic violations)
- Callers accumulate errors via `errors.push(...validateFoo(...))` pattern
- Only unrecoverable I/O failures use `try/catch` — parse failures short-circuit with an early `return errors`
- Exit codes: `0` = pass, `1` = violations, `2` = shape regression (first-party leak)
- Error messages are user-readable strings (not error objects), prefixed with the violated rule

**Prompt error handling pattern:**
- Step 1 (unsupported scope), Step 2 (list not found), Step 3 (zero members): structured JSON error envelopes, return and stop
- All other steps: run to completion; per-item null responses are skipped silently
- Return envelope shape is fixed and always includes `confirmedRecipientsRef`, `recipientCount`, `confirmedRecipients`, `summary`

## Logging

**Gate script:**
- `console.log` for pass messages (stdout)
- `console.error` for violation lists (stderr) with bullet `•` prefix per item
- No structured logging library

## Comments

**When to comment:**
- File-level block comment explains purpose, scope, and intentional constraints (see `extension-kind-gate.mjs` lines 1–34)
- Section delimiters use `// ----` dashes with a label
- Inline comments explain non-obvious design decisions (e.g., why `pnpm dlx` is avoided, why the BPMN namespace must be on the root element)
- JSDoc-style `/** ... */` used on exported functions with one-sentence descriptions

## Function Design

**Size:** Functions are focused and single-purpose. Validators never exceed ~50 lines.

**Parameters:** Prefer simple scalar or pre-parsed object parameters. File paths and strings are the primary parameter types.

**Return Values:** Validators always return `string[]`. The `runGate` dispatcher returns `{ kind, errors }`. No exceptions used for control flow.

## Module Design

**Exports:**
- Named exports for all testable units: `parseArgs`, `validateAgent`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`, `validateWorkflow`, `runGate`
- `main()` is not exported — guarded by `invokedDirectly` check so the module is safely importable in tests without side effects

**Barrel Files:**
- Not applicable — single script file, no module hierarchy.

---

*Convention analysis: 2026-06-09*
