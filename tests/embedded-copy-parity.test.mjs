// Parity of this flow with its embedded copy - cinatra-ai/cinatra#3096 item (7).
//
// The outreach pack (@cinatra-ai/email-outreach-agent) runs this agent as an
// embedded copy of this flow. The fixture
// tests/fixtures/email-outreach-recipient-selection-subflow.json is that copy
// taken whole: the value of "email-recipient-selection-subflow" in the outreach
// pack's cinatra/oas.json at commit 383410bbc049b030de14e57c5775952893ca83d4.
//
// This flow is the source of truth the copy is re-inlined from, so it must
// carry everything the copy carries. The rule is CONTAINS: with the copy's id
// prefix "recipients-" stripped, and the copy's review step "review_gate" read
// as this flow's "approval_gate", every step of the copy is a step of this
// flow, and each carries every key and every titled entry the copy's step
// carries, with equal scalar values. Extra keys and extra entries are allowed:
// this flow keeps its own apply step, its closing sentence and its end, which
// hands on the reviewed count.
//
// The generate step's prompt texts are compared like every other value, with
// one named exemption: this flow keeps its recipient limit, one paragraph of
// its system text (RECIPIENT_LIMIT below). That paragraph, with the paragraph
// break after it, is taken out of this flow's system text by its exact text
// before the comparison, so any other difference in the prompt still fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra", "oas.json"), "utf8"));
const rawCopy = JSON.parse(
  readFileSync(join(root, "tests", "fixtures", "email-outreach-recipient-selection-subflow.json"), "utf8"),
);

const PREFIX = "recipients-";
/** The one step whose id differs once the prefix is gone. */
const SAME_STEP = { review_gate: "approval_gate" };
const rename = (text) => {
  const bare = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text;
  return Object.hasOwn(SAME_STEP, bare) ? SAME_STEP[bare] : bare;
};

/** The copy with the prefix stripped from every string and every key. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [rename(key), strip(inner)]));
  return typeof value === "string" ? rename(value) : value;
}

const copy = strip(rawCopy);
const refs = oas.$referenced_components ?? {};
const copyRefs = copy.$referenced_components ?? {};

/** This flow's recipient limit: the one paragraph its generate prompt adds. */
const RECIPIENT_LIMIT =
  "Recipient limit, checked after Step 4 and before Step 5: the resolved recipient pool MUST NOT exceed the agent's " +
  "cinatra.json.limits.maxRecipients (default 200). With several ticked lists the limit applies to their total: " +
  "the unioned, filtered rows of Step 4, each contact counted once. If the count exceeds the cap, return an error " +
  'JSON before objects_save: {"error":"The ticked lists have N contacts which exceeds the maxRecipients limit of M. ' +
  'Pick fewer or smaller lists or override maxRecipients via the agent install settings."}. ' +
  "Do NOT silently truncate — fail/block, not truncate.\n\n";

/** The paragraph of the copy's prompt that the recipient limit stands before. */
const LIMIT_BEFORE = "Step 5 — CRITICAL:";

/** This flow's generate step with the recipient limit taken out, or a reason. */
function generateWithoutLimit(step, missing) {
  const system = step?.data?.system;
  const parts = typeof system === "string" ? system.split(RECIPIENT_LIMIT) : [];
  if (parts.length !== 2) {
    missing.push("the recipient limit sentences are not there exactly once");
    return step;
  }
  // The paragraph stands on its own, directly before the copy's Step 5.
  if (!(parts[0] === "" || parts[0].endsWith("\n\n")) || !parts[1].startsWith(LIMIT_BEFORE)) {
    missing.push(`the recipient limit sentences do not stand directly before ${LIMIT_BEFORE}`);
    return step;
  }
  return { ...step, data: { ...step.data, system: parts.join("") } };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isTitledList = (list) =>
  list.length > 0 && list.every((entry) => isObject(entry) && typeof entry.title === "string");

/** Collect, into `missing`, everything `want` carries that `have` does not. */
function contains(have, want, path, missing) {
  if (Array.isArray(want)) {
    if (!Array.isArray(have)) {
      missing.push(`${path}: not a list`);
      return;
    }
    if (isTitledList(want)) {
      for (const entry of want) {
        const found = have.find((candidate) => isObject(candidate) && candidate.title === entry.title);
        if (!found) missing.push(`${path}[${entry.title}]`);
        else contains(found, entry, `${path}[${entry.title}]`, missing);
      }
      return;
    }
    want.forEach((entry, index) => {
      if (index >= have.length) missing.push(`${path}[${index}]`);
      else contains(have[index], entry, `${path}[${index}]`, missing);
    });
    return;
  }
  if (isObject(want)) {
    if (!isObject(have)) {
      missing.push(`${path}: not an object`);
      return;
    }
    for (const [key, inner] of Object.entries(want)) {
      if (!Object.hasOwn(have, key)) missing.push(`${path}.${key}`);
      else contains(have[key], inner, `${path}.${key}`, missing);
    }
    return;
  }
  if (have !== want) missing.push(`${path}: ${JSON.stringify(want)}, found ${JSON.stringify(have)}`);
}

const dataEdgesOf = (flow) =>
  new Set(
    (flow.data_flow_connections ?? []).map(
      (e) =>
        `${e.source_node.$component_ref}.${e.source_output} -> ${e.destination_node.$component_ref}.${e.destination_input}`,
    ),
  );
const controlEdgesOf = (flow) =>
  new Set(
    (flow.control_flow_connections ?? []).map(
      (e) =>
        `${e.from_node.$component_ref}${e.from_branch ? `[${e.from_branch}]` : ""} -> ${e.to_node.$component_ref}`,
    ),
  );

test("(7) every step of the embedded copy is a step of this flow, carrying all it carries", () => {
  const listed = new Set((oas.nodes ?? []).map((n) => n.$component_ref));
  const missing = [];
  for (const { $component_ref: id } of copy.nodes ?? []) {
    if (!listed.has(id)) missing.push(`${id}: not a step of this flow`);
    if (!refs[id]) {
      missing.push(`${id}: not defined in this flow`);
      continue;
    }
    const step = id === "generate" ? generateWithoutLimit(refs[id], missing) : refs[id];
    contains(step, copyRefs[id], id, missing);
  }
  assert.deepEqual(missing, [], "this flow lacks what the embedded copy carries: " + missing.join("; "));
});

test("(7) the flow takes every input and hands on every output the copy does", () => {
  const missing = [];
  contains(oas.inputs ?? [], copy.inputs ?? [], "inputs", missing);
  contains(oas.outputs ?? [], copy.outputs ?? [], "outputs", missing);
  assert.deepEqual(missing, [], "this flow lacks the copy's inputs or outputs: " + missing.join("; "));
});

test("(7) every data edge of the copy is a data edge of this flow, but the reviewed count at the end", () => {
  const have = dataEdgesOf(oas);
  // The copy's end hands on the generated count; this flow's end hands on the
  // count its own apply step returns after the review.
  const missing = [...dataEdgesOf(copy)]
    .filter((edge) => edge !== "generate.recipientCount -> end.recipientCount")
    .filter((edge) => !have.has(edge));
  if (!have.has("apply.reviewedCount -> end.recipientCount")) missing.push("apply.reviewedCount -> end.recipientCount");
  if (have.has("generate.recipientCount -> end.recipientCount"))
    missing.push("generate.recipientCount -> end.recipientCount must not be here");
  assert.deepEqual(missing, [], "this flow lacks the copy's data edges: " + missing.join("; "));
});

test("(7) every control edge of the copy is one of this flow, but the review's own road on", () => {
  const have = controlEdgesOf(oas);
  // The copy's review goes straight to its end; this flow's review goes on to
  // its own apply step, closing sentence and end.
  const missing = [...controlEdgesOf(copy)]
    .filter((edge) => edge !== "approval_gate -> end")
    .filter((edge) => !have.has(edge));
  if (!have.has("approval_gate -> apply")) missing.push("approval_gate -> apply");
  if (have.has("approval_gate -> end")) missing.push("approval_gate -> end must not be here");
  assert.deepEqual(missing, [], "this flow lacks the copy's control edges: " + missing.join("; "));
});
