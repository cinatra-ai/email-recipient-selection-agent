// The co-owned list-picker declaration — asserted on the shipped manifest.
//
// This package and the outreach package both declare the SAME binding id
// ("@cinatra-ai/email-outreach-agent:list-picker"). The host manifest generator
// dedupes co-declarations on a canonical comparable string (kind, priority,
// flags, params — params key order included) and REFUSES two declarers whose
// strings differ, so this entry must carry the identical params object the
// outreach package declares: the account scope's selection contract, several
// lists selectable and at least one ticked, the question the step asks, the
// message a person reads when there is nothing to pick, and the value the step
// answers to have the CRM's lists read again. The message names Twenty CRM, as
// the owner's ruling on cinatra-ai/cinatra#3562 words it. This flow changes the
// string first; the outreach package takes the same string when it re-embeds
// this flow, and the two are pinned together. The retired list-builder
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
    question: "Which views or lists in your CRM should this run take its recipients from?",
    emptyState: "There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.",
    refreshValue: "refresh",
  });
});

test("params, the comparable string and the retired key follow the outreach package", () => {
  assert.deepEqual(entry.params, {
    selection: "multiple",
    minSelected: 1,
    question: "Which views or lists in your CRM should this run take its recipients from?",
    emptyState: "There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.",
    refreshValue: "refresh",
  });
  assert.equal(
    JSON.stringify({
      kind: entry.kind,
      priority: entry.priority,
      midRunHitl: entry.midRunHitl === true,
      a2uiTranslator: entry.a2uiTranslator ?? null,
      params: entry.params ?? null,
      component: entry.component ?? null,
    }),
    '{"kind":"list-picker","priority":90,"midRunHitl":false,"a2uiTranslator":null,"params":{"selection":"multiple","minSelected":1,"question":"Which views or lists in your CRM should this run take its recipients from?","emptyState":"There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.","refreshValue":"refresh"},"component":null}',
  );
  assert.equal(Object.hasOwn(entry.params, "listBuilderPackage"), false);
});

test("the empty-state words ask the person to create a list in Twenty CRM", () => {
  assert.equal(
    entry.params.emptyState,
    "There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.",
  );
  assert.match(entry.params.emptyState, /Twenty CRM/);
  // The words promise no road the step does not have: opening the step again
  // shows the same content, so they do not ask the person to do that.
  assert.doesNotMatch(entry.params.emptyState, /open this step again/i);
});

test("kind, priority and the flag set are unchanged", () => {
  assert.equal(entry.kind, "list-picker");
  assert.equal(entry.priority, 90);
  assert.deepEqual(Object.keys(entry).sort(), ["id", "kind", "params", "priority"]);
});
