// Bridge output item members — the `generate` node's `confirmedRecipients`.
//
// The runtime asks the model for exactly the shape this agent declares: an
// array level whose `items` carries no `properties` is sent CLOSED and EMPTY,
// so the model can promise nothing about the rows and structured consumers
// receive unfielded entries. The row shape the node's own system prompt spells
// out (STEP 4 — "Build a row in `confirmedRecipients`") is the declaration this
// package owes, and this test pins it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(join(root, "cinatra/oas.json"), "utf8"));
const components = oas.$referenced_components ?? {};

const LLM_BRIDGE_PATH = "/api/llm-bridge";

/** Every ApiNode in the document that targets the LLM bridge. */
function bridgeNodes(value, found = []) {
  if (Array.isArray(value)) {
    for (const v of value) bridgeNodes(v, found);
  } else if (value && typeof value === "object") {
    if (
      value.component_type === "ApiNode" &&
      typeof value.url === "string" &&
      value.url.includes(LLM_BRIDGE_PATH)
    ) {
      found.push(value);
    }
    for (const v of Object.values(value)) bridgeNodes(v, found);
  }
  return found;
}

const generate = bridgeNodes(components).find((node) => node.id === "generate");

// The six row fields the node's system prompt builds in STEP 4 and persists in
// the `@cinatra-ai/campaigns:recipients` bundle; the approval gate's renderer
// and the end node's terminal output read the same rows.
const ROW_FIELDS = [
  "contactId",
  "name",
  "title",
  "email",
  "accountId",
  "accountName",
];

test("the generate node targets the LLM bridge", () => {
  assert.ok(generate, "no ApiNode with id 'generate' targets the LLM bridge");
});

test("confirmedRecipients declares its item members", () => {
  const output = (generate.outputs ?? []).find(
    (o) => o?.title === "confirmedRecipients",
  );
  assert.ok(output, "the generate node declares no confirmedRecipients output");
  assert.equal(output.type, "array");

  const items = output.json_schema?.items;
  assert.ok(items, "confirmedRecipients declares no json_schema.items");
  assert.equal(items.type, "object");

  const properties = items.properties;
  assert.ok(
    properties && typeof properties === "object",
    "confirmedRecipients items declare no properties — the rows are sent closed and empty",
  );
  assert.deepEqual(
    Object.keys(properties).sort(),
    [...ROW_FIELDS].sort(),
    "the declared row members must be exactly the fields STEP 4 of the system prompt builds",
  );
  for (const field of ROW_FIELDS) {
    assert.equal(
      properties[field]?.type,
      "string",
      `row member ${field} must declare type string`,
    );
  }
});

test("the declared row members are the ones the system prompt spells out", () => {
  const prompt = generate.data?.system ?? "";
  for (const field of ROW_FIELDS) {
    assert.ok(
      prompt.includes(field),
      `the system prompt does not mention the declared row member ${field}`,
    );
  }
});
