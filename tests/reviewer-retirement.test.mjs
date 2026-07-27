// Reviewer/auditor retirement ratchet + user-control-point guard for this flow.
//
// Context: cinatra#2047 (row 8) / cinatra#1796. Core now intercepts the artifact
// lifecycle itself, so a producing agent carries NO review code and NO runtime
// edge to a review agent. This flow's remaining coupling to the retired reviewer
// agent package (a REQUIRED runtime dependency, a stale hitlScreens pin, a
// reviewer-namespaced a2ui surface id) was removed; these tests keep it removed.
//
// The retired package names are never spelled literally anywhere in this file —
// they are assembled from parts below — so the ratchet can scan every tracked
// file INCLUDING itself without tripping on its own documentation.
//
// The second half is the important half. This flow's "Review and approve" gate is
// NOT a review-agent invocation — it is the flow's OWN re-entrant, editing-heavy
// HITL gate (pack-served renderer, cinatra#1960), and it is the operator's only
// opportunity to drop recipients before the reviewed selection is finalized. (The
// generated pool is written to the run's own objects store BEFORE the gate by
// design; what the gate holds back is the REVIEWED update, which is the set every
// downstream stage reads.) Core's async effects-gated hold does not cover it — the
// protected write is LOCAL, a destination-class `none` objects update, so there is
// no external effect to hold — so the hold has to stay exactly where it is. A
// future cleanup that
// deletes the gate "because core reviews now" would silently remove the operator's
// approve/reject opportunity; these assertions fail loudly instead.
//
// Zero-dependency by design: this repo declares no host-internal @cinatra-ai/*
// peers, so its standalone CI runs the full install + test path with nothing on
// the registry. Node's built-in test runner is the whole toolchain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (rel) => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const manifest = readJson("package.json");
const oas = readJson("cinatra/oas.json");

// The retired identities, assembled at runtime so the literals never appear in
// this file — the ratchet can then scan EVERY tracked file including itself.
const SCOPE = "@cinatra-ai";
const RETIRED = ["reviewer-agent", "auditor-agent"].map((n) => `${SCOPE}/${n}`);

// EXACT-IDENTITY matching (cinatra#2047 row 8): a trailing boundary so a longer
// package name can never satisfy the ratchet, and so unrelated packages that
// merely CONTAIN the word "reviewer" are excluded by construction. The boundary
// excludes `.` as well as word characters and `-`, because a dot is legal in an
// npm package name — without it, a genuinely distinct `…-agent.v2` would be
// misreported as the retired identity.
const identityRe = (pkg) =>
  new RegExp(`${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "g");

const trackedFiles = () =>
  execFileSync("git", ["-C", REPO_ROOT, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

test("exact-identity ratchet: no tracked file references a retired review agent", () => {
  const offenders = [];
  for (const rel of trackedFiles()) {
    let text;
    try {
      text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    } catch {
      continue; // unreadable / binary — nothing to assert
    }
    for (const pkg of RETIRED) {
      if (identityRe(pkg).test(text)) offenders.push(`${rel} → ${pkg}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `retired review-agent references must be zero; found:\n${offenders.join("\n")}`,
  );
});

test("the ratchet excludes substring false positives by construction", () => {
  // Guard the guard: a differently-scoped package whose name merely CONTAINS
  // "reviewer-agent" must not be mistaken for the retired identity, and a longer
  // name must not satisfy the boundary.
  const decoys = [`${SCOPE}/code-reviewer-agent`, `${SCOPE}/security-reviewer-agent`];
  for (const decoy of decoys) {
    assert.equal(identityRe(RETIRED[0]).test(decoy), false, `${decoy} must not match`);
  }
  assert.equal(identityRe(RETIRED[0]).test(`${RETIRED[0]}-v2`), false);
  assert.equal(identityRe(RETIRED[0]).test(`${RETIRED[0]}.v2`), false);
  assert.equal(identityRe(RETIRED[0]).test(`"${RETIRED[0]}"`), true);
});

test("the manifest carries no dependency edge on a retired review agent", () => {
  // Deliberately NOT an exact-[] assertion: this flow may legitimately gain an
  // unrelated dependency later, and a ratchet that broke on that would be noise.
  // What must stay true is the shape and the absence of the retired identities.
  const deps = manifest.cinatra.dependencies;
  // "No dependencies" is spelled [] — an absent key reads as undeclared and an
  // explicit null is malformed at install (the host's dual-read rule).
  assert.ok(Array.isArray(deps), "cinatra.dependencies must be an array");
  for (const dep of deps) {
    assert.equal(
      RETIRED.includes(dep.packageName),
      false,
      `${dep.packageName} is a retired review agent and must not be a dependency`,
    );
  }
  // The legacy agentDependencies map must go WITH the canonical edge: a legacy
  // name the canonical array does not carry is an install-time CONFLICT. This
  // flow declares no agent edges at all, so the legacy key must be absent.
  assert.equal("agentDependencies" in manifest.cinatra, false);
});

test("no a2ui surface id sits in a review agent's namespace", () => {
  const surfaces = JSON.stringify(oas).match(/"a2uiSurfaceId":\s*"([^"]*)"/g) ?? [];
  assert.notEqual(surfaces.length, 0, "the flow should still declare surface ids");
  for (const s of surfaces) {
    assert.equal(/"reviewer:/.test(s), false, `${s} still uses the reviewer namespace`);
  }
});

test("hitlScreens names exactly the renderers this flow's own nodes declare", () => {
  // Every node that declares a renderer IS a HITL node — a renderer is what a gate
  // shows the operator — so the declared-renderer set and the advertised-screen
  // set have to be the same set, in both directions.
  const screens = oas.metadata.cinatra.hitlScreens;
  const rendered = Object.values(oas.$referenced_components)
    .map((n) => n?.metadata?.cinatra?.renderer)
    .filter(Boolean);
  for (const screen of screens) {
    assert.ok(
      rendered.includes(screen),
      `hitlScreens advertises ${screen}, which no gate in this flow renders`,
    );
  }
  assert.deepEqual([...screens].sort(), [...new Set(rendered)].sort());
});

// ---------------------------------------------------------------------------
// The user's control point. See the header: core cannot hold this flow's write,
// so the flow's own gate IS the hold.
// ---------------------------------------------------------------------------

test("the operator's approve/reject gate survives", () => {
  const gate = oas.$referenced_components.approval_gate;
  assert.ok(gate, "approval_gate must exist — it is the operator's only say");
  assert.equal(gate.component_type, "InputMessageNode");
  assert.equal(gate.metadata.cinatra.requiresApproval, true);
  assert.equal(gate.metadata.cinatra.riskClass, "approval");
  // Self-namespaced, and pinned to the EXACT id: a namespace-only check would let
  // a typo'd or nonexistent renderer through, and the gate would render nothing.
  assert.equal(
    gate.metadata.cinatra.renderer,
    `${manifest.name}:campaign-recipients-review`,
  );
  // Editing-heavy: the gate is fed the generated set and returns the operator's
  // response, which is what the persist step consumes.
  assert.ok(gate.inputs.some((i) => i.title === "confirmedRecipients"));
  assert.ok(gate.outputs.some((o) => o.title === "userResponse"));
});

test("the gate still holds the run between generation and persistence", () => {
  const edges = oas.control_flow_connections.map((e) => [
    e.from_node.$component_ref,
    e.to_node.$component_ref,
  ]);
  const edge = (from, to) => edges.some(([f, t]) => f === from && t === to);
  assert.ok(edge("generate", "approval_gate"), "generation must reach the gate");
  assert.ok(edge("approval_gate", "apply"), "persistence must sit behind the gate");

  // REACHABILITY, not just the direct edge: delete the gate from the graph and
  // `apply` must become unreachable from `generate`. A future refactor that routes
  // around the gate through any number of intermediate nodes fails here.
  const reachableWithoutGate = () => {
    const seen = new Set(["generate"]);
    const queue = ["generate"];
    while (queue.length > 0) {
      const node = queue.shift();
      for (const [f, t] of edges) {
        if (f !== node || t === "approval_gate" || seen.has(t)) continue;
        seen.add(t);
        queue.push(t);
      }
    }
    return seen;
  };
  assert.equal(
    reachableWithoutGate().has("apply"),
    false,
    "no path may reach persistence from generation without passing the approval gate",
  );

  // The persist step is driven by the gate's own ANSWER, so it cannot run on an
  // unanswered gate: the gate's userResponse — the operator's removals — is what
  // arrives as the resume payload.
  const wired = oas.data_flow_connections.some(
    (d) =>
      d.source_node.$component_ref === "approval_gate" &&
      d.source_output === "userResponse" &&
      d.destination_node.$component_ref === "apply" &&
      d.destination_input === "resumePayload",
  );
  assert.ok(wired, "apply must consume the gate's userResponse as its resume payload");
});
