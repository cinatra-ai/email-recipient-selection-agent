// Lifecycle D W8 — the email recipient-selection agent's own steps
// (cinatra#3096 items 8, 10 and 19).
//
// (8) The campaign id is plumbing on this agent: a flow supplies it, so it is
// hidden and never listed as required, and every hidden input carries a
// default so nothing hidden is also demanded.
//
// (10) The run stops for the person twice — the scope pick and the recipient
// review — and both pauses are declared: each is an input step carrying the
// approval flag, the flow names both renderers, and the manifest claims the
// gates its flow has.
//
// (19) A run that ends closes with a plain sentence — how many recipients were
// confirmed, or that none were because the list gave nothing or every
// recipient was removed in the review — never with the raw values the run
// hands on.
//
// The last two arms re-state the runtime loader's two mount rules over this
// flow, as cinatra-ai/email-outreach-agent holds them in its own suite: (A)
// every input a step requires has a source on every path that reaches it, and
// (B) an OutputMessageNode declares only inputs its template reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const startNode = () => {
  const [start] = nodesOfType("StartNode");
  assert.ok(start, "the flow has no start node");
  return start;
};
const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
  branch: e.from_branch,
}));
const hasEdge = (from, to) => controlEdges.some((e) => e.from === from && e.to === to);
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const countDataEdges = (from, to) => dataEdges.filter(([f, t]) => f === from && t === to).length;
const outsideComment = (message) => String(message ?? "").replace(/\{#[\s\S]*?#\}/g, "");

// ---------------------------------------------------------------------------
// (8) the campaign id stays plumbing: hidden, not required, never demanded
// ---------------------------------------------------------------------------

test("(8) nothing hidden is also demanded: every hidden input carries a default", () => {
  const start = startNode();
  const hidden = start.metadata?.cinatra?.hidden ?? [];
  assert.ok(hidden.includes("campaignId"), "the campaign id is not hidden plumbing");
  const flowInputs = new Map((oas.inputs ?? []).map((i) => [i.title, i]));
  const startInputs = new Map((start.inputs ?? []).map((i) => [i.title, i]));
  const missing = [];
  for (const title of hidden) {
    if (!Object.hasOwn(startInputs.get(title) ?? {}, "default")) missing.push(`start.${title}`);
    if (!Object.hasOwn(flowInputs.get(title) ?? {}, "default")) missing.push(`flow.${title}`);
  }
  assert.deepEqual(missing, [], "a hidden input has no default, so the run would demand it: " + missing.join(", "));
});

test("(8) the campaign id is plumbing: hidden, not required", () => {
  const meta = startNode().metadata?.cinatra ?? {};
  assert.ok((meta.hidden ?? []).includes("campaignId"), "the campaign id is not hidden");
  assert.ok(!(meta.required ?? []).includes("campaignId"), "the campaign id is still listed as required");
});

// ---------------------------------------------------------------------------
// (10) the two pauses — the scope and the recipient review — declared
// ---------------------------------------------------------------------------

test("(10) its two pauses, the scope and the recipient review, are declared and exist", () => {
  const pauses = nodesOfType("InputMessageNode");
  assert.deepEqual(pauses.map((n) => n.id).sort(), ["approval_gate", "scope_gate"]);
  assert.deepEqual(oas.metadata.cinatra.hitlScreens, [
    refs.scope_gate.metadata.cinatra.renderer,
    refs.approval_gate.metadata.cinatra.renderer,
  ]);
  for (const gate of pauses) {
    assert.equal(gate.metadata?.cinatra?.requiresApproval, true, `the "${gate.id}" pause is not declared as a pause`);
  }
  assert.equal(pkg.cinatra.hasApprovalGates, true, "the manifest denies the pauses its flow has");
});

// ---------------------------------------------------------------------------
// (19) a plain-language ending on an empty or failed selection
// ---------------------------------------------------------------------------

test("(19) the run ends in plain language, never in the envelope", () => {
  const summary = refs.selection_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(oas.nodes.some((n) => n.$component_ref === "selection_summary"), "the closing statement is not a step of the flow");
  assert.ok(hasEdge("apply", "selection_summary"), "the run's last step does not pass the closing statement");
  assert.ok(hasEdge("selection_summary", "end"), "the closing statement does not lead to the end");
  assert.ok(!hasEdge("apply", "end"), "the run still jumps straight to its end");
  assert.deepEqual(
    refs.end.outputs.map((o) => o.title),
    ["campaignId", "recipientCount", "confirmedRecipients", "userResponse", "confirmedRecipientsRef"],
    "the end node no longer carries the values the run hands on",
  );
});

test("(19) an empty or failed selection ends in plain language", () => {
  const summary = refs.selection_summary;
  assert.ok(summary, "the run has no closing statement");
  const message = String(summary.message ?? "");
  assert.equal(
    message,
    "{# pyagentspec-input-hint (do not remove): {{ recipientCount }} {{ proposedCount }} #}" +
      "{% if not recipientCount and not proposedCount %}No recipients were selected: the list you picked could not be read, " +
      "was larger than the recipient limit, or held no contact with a name and a company, so nothing was added to the campaign." +
      "{% elif not recipientCount %}No recipients were confirmed: all {{ proposedCount }} proposed recipients were removed in the review." +
      "{% else %}{{ recipientCount }} recipients were confirmed for the campaign.{% endif %}",
    "each outcome does not reach its own sentence: none proposed, all removed, some confirmed",
  );
  assert.match(message, /no recipients were selected/i, "an empty selection has no plain-language ending");
  assert.match(message, /removed in the review/i, "a review that removed everyone has no plain-language ending");
  assert.match(message, /recipients were confirmed/i, "a confirmed selection has no plain-language ending");
  const rendered = outsideComment(message);
  assert.match(rendered, /\brecipientCount\b/, "the sentence never reads the confirmed count");
  assert.match(rendered, /\bproposedCount\b/, "the sentence never reads the proposed count");
  assert.equal(summary.metadata?.cinatra?.purpose, "plain-language-recipient-selection-ending");
  assert.deepEqual(summary.inputs, [
    { title: "recipientCount", type: "integer", default: 0 },
    { title: "proposedCount", type: "integer", default: 0 },
  ]);
  assert.equal(countDataEdges("apply.reviewedCount", "selection_summary.recipientCount"), 1);
  assert.equal(countDataEdges("generate.recipientCount", "selection_summary.proposedCount"), 1);
});

// ---------------------------------------------------------------------------
// (A) every required step input has a source on every path that reaches it
// ---------------------------------------------------------------------------

/** The inputs a node CONSUMES: an EndNode names them under `outputs`, every
 *  other node declares `inputs`. */
function consumedInputs(node) {
  if (node.component_type === "EndNode") return node.outputs ?? [];
  return node.inputs ?? [];
}

/** Walk the flow the way the runtime loader does, returning each input it
 *  would demand from the StartStep. */
function unsourcedInputs() {
  const steps = new Map();
  for (const ref of oas.nodes ?? []) steps.set(ref.$component_ref, refs[ref.$component_ref]);
  const beginId = oas.start_node.$component_ref;
  const startTitles = new Set((steps.get(beginId)?.inputs ?? []).map((i) => i.title));
  const flowDataEdges = (oas.data_flow_connections ?? []).map((e) => ({
    from: e.source_node.$component_ref,
    key: `${e.destination_node.$component_ref}.${e.destination_input}`,
  }));
  const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);

  const violations = [];
  const visited = new Map();
  const queue = [[beginId, new Set()]];
  while (queue.length > 0) {
    const [id, incoming] = queue.pop();
    let produced = incoming;
    if (visited.has(id)) {
      const seen = visited.get(id);
      if ([...seen].every((k) => produced.has(k))) continue;
      produced = new Set([...produced].filter((k) => seen.has(k)));
    }
    visited.set(id, produced);

    const node = steps.get(id);
    if (!node) continue;
    if (id !== beginId) {
      for (const descriptor of consumedInputs(node)) {
        const key = `${id}.${descriptor.title}`;
        if (produced.has(key)) continue;
        if (Object.hasOwn(descriptor, "default")) continue;
        if (startTitles.has(descriptor.title)) continue;
        violations.push(key);
      }
    }

    const next = new Set(produced);
    for (const edge of flowDataEdges) if (edge.from === id) next.add(edge.key);
    for (const child of successors(id)) queue.push([child, new Set(next)]);
  }
  return violations;
}

test("every required step input has a source on every path that reaches it", () => {
  const found = unsourcedInputs();
  assert.deepEqual(
    found,
    [],
    "the runtime refuses to mount a flow whose step requires an input the StartStep does not carry: " + found.join(", "),
  );
});

// ---------------------------------------------------------------------------
// (B) an OutputMessageNode declares only inputs its template reads
// ---------------------------------------------------------------------------

test("an output message declares only inputs its template reads", () => {
  const offenders = [];
  for (const node of nodesOfType("OutputMessageNode")) {
    const rendered = outsideComment(node.message);
    for (const { title } of node.inputs ?? []) {
      if (!new RegExp(`\\b${title}\\b`).test(rendered)) offenders.push(`${node.id}.${title}`);
    }
  }
  assert.deepEqual(offenders, [], "the runtime rejects an input the template never reads: " + offenders.join(", "));
});
