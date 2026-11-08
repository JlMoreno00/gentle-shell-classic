import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { scratch } from "./helpers.ts";
import { join } from "node:path";
import { test } from "node:test";
import { classicStatus, disableClassic, enableClassic, resolveConfigHome, migrateClassicLayout, setClassicCardStyle } from "../lib/classic.ts";

const VISUAL = "visual-customization.json";
const CARD = "card-style.json";
const BACKUP = "gentle-shell-classic.json";

function home(): string {
	return scratch();
}
function readJson(dir: string, file: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(dir, file), "utf8"));
}
function writeVisual(dir: string, overrides: Record<string, unknown> = {}): void {
	writeFileSync(join(dir, VISUAL), `${JSON.stringify({
		schema: "gentle-pi.visual-customization/v1",
		statusPlacement: "right",
		headerPlacement: "top",
		density: "compact",
		visibility: { changes: false, rdd: true, agents: true, todo: true, usageCost: true, modelDetails: true, contextWarning: true, stats: true },
		...overrides,
	})}\n`);
}

test("enable on an empty config home writes the classic header placement and float cards", () => {
	const dir = home();
	const result = enableClassic({ configHome: dir });
	assert.equal(result.changed, true);
	const visual = readJson(dir, VISUAL);
	assert.equal(visual.schema, "gentle-pi.visual-customization/v1");
	assert.equal(visual.headerPlacement, "below-input");
	assert.equal(visual.statusPlacement, "auto");
	assert.equal(visual.density, "comfortable");
	assert.deepEqual(visual.visibility, { changes: true, rdd: true, agents: true, todo: true, usageCost: true, modelDetails: true, contextWarning: true, stats: false });
	assert.deepEqual(readJson(dir, CARD), { schema: "gentle-pi.card-style/v1", style: "float" });
	assert.equal(classicStatus({ configHome: dir }).active, true);
});

test("enable keeps every other visual choice the user made", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir, cardStyle: "neon" });
	const visual = readJson(dir, VISUAL);
	assert.equal(visual.headerPlacement, "below-input");
	assert.equal(visual.statusPlacement, "right");
	assert.equal(visual.density, "compact");
	assert.equal((visual.visibility as Record<string, boolean>).changes, false);
	assert.equal((visual.visibility as Record<string, boolean>).stats, true);
	assert.equal(readJson(dir, CARD).style, "neon");
});

test("enable refuses a malformed visual file and leaves every file untouched", () => {
	const dir = home();
	writeFileSync(join(dir, VISUAL), "{ not json");
	assert.throws(() => enableClassic({ configHome: dir }), /malformed or unreadable.*visual-customization\.json/);
	assert.equal(readFileSync(join(dir, VISUAL), "utf8"), "{ not json");
	assert.equal(existsSync(join(dir, CARD)), false);
	assert.equal(existsSync(join(dir, BACKUP)), false);
});

test("enable refuses a malformed card style file and leaves every file untouched", () => {
	const dir = home();
	writeVisual(dir);
	const before = readFileSync(join(dir, VISUAL), "utf8");
	writeFileSync(join(dir, CARD), '{"style":"neon"}');
	assert.throws(() => enableClassic({ configHome: dir }), /malformed or unreadable.*card-style\.json/);
	assert.equal(readFileSync(join(dir, VISUAL), "utf8"), before);
	assert.equal(readFileSync(join(dir, CARD), "utf8"), '{"style":"neon"}');
	assert.equal(existsSync(join(dir, BACKUP)), false);
});

test("a second enable keeps the original backup", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir });
	enableClassic({ configHome: dir, cardStyle: "neon" });
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(existsSync(join(dir, CARD)), false);
});

test("disable restores the previous header placement and card style", () => {
	const dir = home();
	writeVisual(dir);
	writeFileSync(join(dir, CARD), `${JSON.stringify({ schema: "gentle-pi.card-style/v1", style: "neon" })}\n`);
	enableClassic({ configHome: dir });
	const result = disableClassic({ configHome: dir });
	assert.equal(result.changed, true);
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(readJson(dir, VISUAL).density, "compact");
	assert.equal(readJson(dir, CARD).style, "neon");
	assert.equal(existsSync(join(dir, BACKUP)), false);
	assert.equal(classicStatus({ configHome: dir }).active, false);
});

test("disable keeps changes the user made while classic was on", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir });
	writeVisual(dir, { headerPlacement: "below-input", density: "minimal" });
	writeFileSync(join(dir, CARD), `${JSON.stringify({ schema: "gentle-pi.card-style/v1", style: "neon" })}\n`);
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).density, "minimal");
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(readJson(dir, CARD).style, "neon");
});

test("disable without an active classic preset changes nothing", () => {
	const dir = home();
	writeVisual(dir, { headerPlacement: "below-input" });
	const before = readFileSync(join(dir, VISUAL), "utf8");
	const result = disableClassic({ configHome: dir });
	assert.equal(result.changed, false);
	assert.equal(readFileSync(join(dir, VISUAL), "utf8"), before);
});

test("the top layout puts the header on top and hides the Status rail", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir, layout: "top" });
	const visual = readJson(dir, VISUAL);
	assert.equal(visual.headerPlacement, "top");
	assert.equal(visual.statusPlacement, "hidden");
	assert.equal(visual.density, "compact");
	const status = classicStatus({ configHome: dir });
	assert.equal(status.layout, "top");
	assert.equal(status.intact, true);
});

test("disable after the top layout restores the previous Status placement", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir, layout: "top" });
	disableClassic({ configHome: dir });
	const visual = readJson(dir, VISUAL);
	assert.equal(visual.headerPlacement, "top");
	assert.equal(visual.statusPlacement, "right");
	assert.equal(existsSync(join(dir, BACKUP)), false);
});

test("switching layouts keeps the original values for disable", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir, layout: "top" });
	enableClassic({ configHome: dir, layout: "rail" });
	const visual = readJson(dir, VISUAL);
	assert.equal(visual.headerPlacement, "below-input");
	assert.equal(visual.statusPlacement, "right");
	assert.equal(classicStatus({ configHome: dir }).layout, "rail");
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(readJson(dir, VISUAL).statusPlacement, "right");
});

test("status reports a broken classic layout after the header moves back to top", () => {
	const dir = home();
	writeVisual(dir);
	enableClassic({ configHome: dir });
	assert.equal(classicStatus({ configHome: dir }).intact, true);
	writeVisual(dir, { headerPlacement: "top" });
	const status = classicStatus({ configHome: dir });
	assert.equal(status.active, true);
	assert.equal(status.intact, false);
});

test("a backup written by 0.1.0 still disables cleanly", () => {
	const dir = home();
	writeVisual(dir, { headerPlacement: "below-input" });
	writeFileSync(join(dir, BACKUP), `${JSON.stringify({ schema: "gentle-shell-classic.backup/v1", headerPlacement: "top", cardStyle: null, appliedCardStyle: "float" })}\n`);
	const status = classicStatus({ configHome: dir });
	assert.equal(status.layout, "rail");
	assert.equal(status.intact, true);
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(readJson(dir, VISUAL).statusPlacement, "right");
});

test("top over a 0.1.0 backup records the Status placement it hides", () => {
	const dir = home();
	writeVisual(dir, { headerPlacement: "below-input" });
	writeFileSync(join(dir, BACKUP), `${JSON.stringify({ schema: "gentle-shell-classic.backup/v1", headerPlacement: "top", cardStyle: null, appliedCardStyle: "float" })}\n`);
	enableClassic({ configHome: dir, layout: "top" });
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).headerPlacement, "top");
	assert.equal(readJson(dir, VISUAL).statusPlacement, "right");
});

test("disable brings the Status back when the backup never recorded it", () => {
	const dir = home();
	writeVisual(dir, { statusPlacement: "hidden" });
	writeFileSync(join(dir, BACKUP), `${JSON.stringify({ schema: "gentle-shell-classic.backup/v1", headerPlacement: "top", statusPlacement: null, cardStyle: "neon", appliedCardStyle: "neon", appliedLayout: "top" })}\n`);
	disableClassic({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).statusPlacement, "auto");
});

test("unified migration restores owned layout values and retains card backup", () => {
	for (const layout of ["rail", "top"] as const) {
		const dir = home(); writeVisual(dir, { headerPlacement: "custom", statusPlacement: "right" });
		writeFileSync(join(dir, CARD), JSON.stringify({ schema: "gentle-pi.card-style/v1", style: "neon" }));
		enableClassic({ configHome: dir, layout, cardStyle: "float" });
		migrateClassicLayout({ configHome: dir });
		assert.equal(readJson(dir, VISUAL).headerPlacement, "custom");
		assert.equal(readJson(dir, VISUAL).statusPlacement, "right");
		assert.equal(readJson(dir, BACKUP).appliedLayout, null);
		setClassicCardStyle("neon", { configHome: dir });
		disableClassic({ configHome: dir });
		assert.equal(readJson(dir, CARD).style, "neon");
	}
});

test("unified migration preserves user placement edits", () => {
	const dir = home(); writeVisual(dir); enableClassic({ configHome: dir, layout: "top" });
	writeVisual(dir, { headerPlacement: "below-input", statusPlacement: "left" });
	migrateClassicLayout({ configHome: dir });
	assert.equal(readJson(dir, VISUAL).headerPlacement, "below-input");
	assert.equal(readJson(dir, VISUAL).statusPlacement, "left");
});

test("the config home follows gentle-pi's resolution order", () => {
	const dir = home();
	assert.equal(resolveConfigHome({}, "/home/u"), join("/home/u", ".pi", "gentle-ai"));
	assert.equal(resolveConfigHome({ GENTLE_SHELL_CONFIG_HOME: "/iso/gentle-ai" }, "/home/u"), "/iso/gentle-ai");
	assert.equal(resolveConfigHome({ GENTLE_SHELL_CONFIG_HOME: "relative" }, "/home/u"), join("/home/u", ".pi", "gentle-ai"));
	assert.equal(resolveConfigHome({ GENTLE_PI_CONFIG_HOME: "/explicit", GENTLE_SHELL_CONFIG_HOME: "/iso" }, "/home/u"), "/explicit");
	const bundled = join(dir, "config", "gentle-ai");
	enableClassic({ configHome: bundled });
	assert.equal(resolveConfigHome({ GENTLE_SHELL_PREFIX: dir, GENTLE_PI_CONFIG_HOME: "/explicit" }, "/home/u"), bundled);
});
