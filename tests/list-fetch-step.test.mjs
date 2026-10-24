// The list step's content: the flow reads the CRM's lists itself, before the
// account-scope gate, and hands them to the gate as its content
// (cinatra-ai/cinatra#3562 items 1 and 4).
//
// The application draws the gate; this flow supplies what the gate shows. A
// fetch step calls the CRM connector's `crm_list_search` tool on the run's own
// model-bridge road and returns one `{ id, name }` row for every list the tool
// answers, in the tool's order. An output step then writes those rows as one
// flat JSON object, so the message directly before the gate is that object and
// the application hands its keys to the gate's renderer as they are.
//
// The gate's answer goes through a branch. The declared refresh value (the
// binding's `params.refreshValue`) leads back to the fetch step, so a person
// who has just created a list in the CRM sees it after one more read. Every
// other answer goes on to the recipient fetch.
//
// The fetch step itself is a model step, so this suite cannot run it. It pins
// what is deterministic: the step's declaration and wiring, the shape it is
// asked for, and what the gate is shown for a given fetch answer, including an
// empty one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components ?? {};
const LIST_PICKER_ID = "@cinatra-ai/email-outreach-agent:list-picker";
const binding = (pkg.cinatra?.fieldRenderers ?? []).find((r) => r.id === LIST_PICKER_ID);

const FETCH = "fetch_lists";
const EMIT = "emit_lists";
const GATE = "scope_gate";
const BRANCH = "scope_branch";
const SEARCH_CALL = 'crm_list_search({ query: "", objectType: "contact" })';

const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
  branch: e.from_branch ?? null,
}));
const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);
const predecessors = (id) => controlEdges.filter((e) => e.to === id).map((e) => e.from);
const dataEdges = (oas.data_flow_connections ?? []).map((e) => ({
  from: e.source_node.$component_ref,
  output: e.source_output,
  to: e.destination_node.$component_ref,
  input: e.destination_input,
}));
const hasDataEdge = (from, output, to, input) =>
  dataEdges.some((e) => e.from === from && e.output === output && e.to === to && e.input === input);

/**
 * Renders the output step's message for the given inputs. It models the two
 * template forms the message may use, a `{# ... #}` comment and
 * `{{ name | tojson }}`, and refuses any other form, so a message this reading
 * does not understand fails here instead of passing. Jinja's `tojson` escapes
 * `<`, `>`, `&` and `'` as unicode escapes; JSON.stringify does not. Both parse
 * to the same value, and the suite compares parsed values only.
 */
function renderMessage(template, vars) {
  const withoutComments = String(template).replace(/\{#[\s\S]*?#\}/g, "");
  const rendered = withoutComments.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*tojson\s*\}\}/g,
    (_, name) => {
      if (!Object.hasOwn(vars, name)) throw new Error(`the message reads "${name}", which no data edge supplies`);
      return JSON.stringify(vars[name]);
    },
  );
  if (/\{\{|\{%|\{#/.test(rendered)) {
    throw new Error(`the message uses a template form this reading does not model: ${rendered}`);
  }
  return rendered;
}

/**
 * What the fetch step returns for a tool answer, as its prompt asks: one row of
 * the step's declared row members for every list the tool answered, in order.
 */
function fetchAnswerFor(toolAnswer, listsRead = "ok") {
  const output = (refs[FETCH]?.outputs ?? []).find((o) => o.title === "lists");
  const members = Object.keys(output?.json_schema?.items?.properties ?? {});
  return {
    lists: toolAnswer.map((entry) => Object.fromEntries(members.map((key) => [key, entry[key]]))),
    listsRead,
  };
}

/** The text the gate is shown for a fetch answer, through the flow's own data edges. */
function gateContentText(fetchAnswer) {
  const vars = {};
  for (const edge of dataEdges) {
    if (edge.from === FETCH && edge.to === EMIT) vars[edge.input] = fetchAnswer[edge.output];
  }
  return renderMessage(refs[EMIT]?.message, vars);
}

/** The step the run takes after the gate, for a given answer of the gate. */
function stepAfterGate(answer) {
  const branch = refs[BRANCH];
  const mapping = branch?.mapping ?? {};
  const name = Object.hasOwn(mapping, answer) ? mapping[answer] : "default";
  const edges = controlEdges.filter((e) => e.from === BRANCH && (e.branch ?? "default") === name);
  assert.equal(edges.length, 1, `the branch "${name}" does not lead to exactly one step`);
  return edges[0].to;
}

// A stubbed answer of crm_list_search: the connector's list shape, in an order
// that is not sorted by name or id, with names that need escaping.
const TOOL_ANSWER = [
  { id: "view-3", slug: "", name: "Zeta prospects", objectType: "contact" },
  { id: "view-1", slug: "cinatra-q3-founders", name: "All People", objectType: "contact" },
  { id: "view-2", slug: "", name: 'Founders "EU" <2026> & partners', objectType: "contact" },
  { id: "view-0", slug: "", name: "Müller's list", objectType: "contact" },
];

// ---------------------------------------------------------------------------
// The fetch step
// ---------------------------------------------------------------------------

test("a fetch step and an output step run before the account-scope gate", () => {
  const listed = new Set((oas.nodes ?? []).map((n) => n.$component_ref));
  for (const id of [FETCH, EMIT, BRANCH]) assert.ok(listed.has(id), `"${id}" is not a step of the flow`);
  assert.deepEqual(successors("start"), [FETCH], "the run does not read the lists first");
  assert.deepEqual(successors(FETCH), [EMIT]);
  assert.deepEqual(successors(EMIT), [GATE]);
  assert.deepEqual(
    [...predecessors(GATE)].sort(),
    [EMIT],
    "the message directly before the gate is not always the list content",
  );
  assert.equal(refs[EMIT]?.component_type, "OutputMessageNode");
});

test("the fetch step calls crm_list_search on the run's model-bridge road, and nothing else", () => {
  const step = refs[FETCH];
  assert.ok(step, "the flow has no fetch step");
  assert.equal(step.component_type, "ApiNode");
  assert.equal(step.url, "{{CINATRA_BASE_URL}}/api/llm-bridge");
  assert.equal(step.http_method, "POST");
  assert.equal(step.data?.agent_id, "email-recipient-selection");
  assert.equal(step.data?.agent_run_id, "{{ agent_run_id }}");
  assert.deepEqual(step.data?.cinatra_llm, refs.generate?.data?.cinatra_llm);
  assert.ok(hasDataEdge("start", "agent_run_id", FETCH, "agent_run_id"), "the fetch step does not get the run id");
  assert.deepEqual(step.metadata?.cinatra?.tools, ["crm_list_search"]);
  const system = String(step.data?.system ?? "");
  assert.equal(system.split(SEARCH_CALL).length, 2, `the prompt does not name ${SEARCH_CALL} exactly once`);
  const toolNames = new Set(system.match(/\b(?:crm|objects|lists|contacts|accounts)_[a-z_]+\b/g) ?? []);
  assert.deepEqual([...toolNames], ["crm_list_search"], "the prompt names another tool");
  assert.match(system, /every list/i);
  assert.match(system, /in the order the tool answered/i);
  assert.match(system, /"listsRead":"ok"/);
  assert.match(system, /"listsRead":"failed"/);
});

test("the fetch step is a read with no gate of its own", () => {
  const meta = refs[FETCH]?.metadata?.cinatra ?? {};
  assert.equal(meta.riskClass, "read_only");
  assert.equal(meta.requiresApproval, false);
  assert.equal(Object.hasOwn(meta, "renderer"), false, "the fetch step declares a renderer, so it would be drawn as a step");
});

test("the fetch step declares the { id, name } rows it is asked for", () => {
  const outputs = refs[FETCH]?.outputs ?? [];
  assert.deepEqual(outputs.map((o) => o.title), ["lists", "listsRead"]);
  const lists = outputs[0];
  assert.equal(lists.type, "array");
  assert.equal(lists.json_schema?.items?.type, "object");
  assert.deepEqual(lists.json_schema?.items?.properties, {
    id: { type: "string" },
    name: { type: "string" },
  });
  assert.equal(outputs[1].type, "string");
});

// ---------------------------------------------------------------------------
// The gate's content
// ---------------------------------------------------------------------------

test("the gate content lists every list of the tool answer, in order", () => {
  const text = gateContentText(fetchAnswerFor(TOOL_ANSWER));
  // The application hands the keys of the message before a gate to its
  // renderer only when the whole trimmed text is one plain JSON object.
  const trimmed = text.trim();
  assert.ok(trimmed.startsWith("{") && trimmed.endsWith("}"), "the gate content is not one JSON object");
  const content = JSON.parse(trimmed);
  assert.deepEqual(content, {
    lists: [
      { id: "view-3", name: "Zeta prospects" },
      { id: "view-1", name: "All People" },
      { id: "view-2", name: 'Founders "EU" <2026> & partners' },
      { id: "view-0", name: "Müller's list" },
    ],
    listsRead: "ok",
  });
});

test("an empty tool answer gives an empty list as the gate content", () => {
  const content = JSON.parse(gateContentText(fetchAnswerFor([])));
  assert.deepEqual(content.lists, []);
  assert.equal(content.listsRead, "ok");
});

test("a failed read is told apart from an empty CRM", () => {
  const content = JSON.parse(gateContentText(fetchAnswerFor([], "failed")));
  assert.deepEqual(content, { lists: [], listsRead: "failed" });
});

test("the output step's message reads only what the fetch step hands it", () => {
  const step = refs[EMIT];
  assert.deepEqual(
    (step.inputs ?? []).map((i) => i.title),
    ["lists", "listsRead"],
  );
  assert.ok(hasDataEdge(FETCH, "lists", EMIT, "lists"));
  assert.ok(hasDataEdge(FETCH, "listsRead", EMIT, "listsRead"));
  assert.equal(step.metadata?.cinatra?.purpose, "list-picker-gate-content");
});

// ---------------------------------------------------------------------------
// The refresh road
// ---------------------------------------------------------------------------

test("the declared refresh value re-enters the fetch step", () => {
  const refresh = binding?.params?.refreshValue;
  assert.equal(refresh, "refresh");
  assert.deepEqual(successors(GATE), [BRANCH], "the gate's answer does not go through the branch");
  const branch = refs[BRANCH];
  assert.equal(branch?.component_type, "BranchingNode");
  assert.deepEqual((branch.inputs ?? []).map((i) => i.title), ["accountScope"]);
  assert.ok(hasDataEdge(GATE, "accountScope", BRANCH, "accountScope"), "the branch does not read the gate's answer");
  assert.ok((branch.branches ?? []).includes("default"));
  assert.equal(stepAfterGate(refresh), FETCH, "the refresh value does not lead back to the fetch step");
  // The fetch step leads to the gate again, with fresh content.
  assert.deepEqual(successors(FETCH), [EMIT]);
  assert.deepEqual(successors(EMIT), [GATE]);
});

test("a picked scope goes on to the recipient fetch, and a refresh never does", () => {
  const picked = JSON.stringify({
    type: "list",
    listIds: ["view-1", "view-2"],
    listNames: ["All People", 'Founders "EU" <2026> & partners'],
    snapshotAt: "2026-10-24T09:00:00.000Z",
  });
  assert.equal(stepAfterGate(picked), "generate");
  assert.equal(stepAfterGate(""), "generate");
  assert.equal(
    controlEdges.some((e) => e.from === GATE && e.to === "generate"),
    false,
    "the gate still leads straight to the recipient fetch, so a refresh value would reach it",
  );
  assert.deepEqual(Object.values(refs[BRANCH]?.mapping ?? {}).length, 1, "the branch maps more than the refresh value");
});
