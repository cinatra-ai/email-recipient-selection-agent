# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JSON — agent flow specification (`cinatra/oas.json`), package manifest (`package.json`)
- JavaScript (ESM) — CI/gate tooling (`extension-kind-gate.mjs`)

**Secondary:**
- TypeScript — declared as compile target in `tsconfig.json` (ES2023/ESNext); no `src/` TypeScript files are tracked in this extracted repo. The monorepo builds and typechecks TypeScript; this repo is a source mirror.
- Markdown — skill prompt spec (`skills/email-recipient-selection/SKILL.md`)

## Runtime

**Environment:**
- Node.js 24 (specified in `.github/workflows/ci.yml` via `actions/setup-node@v4`)

**Package Manager:**
- pnpm (via corepack, enabled in CI)
- `.npmrc` present — sets `auto-install-peers=false`
- No committed lockfile (CI uses `--no-frozen-lockfile`)

## Frameworks

**Core:**
- Cinatra Agent Framework — `cinatra.apiVersion: "cinatra.ai/v1"`, `kind: "agent"`, `agentspec_version: 26.1.0` (in `cinatra/oas.json`)
- No web framework, no React, no Express. This is a pure agent extension.

**Testing:**
- Not applicable — no test files exist in this extracted source mirror. Tests run in the monorepo.

**Build/Dev:**
- `extension-kind-gate.mjs` — zero-dependency, Node-builtin-only CI gate for validating `cinatra/oas.json` and scanning for retired CRM primitives.

## Key Dependencies

**Critical:**
- `@cinatra-ai/reviewer-agent` `^0.1.0` — declared as a `cinatra.agentDependencies` runtime edge dependency (required); referenced as the HITL approval renderer (`@cinatra-ai/reviewer-agent:contacts-output`) in the flow approval gate node.

**Infrastructure:**
- No npm `dependencies`, `devDependencies`, or `optionalDependencies` are declared in `package.json`. All `@cinatra-ai/*` packages are monorepo-internal and provided by the host workspace, not a public registry.

## Configuration

**Environment:**
- `CINATRA_BASE_URL` — referenced in `cinatra/oas.json` as `{{CINATRA_BASE_URL}}/api/llm-bridge` (the LLM bridge API endpoint). Must be set in the runtime environment.
- No `.env` files present.

**Build:**
- `tsconfig.json` — standalone strict TypeScript config targeting `ES2023`, `ESNext` modules, `bundler` module resolution, outputs to `dist/`, roots in `src/`. Used if TypeScript sources are added.

**Package:**
- `package.json` — package name `@cinatra-ai/email-recipient-selection-agent`, version `0.1.0`, `"type": "module"` (ESM), license Apache-2.0.

## Platform Requirements

**Development:**
- Node.js 24
- pnpm (corepack)
- Access to the cinatra monorepo workspace for TypeScript resolution and test execution

**Production:**
- Deployed via the Cinatra Marketplace. Release triggered by a GitHub Release tag matching `v<package.json.version>`.
- Publish flow: `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml` — submits through marketplace MCP proxy, never a direct registry publish.
- Requires `CINATRA_MARKETPLACE_VENDOR_TOKEN` org secret (GitHub Actions).

---

*Stack analysis: 2026-06-09*
