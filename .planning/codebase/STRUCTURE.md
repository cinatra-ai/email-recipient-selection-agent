# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
email-recipient-selection-agent/
├── cinatra/                     # Cinatra platform artifacts
│   └── oas.json                 # Flow definition (nodes, edges, inputs, outputs, HITL config)
├── skills/                      # LLM skill prompts
│   └── email-recipient-selection/
│       └── SKILL.md             # Agent behavior specification (6-step execution protocol)
├── .github/
│   └── workflows/
│       ├── ci.yml               # Standalone extracted-repo CI pipeline
│       └── release.yml          # Release pipeline
├── .planning/
│   └── codebase/                # GSD codebase map documents
├── extension-kind-gate.mjs      # Zero-dependency CI gate script (agent OAS + workflow BPMN validation)
├── package.json                 # npm package manifest (cinatra agent metadata, dependencies)
├── tsconfig.json                # TypeScript config (targets src/ — no src/ currently exists)
├── .npmrc                       # npm registry configuration
├── LICENSE                      # Apache-2.0
└── README.md                    # Repository documentation
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Platform-side artifacts consumed by the Cinatra runtime
- Contains: `oas.json` — the full flow definition in agentspec v26.1.0 format
- Key files: `cinatra/oas.json`

**`skills/email-recipient-selection/`:**
- Purpose: LLM behavioral specification; consumed as the system prompt by the ApiNode in the flow
- Contains: `SKILL.md` — step-by-step execution protocol, tool discipline, error handling rules, output contract
- Key files: `skills/email-recipient-selection/SKILL.md`

**`.github/workflows/`:**
- Purpose: Extracted-repo CI/CD pipelines
- Contains: `ci.yml` (build, typecheck, test, OAS validation), `release.yml` (publish)
- Key files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents for planner/executor agents
- Generated: Yes (by gsd-map-codebase)
- Committed: Yes

## Key File Locations

**Entry Points:**
- `cinatra/oas.json`: Flow entry — StartNode `start` receives `campaignId`, `agent_run_id`, `accountScope`

**Configuration:**
- `package.json`: Package name (`@cinatra-ai/email-recipient-selection-agent`), version, cinatra metadata (kind: `agent`, runtime dependencies)
- `tsconfig.json`: TypeScript compiler config (ES2023, ESNext modules, strict, targets `src/` which does not currently exist)
- `.npmrc`: Registry configuration (do not read contents)

**Core Logic:**
- `skills/email-recipient-selection/SKILL.md`: All agent business logic — CRM resolution, filtering, cap enforcement, persistence protocol
- `cinatra/oas.json`: Flow structure — node types, HITL renderers, data wiring, LLM model preference (`gpt-5.5`), system/user prompts baked into ApiNode `data`

**CI / Validation:**
- `extension-kind-gate.mjs`: Self-contained gate — exports `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate`, `findWorkflowSidecars`
- `.github/workflows/ci.yml`: Invokes `extension-kind-gate.mjs --package-root .` in `kind-gates` job

## Naming Conventions

**Files:**
- Platform artifacts: lowercase with extension, under `cinatra/` (e.g., `oas.json`)
- Skill prompts: `SKILL.md` (uppercase) under `skills/<skill-name>/`
- Gate scripts: kebab-case `.mjs` at repo root (e.g., `extension-kind-gate.mjs`)
- Workflows: lowercase kebab-case `.yml` (e.g., `ci.yml`, `release.yml`)

**Directories:**
- Skill directories: kebab-case matching the agent/skill name (e.g., `email-recipient-selection`)
- Platform dir: `cinatra/` (fixed convention for all Cinatra extension repos)

**Package naming:**
- Agent packages: `@cinatra-ai/<slug>-agent` (e.g., `@cinatra-ai/email-recipient-selection-agent`)
- Workflow packages: `@cinatra-ai/<slug>-workflow` (enforced by `extension-kind-gate.mjs`)

## Where to Add New Code

**New LLM behavior / prompt changes:**
- Edit: `skills/email-recipient-selection/SKILL.md`
- Also update: the `data.system` field in the ApiNode `generate` inside `cinatra/oas.json` (the two must stay in sync — the OAS system prompt is the baked-in runtime version; SKILL.md is the source-of-truth for human editing)

**New flow nodes or edges:**
- Edit: `cinatra/oas.json` — add to `nodes`, `control_flow_connections`, `data_flow_connections`, and `$referenced_components`

**New TypeScript utilities or tests:**
- Create: `src/` directory (currently absent; `tsconfig.json` is pre-configured to compile `src/**/*.ts`)
- Tests: `src/__tests__/` or co-located `*.test.ts` files (no test runner configured in `package.json` yet)

**New CI validation rules:**
- Edit: `extension-kind-gate.mjs` — add to `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, or add new validator functions

**New skills (if this repo expands):**
- Create: `skills/<new-skill-name>/SKILL.md`

## Special Directories

**`cinatra/`:**
- Purpose: Cinatra platform artifact directory; consumed directly by the runtime/marketplace
- Generated: Partially (may be updated by monorepo extraction scripts)
- Committed: Yes

**`skills/`:**
- Purpose: LLM skill prompt library for this agent
- Generated: No (human-authored)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning documents
- Generated: Yes (by GSD tooling)
- Committed: Yes

---

*Structure analysis: 2026-06-09*
