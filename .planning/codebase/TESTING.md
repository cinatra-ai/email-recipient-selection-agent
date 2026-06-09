# Testing Patterns

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo (no `src/` application code). The only testable runtime logic is in `extension-kind-gate.mjs`. No test framework, test runner, or test files are present in the repo. The CI pipeline delegates testing responsibility:

- **Source-mirror repos** (repos with host-internal `@cinatra-ai/*` optional peers — which this repo IS): standalone `pnpm test` is skipped in CI. The cinatra monorepo owns install, typecheck, and test execution.
- **Standalone repos** (0 first-party deps): `corepack pnpm test --if-present` is run in CI.

This repo is classified as a **source mirror** (see `package.json` `cinatra.dependencies` referencing `@cinatra-ai/reviewer-agent`), so no standalone test run occurs.

## Test Framework

**Runner:**
- Not configured. No `jest.config.*`, `vitest.config.*`, or `mocha` config detected.
- No `test` script in `package.json`.

**Assertion Library:**
- Not applicable.

**Run Commands:**
```bash
# No test commands available standalone.
# CI delegates: "Skipping standalone tests (host-internal @cinatra-ai/* peers — the cinatra monorepo runs these)."
```

## Test File Organization

**Location:**
- No test files present in the repo at any path.

**Naming:**
- Not applicable.

## CI Gate as the Primary Quality Check

In place of unit tests, this repo uses `extension-kind-gate.mjs` as a self-contained CI validation script. It runs as the `Agent OAS validation gate` step in `.github/workflows/ci.yml`:

```bash
node extension-kind-gate.mjs --package-root .
```

**What the gate validates:**
- `cinatra/oas.json` parses as valid JSON
- No retired CRM primitives (`lists_list`, `lists_get`, `accounts_list`, `contacts_list`, etc.) appear in LLM-visible OAS fields (`system`, `user`, `description`)
- No banned `typeHint` values (`@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`) appear in LLM-visible strings
- No `objects_list` over a CRM entity type appears in LLM-visible strings

**Gate is pure / side-effect-free by design:**
All validator functions (`validateAgent`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`) return `string[]` errors and have no side effects, making them directly unit-testable if a test suite is added.

## How the Gate Is Structured for Testability

The gate exports named functions specifically so the monorepo test suite can import and unit-test them:

```javascript
// Importable without executing main() — guarded by invokedDirectly check:
import {
  parseArgs,
  validateAgent,
  validateWorkflowPackageShape,
  validateBpmnSanity,
  findWorkflowSidecars,
  validateWorkflow,
  runGate,
} from "./extension-kind-gate.mjs";
```

**`main()` isolation pattern:**
```javascript
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main();
}
```
This ensures importing the module in tests does not trigger `process.exit`.

## Mocking

**Framework:** Not applicable — no test suite.

**Anticipated pattern (if tests were added):**
- `validateAgent` and `validateBpmnSanity` are pure functions (string in → string[] out) requiring no mocks
- `validateWorkflow` and `findWorkflowSidecars` read the filesystem via `readFileSync`/`readdirSync` — would require either a real temp directory fixture or a mock of `node:fs`

## Fixtures and Factories

**Test Data:**
- Not applicable — no test suite.

**If added:** OAS JSON fixtures and BPMN XML strings would be the primary fixtures, passed directly to the pure validator functions.

## Coverage

**Requirements:** Not enforced. No coverage tooling configured.

**View Coverage:**
```bash
# Not available — no test runner configured.
```

## Test Types

**Unit Tests:**
- Not present. The gate's pure functions (`validateAgent`, `validateBpmnSanity`, `validateWorkflowPackageShape`) are the natural unit test targets.

**Integration Tests:**
- Not present.

**E2E Tests:**
- Not applicable.

## CI Pipeline Quality Gates

While no test suite exists, the CI pipeline (`.github/workflows/ci.yml`) enforces the following quality checks on every push/PR to `main`:

1. **Dependency shape validation** — ensures no `@cinatra-ai/*` packages leak into `dependencies`/`devDependencies`; first-party packages must be optional `peerDependencies`
2. **Pack dry-run** — `npm pack --dry-run` validates publish payload shape
3. **Agent OAS validation gate** — `node extension-kind-gate.mjs --package-root .` scans for retired CRM primitives in LLM-visible strings
4. **Typecheck** — skipped for source mirrors (monorepo owns it), but config is present in `tsconfig.json` for future `src/` additions

---

*Testing analysis: 2026-06-09*
