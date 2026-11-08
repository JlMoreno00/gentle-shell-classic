import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createPromptPatch } from "../lib/prompt-patch.ts";

const owner = Symbol.for("gentle-pi.prompt-owner");
test("wraps the owned factory and restores the exact original", () => {
	const original = Object.assign(() => ({ deps: { panelChrome: () => true, panelButton: () => true } }), { [owner]: true, extra: 42 });
	let current: any = original;
	const ui = { getEditorComponent: () => current, setEditorComponent: (f: any) => { current = f; }, notify() {} };
	const patch = createPromptPatch();
	patch.apply(ui);
	assert.notEqual(current, original);
	assert.equal(current[owner], true);
	assert.equal(current.extra, 42);
	const editor = current();
	assert.equal(editor.deps.panelChrome(), false);
	assert.equal(editor.deps.panelButton(), false);
	patch.remove(ui);
	assert.equal(current, original);
	assert.equal(editor.deps.panelChrome(), true);
});

test("unknown shape is a no-op and notifies once", () => {
	const original = Object.assign(() => ({}), { [owner]: true });
	let current: any = original, notices = 0;
	const ui = { getEditorComponent: () => current, setEditorComponent: (f: any) => { current = f; }, notify() { notices++; } };
	const patch = createPromptPatch();
	patch.apply(ui);
	current(); current();
	assert.equal(notices, 1);
});
