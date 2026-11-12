// The list step's content: the flow reads the CRM's lists itself, before the
// account-scope gate, and hands them to the gate as its content
// (cinatra-ai/cinatra#3562 items 1 and 4).
//
// The application draws the gate; this flow supplies what the gate shows. A
// fetch step is told to call the CRM connector's `crm_list_search` tool on the
// run's own model-bridge road and to return one `{ id, name }` row for every
// list the tool answers, in the tool's order. An output step then writes those
// rows as one flat JSON object, so the message directly before the gate is that
// object and the application hands its keys to the gate's renderer as they are.
//
// The gate's answer goes through a branch. The declared refresh value (the
// binding's `params.refreshValue`) leads back to the fetch step, so the lists
// are read again. Every other string answer goes on to the recipient fetch,
// whose own prompt refuses an answer that is not a JSON object, and a scope
// that is not a list scope with list ids. How the runtime branches on an
// answer that is not a string is not read in this repository.
//
// The fetch step itself is a model step, so this suite cannot run it. It pins
// what is deterministic: the step's declaration and wiring, the shape it is
// asked for, the prompt's rules by their text, and what the gate is shown for a
// given fetch answer, including an empty one. What the model does with a tool
// answer is the prompt's promise, not a result of this suite.

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

// The fetch step's whole prompt, word for word. A rule added anywhere in it (a
// second call, another tool) or a rule taken out fails the exact-text test.
const FETCH_SYSTEM = [
  "You are the CRM list fetch step of a campaign recipient selection. Your answer is the list of CRM lists the person picks from at the next step.",
  'Step 1: Call crm_list_search({ query: "", objectType: "contact" }) exactly once. Call no other tool. Its answer is an array of lists; each list carries an id and a name.',
  'Step 2: Return ONLY this JSON: {"lists":[{"id":"<id>","name":"<name>"}],"listsRead":"ok"}. "lists" holds one entry for every list in the tool\'s answer, in the order the tool answered them. Leave out an entry that has no text id or no text name; it cannot be picked. Apart from that, do not filter, sort, merge, rename or add an entry. Two lists with the same name stay two entries. Copy each id and each name exactly as the tool answered it. When the tool answers an empty array, return {"lists":[],"listsRead":"ok"}.',
  'Step 3: When the tool call fails, or its answer is not an array, return {"lists":[],"listsRead":"failed"}. Do not describe the error and do not guess any list.',
].join("\n\n");
const FETCH_USER = "Read the CRM lists now and return the result as JSON.\nInputs:\n- agent_run_id: {{ agent_run_id }}";

// The recipient fetch's save rule. Step 5 saves the recipients with
// objects_save before the step returns its JSON; an error JSON of Step 1 or of
// the recipient limit is the exception and is returned at once, without
// objects_save. Each of the two sentences names that exception, so the refusals
// of Step 1 ("call no tool") are not contradicted by a later rule.
const SAVE_EXCEPTION = ", except an error JSON of Step 1 or of the recipient limit";
const SAVE_RULE = "Step 5 — CRITICAL: Call objects_save BEFORE returning any JSON" + SAVE_EXCEPTION + ".";
const SAVE_CLOSE =
  "Do NOT return JSON before completing Step 5" + SAVE_EXCEPTION + ": such an error is returned at once, without objects_save.";

// The recipient fetch's rule for an answer that is not a JSON object (a near
// miss of the refresh value, an empty answer, null, an array). It stands
// directly after the first sentence of the recipient fetch's Step 1.
const UNPARSED_SCOPE_RULE =
  "If accountScope does not parse as JSON, or parses to anything but a JSON object (for example an empty answer, " +
  'a bare word such as Refresh, null or an array), return {"error":"unsupported_account_scope","scopeType":"unparsed",' +
  '"summary":"Only list-sourced recipient selection is supported; pick a saved CRM list."} and call no tool. ';

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

test("the fetch step is told to call crm_list_search only, on the run's model-bridge road", () => {
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
  // Every snake_case word, so a tool of any name (web_search) is caught.
  const toolNames = new Set(system.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
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

test("a row must carry an id and a name and no other member", () => {
  const items = (refs[FETCH]?.outputs ?? []).find((o) => o.title === "lists")?.json_schema?.items ?? {};
  assert.deepEqual(items.required, ["id", "name"], "a row without an id or a name is not refused by the declaration");
  assert.equal(items.additionalProperties, false, "a row may carry members the picker is not given (slug, objectType)");
});

test("listsRead is declared as one of ok and failed", () => {
  const listsRead = (refs[FETCH]?.outputs ?? []).find((o) => o.title === "listsRead");
  assert.deepEqual(listsRead?.json_schema?.enum, ["ok", "failed"]);
});

test("the fetch prompt states each rule for the tool's answer in full", () => {
  const system = String(refs[FETCH]?.data?.system ?? "");
  // An error or a non-array answer is a failed read, and only that.
  assert.ok(
    system.includes(
      'Step 3: When the tool call fails, or its answer is not an array, return {"lists":[],"listsRead":"failed"}. Do not describe the error and do not guess any list.',
    ),
    "the failure rule of Step 3 changed",
  );
  // An empty array is an empty CRM, not a failed read.
  assert.ok(system.includes('When the tool answers an empty array, return {"lists":[],"listsRead":"ok"}.'));
  // A row that cannot be picked is left out; nothing else is.
  assert.ok(
    system.includes("Leave out an entry that has no text id or no text name; it cannot be picked."),
    "the prompt has no rule for an entry without an id or a name",
  );
  assert.ok(
    system.includes("Apart from that, do not filter, sort, merge, rename or add an entry."),
    "the no-filter rule is not stated after the one exception",
  );
  // Two lists with one name are two lists.
  assert.ok(
    system.includes("Two lists with the same name stay two entries."),
    "the prompt does not keep two lists that share a name",
  );
});

test("the fetch prompt is exactly its three steps, and its user text names no tool", () => {
  // The rules above, pinned whole: one call of crm_list_search and no other
  // tool, each id and name copied exactly, the order, the one exception, the
  // empty and the failed answer. Any added or removed sentence fails here.
  const data = refs[FETCH]?.data ?? {};
  assert.equal(data.system, FETCH_SYSTEM, "the fetch prompt is not exactly its three steps");
  assert.equal(data.user, FETCH_USER, "the fetch step's user text changed");
});

// ---------------------------------------------------------------------------
// The gate's content
// ---------------------------------------------------------------------------

test("the gate content carries every row of the fetch answer, in its order", () => {
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

test("a failed read reaches the gate content as listsRead \"failed\"", () => {
  // The two cases differ in this value only; the lists are [] in both. Which
  // words a person reads for each is the renderer's (a later unit).
  const content = JSON.parse(gateContentText(fetchAnswerFor([], "failed")));
  assert.deepEqual(content, { lists: [], listsRead: "failed" });
});

test("two lists with one name stay two rows in the gate content", () => {
  const answer = [
    { id: "view-7", name: "Founders" },
    { id: "view-8", name: "Founders" },
  ];
  const content = JSON.parse(gateContentText(fetchAnswerFor(answer)));
  assert.deepEqual(content.lists, answer);
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

test("every string answer but the exact refresh value goes on to the recipient fetch", () => {
  // Near misses of the refresh value, an empty answer, and scopes the
  // recipient fetch refuses: none of them reads the lists again. These are
  // string answers; the branch's handling of an answer that is not a string
  // is the runtime's and is not read here.
  const unknown = [
    "Refresh",
    "REFRESH",
    " refresh",
    "refresh\n",
    "",
    "null",
    "[]",
    JSON.stringify({ listIds: ["view-1"], listNames: ["All People"] }),
    JSON.stringify({ type: "all-contacts" }),
  ];
  for (const answer of unknown) {
    assert.equal(stepAfterGate(answer), "generate", `the answer ${JSON.stringify(answer)} does not go to the recipient fetch`);
  }
  assert.deepEqual(Object.keys(refs[BRANCH]?.mapping ?? {}), ["refresh"]);
});

test("the recipient fetch refuses a scope that is not a list scope with list ids", () => {
  // The refusal is the recipient fetch's own prompt rule (a model step): an
  // answer that is not a type "list" scope, or a list scope without list ids,
  // gets the unsupported_account_scope error and no recipient.
  const system = String(refs.generate?.data?.system ?? "");
  assert.ok(system.includes("ONLY type='list' is supported."));
  assert.ok(
    system.includes(
      'If type is anything else, return an error JSON: {"error":"unsupported_account_scope","scopeType":"<the input type>"',
    ),
  );
  assert.ok(
    system.includes(
      "If it carries neither shape, or selectedListIds is empty, return the same unsupported_account_scope error JSON with scopeType 'list'.",
    ),
  );
});

test("the recipient fetch refuses an answer that is not a JSON object", () => {
  // A near miss of the refresh value ("Refresh"), an empty answer, "null" and
  // "[]" go on to the recipient fetch (above). Its prompt states, before any
  // other rule of Step 1, what it returns for them: the same
  // unsupported_account_scope error, and no tool call.
  const system = String(refs.generate?.data?.system ?? "");
  assert.ok(
    system.includes("Step 1: Parse accountScope as JSON. " + UNPARSED_SCOPE_RULE + "ONLY type='list' is supported."),
    "the recipient fetch has no rule for an answer that is not a JSON object, directly after it parses the answer",
  );
  assert.equal(system.split(UNPARSED_SCOPE_RULE).length, 2, "the rule is not there exactly once");
});

test("no rule of the recipient fetch asks for a save before a refusal of Step 1", () => {
  // Step 1 returns its refusals before any tool call; the unparsed-scope rule
  // says "call no tool". A later rule that asks for objects_save before ANY
  // JSON contradicts that. Every sentence that makes a save the condition of
  // returning JSON must name the exception for the errors of Step 1 and of the
  // recipient limit.
  const system = String(refs.generate?.data?.system ?? "");
  assert.ok(system.includes("\n\n" + SAVE_RULE + " "), "Step 5 does not name the exception for the error JSONs");
  assert.ok(system.endsWith(" " + SAVE_CLOSE), "the closing rule does not name the exception for the error JSONs");
  const conditions = [...system.matchAll(/BEFORE returning any JSON|before completing Step 5/gi)];
  assert.ok(conditions.length >= 2, "the save rules are not there");
  for (const found of conditions) {
    const after = system.slice(found.index + found[0].length);
    assert.ok(
      after.startsWith(SAVE_EXCEPTION),
      `the rule ${JSON.stringify(found[0])} does not name the exception for the error JSONs of Step 1 and the recipient limit`,
    );
  }
  assert.ok(
    system.includes('"summary":"Only list-sourced recipient selection is supported; pick a saved CRM list."} and call no tool. '),
    "the unparsed-scope rule no longer says that it calls no tool",
  );
});
