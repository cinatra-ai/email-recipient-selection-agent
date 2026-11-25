// The co-owned list-picker declaration - asserted on the shipped manifest.
//
// This package and the outreach package both declare the SAME binding id
// ("@cinatra-ai/email-outreach-agent:list-picker"). The host manifest generator
// dedupes co-declarations on a canonical comparable string (kind, priority,
// flags, params - params key order included - and component) and REFUSES two
// declarers whose strings differ, so this entry must carry the identical params
// object and the identical component the outreach package declares: the
// account scope's selection contract, several lists selectable and at least one
// ticked, the question the step asks, the message a person reads when there is
// nothing to pick, the value the step answers to have the CRM's lists read
// again, and the component the outreach package ships for the step
// (./src/renderers/list-picker.ts, props API version 1). The message names
// Twenty CRM, as the owner's ruling on cinatra-ai/cinatra#3562 words it.
//
// The component entry names a file in the OUTREACH package. The generator
// keeps the first declarer by package name (email-outreach-agent sorts before
// email-recipient-selection-agent) and resolves the entry against that
// package only, so this package declares the component but does not ship a
// copy of the file. The application pins this change together with the
// outreach package's change that adds the same component. The retired
// list-builder parameter is no longer part of it. kind and priority stay
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
const OUTREACH_COMPONENT = { entry: "./src/renderers/list-picker.ts", propsApiVersion: 1 };

test("the list-picker binding is declared exactly once", () => {
  assert.equal(renderers.filter((r) => r.id === LIST_PICKER_ID).length, 1);
});

test("it names the selection contract in params", () => {
  assert.deepEqual(entry.params, {
    selection: "multiple",
    minSelected: 1,
    question: "Which views or lists in your CRM should this run take its recipients from?",
    emptyState: "There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.",
    refreshValue: "refresh",
  });
});

test("params, component, the comparable string and the retired key are the ones the outreach package declares", () => {
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
    '{"kind":"list-picker","priority":90,"midRunHitl":false,"a2uiTranslator":null,"params":{"selection":"multiple","minSelected":1,"question":"Which views or lists in your CRM should this run take its recipients from?","emptyState":"There are no views or lists in Twenty CRM to pick from yet. Create one in Twenty CRM.","refreshValue":"refresh"},"component":{"entry":"./src/renderers/list-picker.ts","propsApiVersion":1}}',
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

test("it declares the outreach package's component, key for key", () => {
  assert.deepEqual(entry.component, OUTREACH_COMPONENT);
  assert.deepEqual(Object.keys(entry.component), ["entry", "propsApiVersion"]);
});

test("kind, priority and the flag set are unchanged; component is the only added key", () => {
  assert.equal(entry.kind, "list-picker");
  assert.equal(entry.priority, 90);
  assert.equal(Object.hasOwn(entry, "midRunHitl"), false);
  assert.equal(Object.hasOwn(entry, "a2uiTranslator"), false);
  assert.deepEqual(Object.keys(entry).sort(), ["component", "id", "kind", "params", "priority"]);
});

// The version that carries this declaration. Version 0.1.4 was published by no
// release and named three different declarations of this binding (without the
// refresh value, then without the component, then the one above), so a range
// in the outreach package could not tell them apart. 0.1.5 is the first version
// whose every commit carries the declaration above (params and component, as at
// commit ef807294), and the outreach package's dependency range starts there
// (cinatra-ai/cinatra#3562). Any later version keeps it or changes this test.
const FIRST_VERSION_WITH_THIS_DECLARATION = [0, 1, 5];

test("the package version is at least the first version that carries this declaration", () => {
  const parts = pkg.version.split(/[.+-]/).slice(0, 3).map(Number);
  assert.ok(parts.every(Number.isInteger), `version ${pkg.version} is not major.minor.patch`);
  const order = parts.findIndex((part, i) => part !== FIRST_VERSION_WITH_THIS_DECLARATION[i]);
  assert.ok(
    order === -1 || parts[order] > FIRST_VERSION_WITH_THIS_DECLARATION[order],
    `version ${pkg.version} is below ${FIRST_VERSION_WITH_THIS_DECLARATION.join(".")}`,
  );
});
