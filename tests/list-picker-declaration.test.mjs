// The co-owned list-picker declaration — asserted on the shipped manifest.
//
// This package and the outreach package both declare the SAME binding id
// ("@cinatra-ai/email-outreach-agent:list-picker"). The host manifest generator
// dedupes co-declarations on a canonical comparable string (kind, priority,
// flags, params — params key order included) and REFUSES two declarers whose
// strings differ, so this entry must carry the identical params object the
// outreach package declares: the account scope's selection contract, several
// lists selectable and at least one ticked. That string is owned by the
// outreach package's own version 0.1.5 manifest, and the retired list-builder
// parameter is no longer part of it. kind, priority and the flag set stay
// exactly as they were.

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

test("it names the selection contract in params, as the outreach package does", () => {
  assert.deepEqual(entry.params, {
    selection: "multiple",
    minSelected: 1,
  });
});

test("params, the comparable string and the retired key follow the outreach package", () => {
  assert.deepEqual(entry.params, { selection: "multiple", minSelected: 1 });
  assert.equal(
    JSON.stringify({
      kind: entry.kind,
      priority: entry.priority,
      midRunHitl: entry.midRunHitl === true,
      a2uiTranslator: entry.a2uiTranslator ?? null,
      params: entry.params ?? null,
      component: entry.component ?? null,
    }),
    '{"kind":"list-picker","priority":90,"midRunHitl":false,"a2uiTranslator":null,"params":{"selection":"multiple","minSelected":1},"component":null}',
  );
  assert.equal(Object.hasOwn(entry.params, "listBuilderPackage"), false);
});

test("kind, priority and the flag set are unchanged", () => {
  assert.equal(entry.kind, "list-picker");
  assert.equal(entry.priority, 90);
  assert.deepEqual(Object.keys(entry).sort(), ["id", "kind", "params", "priority"]);
});
