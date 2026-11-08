import { strict as assert } from "node:assert";
import { test, mock } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import extension from "../extensions/gentle-shell-classic.ts";
import { enableClassic, setExperimental } from "../lib/classic.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ClassicView } from "../lib/classic-view.ts";
import { scratch } from "./helpers.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";

const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text };
function view(layout: "rail" | "top" | "off" = "rail") {
	const results: unknown[] = [];
	return { panel: new ClassicView({ layout, cardStyle: "float", theme, onDone: (result) => results.push(result) }), results };
}
const text = (panel: ClassicView, width = 80) => panel.render(width).join("\n");

test("panel fits widths and marks initial values", () => {
	const { panel } = view();
	for (const width of [0, 1, 4, 30, 60, 100]) for (const line of panel.render(width)) assert.ok(visibleWidth(line) <= width);
	assert.match(text(panel), /● rail/);
	assert.match(text(panel), /● float/);
});

test("pending choices drive focus, preview, and apply", () => {
	const { panel, results } = view();
	panel.handleInput("\x1b[C");
	assert.match(text(panel), /session info on top/);
	panel.handleInput("\x1b[B");
	assert.match(text(panel), /▸ Style/);
	panel.handleInput("\x1b[C");
	assert.match(text(panel), /Rounded ╭─ ✿ ─╮ frame/);
	panel.handleInput("\r");
	assert.deepEqual(results, [{ layout: "top", cardStyle: "neon" }]);
});

test("off skips style and omits card style; escape cancels", () => {
	const { panel, results } = view("off");
	panel.handleInput("\x1b[B");
	assert.match(text(panel), /▸ Layout/);
	assert.match(text(panel), /\(not used\)/);
	panel.handleInput("\r");
	assert.deepEqual(results, [{ layout: "off" }]);
	const other = view();
	other.panel.handleInput("\x1b");
	assert.deepEqual(other.results, [null]);
});

test("custom panel completion applies the choice and reloads; unchanged closes without reload", async () => {
	const files = new Map<string, string>([["/virtual/gentle/package.json", JSON.stringify({ name: "gentle-pi", version: "4.6.0" })]]);
	const oldHome = process.env.GENTLE_PI_CONFIG_HOME;
	const oldPrefix = process.env.GENTLE_SHELL_PREFIX;
	delete process.env.GENTLE_SHELL_PREFIX;
	process.env.GENTLE_PI_CONFIG_HOME = "/virtual/classic-test";
	mock.method(fs, "readFileSync", ((path: string) => { if (!files.has(String(path))) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(String(path)); }) as typeof fs.readFileSync);
	mock.method(fs, "mkdirSync", (() => undefined) as typeof fs.mkdirSync);
	mock.method(fs, "writeFileSync", ((path: string, data: string) => { files.set(String(path), String(data)); }) as typeof fs.writeFileSync);
	mock.method(fs, "renameSync", ((from: string, to: string) => { files.set(String(to), files.get(String(from))!); files.delete(String(from)); }) as typeof fs.renameSync);
	mock.method(fs, "unlinkSync", ((path: string) => { files.delete(String(path)); }) as typeof fs.unlinkSync);
	syncBuiltinESMExports();
	try {
		let handler: (args: string, ctx: unknown) => Promise<void> = async () => {};
		extension({ getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: "/virtual/gentle/extensions/shell.ts" } }], on() {}, registerCommand(_name: string, command: { handler: typeof handler }) { handler = command.handler; } } as never);
		let reloads = 0;
		const notices: string[] = [];
		const ctx = { hasUI: true, reload: async () => { reloads++; }, ui: {
			notify: (message: string) => notices.push(message),
			custom: async (factory: Function, options: { overlay: boolean }) => {
				assert.equal(options.overlay, true);
				return new Promise(resolve => {
					const panel = factory({ requestRender() {} }, theme, {}, resolve);
					panel.handleInput("\x1b[C"); // off → rail
					panel.handleInput("\r");
				});
			},
		} };
		await handler("", ctx);
		assert.equal(reloads, 1);
		assert.equal(JSON.parse(files.get("/virtual/classic-test/card-style.json")!).style, "float");
		ctx.ui.custom = async (factory: Function) => new Promise(resolve => { factory({ requestRender() {} }, theme, {}, resolve).handleInput("\r"); });
		await handler("", ctx);
		assert.equal(reloads, 1);
		assert.equal(notices.at(-1), "No changes.");
	} finally {
		mock.restoreAll();
		syncBuiltinESMExports();
		if (oldHome === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = oldHome;
		if (oldPrefix === undefined) delete process.env.GENTLE_SHELL_PREFIX; else process.env.GENTLE_SHELL_PREFIX = oldPrefix;
	}
});

test("unified commands preserve placements, report status, and restore cards", async () => {
	const root = scratch(), pkg = join(root, "gentle"), config = join(root, "config");
	mkdirSync(join(pkg, "extensions"), { recursive: true }); mkdirSync(config);
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.7.0" }));
	const visual = join(config, "visual-customization.json");
	writeFileSync(visual, JSON.stringify({ schema: "gentle-pi.visual-customization/v1", headerPlacement: "top", statusPlacement: "right" }));
	writeFileSync(join(config, "card-style.json"), JSON.stringify({ schema: "gentle-pi.card-style/v1", style: "neon" }));
	const old = process.env.GENTLE_PI_CONFIG_HOME; process.env.GENTLE_PI_CONFIG_HOME = config;
	let handler: any; const notices: string[] = [];
	let factory: any = Object.assign(() => ({ deps: { panelChrome: () => true } }), { [Symbol.for("gentle-pi.prompt-owner")]: true });
	try {
		extension({ on() {}, getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle.ts") } }], registerCommand(_name: string, command: any) { handler = command.handler; } } as never);
		const ctx = { hasUI: true, ui: { notify(message: string) { notices.push(message); }, select: async () => "Yes, enable the experimental patch", getEditorComponent: () => factory, setEditorComponent: (value: any) => { factory = value; } } };
		const before = fs.readFileSync(visual, "utf8"), files = readdirSync(config).map(name => [name, fs.readFileSync(join(config, name), "utf8")]);
		for (const action of ["rail", "top", "on"]) {
			await handler(action, ctx);
			assert.equal(notices.at(-1), "Header and Status position are set in /gentle:customize; with the experimental patch the classic prompt shows in any layout.");
			assert.deepEqual(readdirSync(config).map(name => [name, fs.readFileSync(join(config, name), "utf8")]), files);
		}
		for (const style of ["float", "neon"]) {
			await handler(style, ctx);
			assert.equal(JSON.parse(fs.readFileSync(join(config, "card-style.json"), "utf8")).style, style);
			assert.equal(fs.readFileSync(visual, "utf8"), before);
		}
		await handler("status", ctx); assert.match(notices.at(-1)!, /Experimental off.*cards neon.*header top.*Status right.*4\.7\.0/);
		await handler("experimental on", ctx); await handler("status", ctx); assert.match(notices.at(-1)!, /Experimental on/);
		await handler("off", ctx);
		assert.equal(JSON.parse(fs.readFileSync(join(config, "card-style.json"), "utf8")).style, "neon");
		assert.equal(fs.readFileSync(visual, "utf8"), before);
	} finally { if (old === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = old; }
});

test("experimental command requires explicit confirmation", async () => {
	const root = scratch(), pkg = join(root, "gentle"), config = join(root, "config");
	mkdirSync(join(pkg, "extensions"), { recursive: true }); mkdirSync(config);
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.7.0" }));
	const old = process.env.GENTLE_PI_CONFIG_HOME; process.env.GENTLE_PI_CONFIG_HOME = config;
	let handler: any;
	try {
		extension({ on() {}, getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle.ts") } }], registerCommand(_name: string, command: any) { handler = command.handler; } } as never);
		const ctx = { hasUI: true, ui: { notify() {}, select: async (title: string) => { assert.match(title, /private editor internals/); return "No, keep it off"; } } };
		await handler("experimental on", ctx); assert.deepEqual(readdirSync(config), []);
	} finally { if (old === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = old; }
});

test("unified activation, panel apply and off migrate old layouts", async () => {
	for (const trigger of ["experimental on", "panel", "off"]) for (const layout of ["rail", "top"] as const) {
		const root = scratch(), pkg = join(root, "gentle"), config = join(root, "config");
		mkdirSync(join(pkg, "extensions"), { recursive: true }); mkdirSync(config);
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.6.0" }));
		writeFileSync(join(pkg, "extensions/gentle-shell.ts"), "chromeBarsShown");
		writeFileSync(join(config, "visual-customization.json"), JSON.stringify({ schema: "gentle-pi.visual-customization/v1", headerPlacement: "custom", statusPlacement: "right" }));
		enableClassic({ configHome: config, layout });
		const old = process.env.GENTLE_PI_CONFIG_HOME; process.env.GENTLE_PI_CONFIG_HOME = config;
		let handler: any; let factory: any = Object.assign(() => ({ deps: { panelChrome: () => true } }), { [Symbol.for("gentle-pi.prompt-owner")]: true });
		try {
			extension({ on() {}, getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle-shell.ts") } }], registerCommand(_name: string, command: any) { handler = command.handler; } } as never);
			const ctx = { hasUI: true, ui: { notify() {}, select: async () => "Yes, enable the experimental patch", getEditorComponent: () => factory, setEditorComponent: (value: any) => { factory = value; }, custom: async (make: Function) => new Promise(resolve => { const panel = make({ requestRender() {} }, theme, {}, resolve); panel.handleInput("\r"); }) } };
			await handler(trigger === "panel" ? "" : trigger, ctx);
			const v = JSON.parse(fs.readFileSync(join(config, "visual-customization.json"), "utf8"));
			assert.equal(v.headerPlacement, "custom"); assert.equal(v.statusPlacement, "right");
			if (trigger !== "off") assert.equal(JSON.parse(fs.readFileSync(join(config, "gentle-shell-classic.json"), "utf8")).appliedLayout, null);
			await handler("off", ctx);
		} finally { if (old === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = old; }
	}
});

test("unified session warning about the old layout is skipped while the patch is on", () => {
	for (const experimental of [true, false]) {
		const root = scratch(), pkg = join(root, "gentle"), config = join(root, "config");
		mkdirSync(join(pkg, "extensions"), { recursive: true }); mkdirSync(config);
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.6.0" }));
		writeFileSync(join(pkg, "extensions/gentle-shell.ts"), "chromeBarsShown");
		enableClassic({ configHome: config, layout: "rail" });
		setExperimental(experimental, { configHome: config });
		const old = process.env.GENTLE_PI_CONFIG_HOME; process.env.GENTLE_PI_CONFIG_HOME = config;
		const events: Record<string, Function> = {}; const notices: string[] = [];
		try {
			extension({ on(name: string, fn: Function) { events[name] = fn; }, getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle-shell.ts") } }], registerCommand() {} } as never);
			const ctx = { hasUI: true, ui: { notify(message: string) { notices.push(message); }, getEditorComponent: () => undefined, setEditorComponent() {} } };
			events.session_start({}, ctx);
			assert.equal(notices.some(message => /classic prompt may not show/.test(message)), !experimental);
			events.session_shutdown?.({}, ctx);
		} finally { if (old === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = old; }
	}
});

test("shutdown cancels retries and a later command wraps a late editor", async () => {
	const root = scratch(), pkg = join(root, "gentle"), config = join(root, "config");
	mkdirSync(join(pkg, "extensions"), { recursive: true }); mkdirSync(config);
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "gentle-pi", version: "4.7.0" }));
	const old = process.env.GENTLE_PI_CONFIG_HOME; process.env.GENTLE_PI_CONFIG_HOME = config;
	let handler: any; const events: Record<string, Function> = {}; const pending = new Map<number, Function>(); let next = 0;
	mock.method(globalThis, "setTimeout", ((fn: Function) => { const id = ++next; pending.set(id, fn); return id; }) as any);
	mock.method(globalThis, "clearTimeout", ((id: number) => { pending.delete(id); }) as any);
	let factory: any; const original = Object.assign(() => ({ deps: { panelChrome: () => true } }), { [Symbol.for("gentle-pi.prompt-owner")]: true });
	try {
		extension({ on(name: string, fn: Function) { events[name] = fn; }, getCommands: () => [{ name: "gentle:customize", sourceInfo: { path: join(pkg, "extensions/gentle.ts") } }], registerCommand(_name: string, command: any) { handler = command.handler; } } as never);
		const ctx = { hasUI: true, ui: { notify() {}, select: async () => "Yes, enable the experimental patch", getEditorComponent: () => factory, setEditorComponent: (value: any) => { factory = value; } } };
		await handler("experimental on", ctx); events.session_start({}, ctx); assert.equal(pending.size, 4);
		events.session_shutdown({}, ctx); assert.equal(pending.size, 0);
		events.session_start({}, ctx); for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } assert.equal(pending.size, 0);
		factory = original; await handler("status", ctx); assert.notEqual(factory, original);
		events.session_start({}, ctx); assert.equal(pending.size, 4); await handler("experimental off", ctx); assert.equal(pending.size, 0);
	} finally { mock.restoreAll(); if (old === undefined) delete process.env.GENTLE_PI_CONFIG_HOME; else process.env.GENTLE_PI_CONFIG_HOME = old; }
});

test("experimental panel displays disclaimer and requires inline confirmation", () => {
	const results: unknown[] = [];
	const panel = new ClassicView({ layout: "rail", cardStyle: "float", theme, showExperimental: true, experimental: false, onDone: choice => results.push(choice) });
	panel.handleInput("\x1b[B");
	assert.match(text(panel, 140), /private editor internals/); assert.match(text(panel, 140), /unsupported by Gentle Shell/);
	panel.handleInput("\x1b[C"); panel.handleInput("\r");
	assert.match(text(panel), /y confirm · any other key cancel/);
	panel.handleInput("n"); assert.deepEqual(results, []);
	panel.handleInput("\r"); panel.handleInput("y");
	assert.deepEqual(results, [{ layout: "rail", cardStyle: "float", experimental: true }]);
});

test("unified panel exposes style and experimental without layout", () => {
	const panel = new ClassicView({ layout: "off", cardStyle: "float", theme, showExperimental: true, experimental: false, onDone() {} });
	assert.doesNotMatch(text(panel), /Layout/);
	assert.match(text(panel), /Style/);
	assert.match(text(panel), /Experimental/);
	assert.match(text(panel), /Painted panel/);
	assert.match(text(panel), /gentle:customize/);
	assert.match(text(panel), /any layout/);
	panel.handleInput("\x1b[C"); assert.match(text(panel), /Rounded/);
	panel.handleInput("\x1b[B"); assert.match(text(panel), /private editor internals/);
});

test("key release events are ignored", () => {
	const { panel, results } = view();
	panel.handleInput("\x1b[13;1:3u");
	assert.deepEqual(results, []);
	assert.match(text(panel), /▸ Layout/);
});
