// The co-owned list-picker declaration — asserted on the shipped manifest.
//
// This package and the outreach package both declare the SAME binding id
// ("@cinatra-ai/email-outreach-agent:list-picker"). The host manifest generator
// dedupes co-declarations on a deep-equal contract (kind, priority, flags,
// params) and REFUSES two declarers that disagree, so this entry must carry the
// identical params object the outreach package declares: the package that
// builds a list. kind, priority and the flag set stay exactly as they were.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const renderers = pkg.cinatra?.fieldRenderers ?? [];
const LIST_PICKER_ID = "@cinatra-ai/email-outreach-agent:list-picker";
const entry = renderers.find((r) => r.id === LIST_PICKER_ID);

test("the list-picker binding is declared exactly once", () => {
  assert.equal(renderers.filter((r) => r.id === LIST_PICKER_ID).length, 1);
});

test("it names the list builder in params, as the outreach package does", () => {
  assert.deepEqual(entry.params, {
    listBuilderPackage: "@cinatra-ai/list-curator-agent",
  });
});

test("kind, priority and the flag set are unchanged", () => {
  assert.equal(entry.kind, "list-picker");
  assert.equal(entry.priority, 90);
  assert.deepEqual(Object.keys(entry).sort(), ["id", "kind", "params", "priority"]);
});
