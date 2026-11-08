import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

// The classic look only flips switches Gentle Shell already ships. Its v4.6 IDE
// chrome draws only with the header on top and a visible Status, so either the
// below-input header ("rail": keeps the Status rail) or a hidden Status with the
// header on top ("top": the v4.5 header above the conversation, no rail) turns it
// off, and the prompt falls back to its v4.5 rounded (neon) or painted (float)
// frame. Nothing else is touched.
const VISUAL_FILE = "visual-customization.json";
const CARD_FILE = "card-style.json";
const BACKUP_FILE = "gentle-shell-classic.json";
const EXPERIMENTAL_FILE = "gentle-shell-classic-state.json";
const VISUAL_SCHEMA = "gentle-pi.visual-customization/v1";
const CARD_SCHEMA = "gentle-pi.card-style/v1";
const BACKUP_SCHEMA = "gentle-shell-classic.backup/v1";
const DEFAULT_HEADER = "top";
const DEFAULT_STATUS = "auto";

export type CardStyle = "float" | "neon";
export type ClassicLayout = "rail" | "top";
/** What each layout writes; undefined keeps the user's own value. */
const LAYOUTS: Record<ClassicLayout, { headerPlacement: string; statusPlacement?: string }> = {
	rail: { headerPlacement: "below-input" },
	top: { headerPlacement: "top", statusPlacement: "hidden" },
};
type Env = Record<string, string | undefined>;
interface Options { configHome?: string }
// Backups written by 0.1.0 carry neither statusPlacement nor appliedLayout: they only ever applied "rail".
interface Backup { headerPlacement: string; statusPlacement: string | null; cardStyle: CardStyle | null; appliedCardStyle: CardStyle; appliedLayout: ClassicLayout | null }
export interface ClassicResult { changed: boolean; configHome: string; message: string }
export interface ClassicStatus {
	active: boolean;
	/** The applied layout, when active. */
	layout?: ClassicLayout;
	/** Active and the current settings still draw the classic prompt. */
	intact: boolean;
	configHome: string;
	headerPlacement: string;
	statusPlacement: string;
	cardStyle: CardStyle;
}

const DEFAULT_VISUAL = {
	statusPlacement: "auto",
	headerPlacement: DEFAULT_HEADER,
	density: "comfortable",
	visibility: { changes: true, rdd: true, agents: true, todo: true, usageCost: true, modelDetails: true, contextWarning: true, stats: false },
};

/** gentle-pi's config home rule: bundled prefix, explicit override, launcher marker, then ~/.pi/gentle-ai. */
export function resolveConfigHome(env: Env = process.env, home: string = homedir()): string {
	const prefix = env.GENTLE_SHELL_PREFIX;
	if (prefix && isAbsolute(prefix)) {
		const bundled = join(prefix, "config", "gentle-ai");
		if (existsSync(bundled)) return bundled;
	}
	if (env.GENTLE_PI_CONFIG_HOME) return env.GENTLE_PI_CONFIG_HOME;
	const marker = env.GENTLE_SHELL_CONFIG_HOME;
	if (marker && isAbsolute(marker)) return marker;
	return join(home, ".pi", "gentle-ai");
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCardStyle(value: unknown): value is CardStyle {
	return value === "float" || value === "neon";
}
export function isClassicLayout(value: unknown): value is ClassicLayout {
	return value === "rail" || value === "top";
}
function matchesLayout(visual: Record<string, unknown> | undefined, layout: ClassicLayout): boolean {
	const target = LAYOUTS[layout];
	const header = visual?.headerPlacement ?? DEFAULT_HEADER;
	const status = visual?.statusPlacement ?? DEFAULT_STATUS;
	return header === target.headerPlacement && (target.statusPlacement === undefined || status === target.statusPlacement);
}
/** Undefined for a missing file; throws for one that exists but cannot be read or parsed. */
function readJson(path: string): unknown {
	let raw: string;
	try { raw = readFileSync(path, "utf8"); } catch (error) {
		if (record(error) && error.code === "ENOENT") return undefined;
		throw new Error(`Refusing to change a malformed or unreadable file: ${path}`);
	}
	try { return JSON.parse(raw); } catch { throw new Error(`Refusing to change a malformed or unreadable file: ${path}`); }
}
function readVisual(dir: string): Record<string, unknown> | undefined {
	const path = join(dir, VISUAL_FILE);
	const value = readJson(path);
	if (value === undefined) return undefined;
	if (!record(value) || value.schema !== VISUAL_SCHEMA || typeof value.headerPlacement !== "string") {
		throw new Error(`Refusing to change a malformed or unreadable file: ${path}`);
	}
	return value;
}
function readCard(dir: string): CardStyle | undefined {
	const path = join(dir, CARD_FILE);
	const value = readJson(path);
	if (value === undefined) return undefined;
	if (!record(value) || Object.keys(value).length !== 2 || value.schema !== CARD_SCHEMA || !isCardStyle(value.style)) {
		throw new Error(`Refusing to change a malformed or unreadable file: ${path}`);
	}
	return value.style;
}
function readBackup(dir: string): Backup | undefined {
	const value = readJson(join(dir, BACKUP_FILE));
	if (value === undefined) return undefined;
	const statusPlacement = value && record(value) ? value.statusPlacement ?? null : null;
	const appliedLayout = value && record(value) && "appliedLayout" in value ? value.appliedLayout : "rail";
	if (!record(value) || value.schema !== BACKUP_SCHEMA || typeof value.headerPlacement !== "string"
		|| !(statusPlacement === null || typeof statusPlacement === "string") || !(appliedLayout === null || isClassicLayout(appliedLayout))
		|| !(value.cardStyle === null || isCardStyle(value.cardStyle)) || !isCardStyle(value.appliedCardStyle)) {
		throw new Error(`Refusing to use a malformed backup: ${join(dir, BACKUP_FILE)}`);
	}
	return { headerPlacement: value.headerPlacement, statusPlacement, cardStyle: value.cardStyle, appliedCardStyle: value.appliedCardStyle, appliedLayout };
}
/** Same-directory rename, like gentle-pi's own writers, so readers never see partial JSON. */
function writeJson(dir: string, file: string, value: unknown): void {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, file);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch { /* Rename consumed the temporary file. */ }
	}
}
function removeIfPresent(path: string): void {
	try { unlinkSync(path); } catch (error) { if (!(record(error) && error.code === "ENOENT")) throw error; }
}

export function experimentalEnabled(options: Options = {}): boolean {
	const dir = options.configHome ?? resolveConfigHome();
	const state = readJson(join(dir, EXPERIMENTAL_FILE));
	if (state === undefined) return false;
	if (!record(state) || state.schema !== "gentle-shell-classic.state/v1" || typeof state.experimental !== "boolean") throw new Error(`Refusing to use malformed state: ${join(dir, EXPERIMENTAL_FILE)}`);
	return state.experimental;
}
export function setExperimental(enabled: boolean, options: Options = {}): void {
	const dir = options.configHome ?? resolveConfigHome();
	experimentalEnabled(options);
	writeJson(dir, EXPERIMENTAL_FILE, { schema: "gentle-shell-classic.state/v1", experimental: enabled });
}

export function enableClassic(options: Options & { cardStyle?: CardStyle; layout?: ClassicLayout } = {}): ClassicResult {
	const dir = options.configHome ?? resolveConfigHome();
	const cardStyle = options.cardStyle ?? "float";
	const layout = options.layout ?? "rail";
	if (!isCardStyle(cardStyle)) throw new TypeError(`Unknown card style: ${String(cardStyle)}`);
	if (!isClassicLayout(layout)) throw new TypeError(`Unknown classic layout: ${String(layout)}`);
	// Read and validate everything before the first write.
	const visual = readVisual(dir);
	const card = readCard(dir);
	const backup = readBackup(dir);
	// A 0.1.0 backup never recorded the Status placement; until a layout hides
	// it, the current value is still the user's own.
	const original = backup ? {
		...backup,
		statusPlacement: backup.statusPlacement ?? (backup.appliedLayout === "top" ? null : visual?.statusPlacement as string ?? DEFAULT_STATUS),
	} : {
		headerPlacement: visual?.headerPlacement as string ?? DEFAULT_HEADER,
		statusPlacement: visual?.statusPlacement as string ?? DEFAULT_STATUS,
		cardStyle: card ?? null,
	};
	// Switching layouts starts from the user's own Status placement, never the previous layout's.
	const statusPlacement = LAYOUTS[layout].statusPlacement
		?? (backup?.appliedLayout === "top" && visual?.statusPlacement === LAYOUTS.top.statusPlacement ? backup.statusPlacement ?? DEFAULT_STATUS : undefined);
	const next = { ...(visual ?? DEFAULT_VISUAL), headerPlacement: LAYOUTS[layout].headerPlacement, ...(statusPlacement ? { statusPlacement } : {}) };
	writeJson(dir, BACKUP_FILE, { schema: BACKUP_SCHEMA, headerPlacement: original.headerPlacement, statusPlacement: original.statusPlacement, cardStyle: original.cardStyle, appliedCardStyle: cardStyle, appliedLayout: layout });
	writeJson(dir, VISUAL_FILE, { schema: VISUAL_SCHEMA, ...next });
	writeJson(dir, CARD_FILE, { schema: CARD_SCHEMA, style: cardStyle });
	const where = layout === "top" ? "header on top, no Status rail" : "Status rail, header below the prompt";
	return { changed: true, configHome: dir, message: `Classic look on (${where}; ${cardStyle} prompt frame).` };
}

function restoreLayout(dir: string, backup: Backup, visual: Record<string, unknown> | undefined): boolean {
	if (!backup.appliedLayout || !visual) return false;
	const applied = LAYOUTS[backup.appliedLayout];
	const restored = { ...visual };
	if (visual.headerPlacement === applied.headerPlacement) restored.headerPlacement = backup.headerPlacement;
	if (applied.statusPlacement !== undefined && visual.statusPlacement === applied.statusPlacement) restored.statusPlacement = backup.statusPlacement ?? DEFAULT_STATUS;
	if (restored.headerPlacement === visual.headerPlacement && restored.statusPlacement === visual.statusPlacement) return false;
	writeJson(dir, VISUAL_FILE, restored);
	return true;
}

/** Restore only placement values previously owned by classic, retaining the card backup. */
export function migrateClassicLayout(options: Options = {}): boolean {
	const dir = options.configHome ?? resolveConfigHome();
	const backup = readBackup(dir);
	if (!backup?.appliedLayout) return false;
	const visual = readVisual(dir);
	readCard(dir);
	const changed = restoreLayout(dir, backup, visual);
	writeJson(dir, BACKUP_FILE, { schema: BACKUP_SCHEMA, ...backup, appliedLayout: null });
	return changed;
}

export function setClassicCardStyle(cardStyle: CardStyle, options: Options = {}): ClassicResult {
	if (!isCardStyle(cardStyle)) throw new TypeError(`Unknown card style: ${String(cardStyle)}`);
	const dir = options.configHome ?? resolveConfigHome();
	const visual = readVisual(dir), card = readCard(dir), backup = readBackup(dir);
	if (card === cardStyle && backup?.appliedCardStyle === cardStyle) return { changed: false, configHome: dir, message: "No changes." };
	writeJson(dir, BACKUP_FILE, { schema: BACKUP_SCHEMA, headerPlacement: backup?.headerPlacement ?? visual?.headerPlacement ?? DEFAULT_HEADER, statusPlacement: backup?.statusPlacement ?? visual?.statusPlacement ?? DEFAULT_STATUS, cardStyle: backup ? backup.cardStyle : card ?? null, appliedCardStyle: cardStyle, appliedLayout: backup?.appliedLayout ?? null });
	writeJson(dir, CARD_FILE, { schema: CARD_SCHEMA, style: cardStyle });
	return { changed: true, configHome: dir, message: `Classic card style: ${cardStyle}.` };
}

export function disableClassic(options: Options = {}): ClassicResult {
	const dir = options.configHome ?? resolveConfigHome();
	const backup = readBackup(dir);
	if (!backup) return { changed: false, configHome: dir, message: "Classic look is not active; nothing changed." };
	const visual = readVisual(dir);
	const card = readCard(dir);
	// Only undo what classic set; anything the user changed since then stays.
	restoreLayout(dir, backup, visual);
	if (card === backup.appliedCardStyle) {
		if (backup.cardStyle === null) removeIfPresent(join(dir, CARD_FILE));
		else writeJson(dir, CARD_FILE, { schema: CARD_SCHEMA, style: backup.cardStyle });
	}
	removeIfPresent(join(dir, BACKUP_FILE));
	return { changed: true, configHome: dir, message: "Classic look off; previous header placement and card style restored." };
}

export function classicStatus(options: Options = {}): ClassicStatus {
	const dir = options.configHome ?? resolveConfigHome();
	const visual = readVisual(dir);
	const backup = readBackup(dir);
	return {
		active: backup !== undefined,
		layout: backup?.appliedLayout ?? undefined,
		intact: !!backup?.appliedLayout && matchesLayout(visual, backup.appliedLayout),
		configHome: dir,
		headerPlacement: visual?.headerPlacement as string ?? DEFAULT_HEADER,
		statusPlacement: visual?.statusPlacement as string ?? DEFAULT_STATUS,
		cardStyle: readCard(dir) ?? "float",
	};
}
