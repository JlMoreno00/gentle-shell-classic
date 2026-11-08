import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratch } from "./helpers.ts";
import { detectGentleVersion, isSupportedGentleVersion, isSupportedGentleInstall, canPatchGentleInstall } from "../lib/gentle-version.ts";

test("supports only stable Gentle Shell 4.6.x", () => {
	for (const [version, expected] of [["4.5.9", false], ["4.6.0", true], ["4.6.12", true], ["4.7.0", false], ["5.0.0", false], ["4.7.0-rc.1", false], [undefined, false]] as const) {
		assert.equal(isSupportedGentleVersion(version), expected, String(version));
	}
});

test("prefers the actually loaded command package over agent fallback", () => {
	const dir = scratch();
	const pkg = join(dir, "loaded");
	mkdirSync(join(pkg, "extensions"), { recursive: true });
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.7.0" }));
	const pi = { getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle-shell.ts") } }] };
	assert.equal(detectGentleVersion({ PI_CODING_AGENT_DIR: join(dir, "missing") }, dir, pi).version, "4.7.0");
});

test("classifies unified editor separately from the declared version", () => {
	for (const [version, source, supported, experimental] of [
		["4.6.0", "chromeBarsShown", false, true],
		["4.6.0", "ordinary editor", true, false],
		["4.6.0", undefined, true, false],
		["4.7.0", "ordinary editor", false, true],
	] as const) {
		const dir = scratch();
		mkdirSync(join(dir, "extensions"));
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "gentle-pi", version }));
		if (source !== undefined) writeFileSync(join(dir, "extensions/gentle-shell.ts"), source);
		const pi = { getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(dir, "extensions/gentle-shell.ts") } }] };
		const install = detectGentleVersion({ PI_CODING_AGENT_DIR: join(dir, "missing") }, dir, pi);
		assert.equal(isSupportedGentleInstall(install), supported);
		assert.equal(canPatchGentleInstall(install), experimental);
	}
});

test("detects an npm package declared in the agent directory", () => {
	const dir = scratch();
	mkdirSync(join(dir, "npm/node_modules/gentle-pi"), { recursive: true });
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:gentle-pi"] }));
	writeFileSync(join(dir, "npm/node_modules/gentle-pi/package.json"), JSON.stringify({ name: "gentle-pi", version: "4.6.12" }));
	assert.equal(detectGentleVersion({ PI_CODING_AGENT_DIR: dir }).version, "4.6.12");
});
