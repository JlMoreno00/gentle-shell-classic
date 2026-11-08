import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classicStatus, disableClassic, enableClassic, experimentalEnabled, setExperimental, migrateClassicLayout, setClassicCardStyle, type CardStyle, type ClassicLayout, type ClassicResult } from "../lib/classic.ts";
import { ClassicView, EXPERIMENTAL_DISCLAIMER, type Choice } from "../lib/classic-view.ts";
import { detectGentleVersion, canPatchGentleInstall, isSupportedGentleInstall, type GentleVersion } from "../lib/gentle-version.ts";
import { createPromptPatch } from "../lib/prompt-patch.ts";

const USAGE = "Usage: /gentle-classic [rail|top|off|status] [float|neon]";
const ACTIONS = ["rail", "top", "off", "status", "on", "neon", "float"];
const PLACEMENTS_NOTICE = "Header and Status position are set in /gentle:customize; with the experimental patch the classic prompt shows in any layout.";
// Gentle Shell emits this after /gentle:customize, its preset shortcut, or its panel change visual settings.
const VISUAL_SETTINGS_CHANGED = "gentle-pi.visual-settings-changed";
const BROKEN = "The classic prompt is off: Gentle Shell's header or Status placement changed. Run /gentle-classic to pick a classic layout again, or /gentle-classic off.";

const LAYOUT_LABELS: Record<ClassicLayout | "off", string> = {
	rail: "Classic with Status rail: info below the prompt",
	top: "Classic with info on top: no Status rail",
	off: "Off: Gentle Shell's own look",
};
const STYLE_LABELS: Record<CardStyle, string> = {
	float: "float: painted panel with a ▎ accent",
	neon: "neon: rounded ╭─ ✿ ─╮ frame",
};

/** `on` and a bare `neon` keep 0.1.0's meaning: the rail layout. */
function parseArgs(args: string): Choice | "status" | undefined {
	const [first = "", second, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (rest.length > 0 || (first && !ACTIONS.includes(first))) return undefined;
	if (first === "status") return second ? undefined : "status";
	if (first === "off") return second ? undefined : { layout: "off" };
	if (first === "neon" || first === "float") return second ? undefined : { layout: "rail", cardStyle: first };
	if (second !== undefined && second !== "float" && second !== "neon") return undefined;
	return { layout: first === "top" ? "top" : "rail", cardStyle: second as CardStyle | undefined };
}

function current(label: string, selected: boolean): string {
	return selected ? `${label}  (current)` : label;
}

async function pick(ctx: ExtensionContext, showExperimental: boolean): Promise<Choice | undefined> {
	const status = classicStatus();
	const active = status.active ? status.layout ?? "rail" : "off";
	if (typeof ctx.ui.custom === "function") {
		const choice = await ctx.ui.custom<Choice | null>((tui, theme, _keybindings, done) => {
			const view = new ClassicView({ layout: active, cardStyle: status.cardStyle, theme, showExperimental, experimental: experimentalEnabled(), onDone: done });
			return {
				render: (width: number) => view.render(width),
				invalidate: () => view.invalidate(),
				handleInput: (data: string) => { view.handleInput(data); tui.requestRender(); },
			};
		}, { overlay: true });
		if (!choice) return undefined;
		if (!showExperimental && choice.layout === active && !(choice.layout === "off" && experimentalEnabled()) && (choice.layout === "off" || choice.cardStyle === status.cardStyle) && (choice.experimental === undefined || choice.experimental === experimentalEnabled())) {
			ctx.ui.notify("No changes.", "info");
			return undefined;
		}
		return choice;
	}
	if (showExperimental) {
		const styles = Object.keys(STYLE_LABELS) as CardStyle[];
		const styleOptions = styles.map(key => current(STYLE_LABELS[key], key === status.cardStyle));
		const selectedStyle = await ctx.ui.select("Classic look · style", styleOptions);
		if (selectedStyle === undefined) return undefined;
		const choices = ["off", "on"];
		const selectedExperimental = await ctx.ui.select(`Experimental editor patch\n\n${EXPERIMENTAL_DISCLAIMER}`, choices);
		if (selectedExperimental === undefined) return undefined;
		if (selectedExperimental === "on" && !experimentalEnabled() && await ctx.ui.select(`Enable experimental editor patch?\n\n${EXPERIMENTAL_DISCLAIMER}`, ["No, keep it off", "Yes, enable the experimental patch"]) !== "Yes, enable the experimental patch") return undefined;
		return { layout: active, cardStyle: styles[styleOptions.indexOf(selectedStyle)], experimental: selectedExperimental === "on" };
	}
	const layouts = (Object.keys(LAYOUT_LABELS) as (ClassicLayout | "off")[]);
	const layoutOptions = layouts.map((key) => current(LAYOUT_LABELS[key], key === active));
	const layoutPick = await ctx.ui.select("Classic look · layout", layoutOptions);
	if (layoutPick === undefined) return undefined;
	const layout = layouts[layoutOptions.indexOf(layoutPick)];
	if (layout === "off") {
		if (active === "off" && !experimentalEnabled()) { ctx.ui.notify("No changes.", "info"); return undefined; }
		return { layout };
	}
	const styles = Object.keys(STYLE_LABELS) as CardStyle[];
	const styleOptions = styles.map((key) => current(STYLE_LABELS[key], key === status.cardStyle));
	const stylePick = await ctx.ui.select("Classic look · prompt frame and cards", styleOptions);
	if (stylePick === undefined) return undefined;
	const cardStyle = styles[styleOptions.indexOf(stylePick)];
	if (layout === active && cardStyle === status.cardStyle) { ctx.ui.notify("No changes.", "info"); return undefined; }
	return { layout, cardStyle };
}

async function apply(choice: Choice, ctx: ExtensionContext & { reload?: () => Promise<void> }): Promise<void> {
	const result: ClassicResult = choice.layout === "off" ? disableClassic() : enableClassic({ layout: choice.layout, cardStyle: choice.cardStyle });
	ctx.ui.notify(result.message, "info");
	// Gentle Shell reads these files on session start; a reload applies them now.
	if (result.changed && typeof ctx.reload === "function") await ctx.reload();
	else if (result.changed) ctx.ui.notify("Run /reload to apply.", "info");
}

export default function (pi: ExtensionAPI) {
	let session: ExtensionContext | undefined;
	let warned = false;
	const patch = createPromptPatch();
	let generation = 0;
	const retryTimers = new Set<ReturnType<typeof setTimeout>>();
	const clearRetries = () => {
		generation++;
		for (const timer of retryTimers) clearTimeout(timer);
		retryTimers.clear();
	};
	const refreshPatch = (ctx: ExtensionContext, install: GentleVersion, quiet = false) => {
		if (ctx.hasUI && canPatchGentleInstall(install) && experimentalEnabled()) patch.apply(ctx.ui as never, quiet);
	};
	const warnIfBroken = (ctx: ExtensionContext | undefined) => {
		if (!ctx?.hasUI) return;
		try {
			if (canPatchGentleInstall(detectGentleVersion(process.env, undefined, pi)) || experimentalEnabled()) { warned = false; return; }
			const status = classicStatus();
			if (status.active && !status.intact) {
				if (!warned) ctx.ui.notify(BROKEN, "warning");
				warned = true;
			} else warned = false;
		} catch { /* A malformed file is reported when the user runs the command. */ }
	};
	pi.on("session_start", (_event, ctx) => {
		session = ctx; warned = false;
		clearRetries();
		const currentGeneration = generation;
		const install = detectGentleVersion(process.env, undefined, pi);
		const version = install.version;
		try {
			// With the experimental patch on, the editor is classic whatever the placements, so the warning would be false.
			if (ctx.hasUI && !isSupportedGentleInstall(install) && classicStatus().layout && !experimentalEnabled()) ctx.ui.notify(install.unifiedEditor
				? `This Gentle Shell build (${version ?? "unknown"}, main channel: unified editor) always uses the new editor; the classic prompt may not show, and the classic look is verified only on Gentle Shell 4.6.x releases. Use the Experimental option, or /gentle-classic off to restore the previous settings.`
				: `Gentle Shell ${version ?? "unknown"}: the classic prompt may not show; /gentle-classic off restores the previous settings.`, "warning");
		} catch { /* Report malformed files when the command is run. */ }
		warnIfBroken(ctx);
		try {
			if (ctx.hasUI && experimentalEnabled()) {
				ctx.ui.notify("The experimental editor patch is active; it may break or misbehave on updates.", "warning");
				if (!canPatchGentleInstall(install)) return;
				refreshPatch(ctx, install, true);
				for (const delay of [0, 50, 200, 500]) {
					const timer = setTimeout(() => {
						retryTimers.delete(timer);
						if (generation !== currentGeneration) return;
						try { refreshPatch(ctx, install, delay !== 500); } catch { /* State errors are reported by the command. */ }
					}, delay);
					retryTimers.add(timer);
				}
			}
		} catch { /* Report malformed state when the command is run. */ }
	});
	pi.on("session_shutdown", () => { session = undefined; clearRetries(); });
	pi.events?.on(VISUAL_SETTINGS_CHANGED, () => warnIfBroken(session));

	pi.registerCommand("gentle-classic", {
		description: "Bring back the pre-4.6 Gentle Shell look (classic prompt frame and cards) using Gentle Shell's own settings.",
		getArgumentCompletions: (prefix: string) => ACTIONS.filter((action) => action.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const experimentalMatch = (args ?? "").trim().toLowerCase().match(/^experimental\s+(on|off)$/);
			if (experimentalMatch) {
				try {
					const install = detectGentleVersion(process.env, undefined, pi);
					const enabled = experimentalMatch[1] === "on";
					if (enabled && !canPatchGentleInstall(install)) { ctx.ui.notify("Experimental patch is available only on the unified editor or Gentle Shell versions newer than 4.6.x.", "warning"); return; }
					if (enabled && !experimentalEnabled()) {
						if (!ctx.hasUI || typeof ctx.ui.select !== "function" || await ctx.ui.select(`Enable experimental editor patch?\n\n${EXPERIMENTAL_DISCLAIMER}`, ["No, keep it off", "Yes, enable the experimental patch"]) !== "Yes, enable the experimental patch") return;
					}
					const migrated = enabled && migrateClassicLayout();
					setExperimental(enabled);
					if (enabled) refreshPatch(ctx, install); else { clearRetries(); patch.remove(ctx.ui as never); }
					ctx.ui.notify(`Experimental editor patch ${enabled ? "on" : "off"}.`, "warning");
					if (migrated && typeof ctx.reload === "function") await ctx.reload();
					else if (migrated) ctx.ui.notify("Run /reload to apply restored placements.", "info");
				} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
				return;
			}
			const parsed = parseArgs(args ?? "");
			if (parsed === undefined) {
				ctx.ui.notify(USAGE, "warning");
				return;
			}
			try {
				const install = detectGentleVersion(process.env, undefined, pi);
				const version = install.version;
				const unified = canPatchGentleInstall(install);
				const first = (args ?? "").trim().toLowerCase().split(/\s+/)[0];
				if (unified && (first === "rail" || first === "top" || first === "on")) { ctx.ui.notify(PLACEMENTS_NOTICE, "info"); return; }
				if (parsed === "status" || parsed.layout !== "off") refreshPatch(ctx, install);
				if (parsed === "status") {
					const status = classicStatus();
					if (unified) {
						ctx.ui.notify(`Experimental ${experimentalEnabled() ? "on" : "off"} · cards ${status.cardStyle} · header ${status.headerPlacement} · Status ${status.statusPlacement} · Gentle Shell ${version ?? "unknown"}${install.unifiedEditor ? " (main channel: unified editor; unsupported)" : " (unsupported)"} · ${status.configHome}`, "info");
						return;
					}
					const state = !status.active ? "off" : `${status.layout}${status.intact ? "" : " (broken: settings changed since)"}`;
					ctx.ui.notify(`Classic look ${state} · Gentle Shell ${version ?? "unknown"} (${install.unifiedEditor ? "main channel: unified editor; unsupported" : isSupportedGentleInstall(install) ? "supported" : "unsupported"}) · header ${status.headerPlacement} · Status ${status.statusPlacement} · cards ${status.cardStyle} · ${status.configHome}`, status.active && !status.intact ? "warning" : "info");
					return;
				}
				// A bare /gentle-classic opens the picker in an interactive terminal.
				const choice = !(args ?? "").trim() && ctx.hasUI && (typeof ctx.ui.custom === "function" || typeof ctx.ui.select === "function") ? await pick(ctx, canPatchGentleInstall(install)) : parsed;
				if (choice === undefined) return;
				if (unified && first !== "off") {
					const migrated = !first && migrateClassicLayout();
					if (choice.experimental !== undefined && choice.experimental !== experimentalEnabled()) {
						setExperimental(choice.experimental);
						if (choice.experimental) refreshPatch(ctx, install); else { clearRetries(); patch.remove(ctx.ui as never); }
					}
					const result = setClassicCardStyle(choice.cardStyle ?? "float");
					ctx.ui.notify(result.message, "info");
					if ((result.changed || migrated) && typeof ctx.reload === "function") await ctx.reload();
					else if (result.changed || migrated) ctx.ui.notify("Run /reload to apply.", "info");
					return;
				}
				const optIn = choice.experimental ?? experimentalEnabled();
				if (choice.layout !== "off" && !isSupportedGentleInstall(install) && !(canPatchGentleInstall(install) && optIn)) {
					ctx.ui.notify(install.unifiedEditor
						? `This Gentle Shell build (${version ?? "unknown"}, main channel: unified editor) always uses the new editor; the classic look is verified only on Gentle Shell 4.6.x releases. Use the Experimental option, or /gentle-classic off.`
						: `Gentle Shell ${version ?? "unknown"}: the classic look is verified only on Gentle Shell 4.6.x.`, "warning");
					return;
				}
				if (choice.layout === "off") { clearRetries(); patch.remove(ctx.ui as never); if (experimentalEnabled()) setExperimental(false); }
				else if (choice.experimental !== undefined && choice.experimental !== experimentalEnabled()) {
					setExperimental(choice.experimental);
					if (choice.experimental) refreshPatch(ctx, install); else { clearRetries(); patch.remove(ctx.ui as never); }
				}
				await apply(choice, ctx);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
