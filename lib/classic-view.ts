import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CardStyle, ClassicLayout } from "./classic.ts";

export const EXPERIMENTAL_DISCLAIMER = "Experimental: patches Gentle Shell's private editor internals; unsupported by Gentle Shell; may break or misbehave on any update. Undo: /gentle-classic experimental off or /gentle-classic off.";
export interface Choice { layout: ClassicLayout | "off"; cardStyle?: CardStyle; experimental?: boolean }
interface Theme { fg(role: string, text: string): string; bg?(role: string, text: string): string }
interface Options { layout: Choice["layout"]; cardStyle: CardStyle; experimental?: boolean; showExperimental?: boolean; theme: Theme; onDone(choice: Choice | null): void }
const layouts = ["rail", "top", "off"] as const;
const styles = ["float", "neon"] as const;
const preview: Record<Choice["layout"] | CardStyle, string> = {
	rail: "Classic prompt frame · Status rail (sidebar) kept · session info below the prompt",
	top: "Classic prompt frame · session info on top · no Status rail (sidebar hidden)",
	off: "Gentle Shell's own 4.6 look",
	float: "Painted panel with a ▎ accent",
	neon: "Rounded ╭─ ✿ ─╮ frame",
};

export class ClassicView {
	private layout: Choice["layout"];
	private cardStyle: CardStyle;
	private focused = 0;
	private experimental: boolean;
	private confirming = false;
	private completed = false;
	private readonly options: Options;
	constructor(options: Options) {
		this.options = options;
		this.layout = options.layout;
		this.cardStyle = options.cardStyle;
		this.experimental = options.experimental ?? false;
		if (options.showExperimental) this.focused = 1;
	}
	invalidate(): void {}
	handleInput(data: string): void {
		if (this.completed || isKeyRelease(data)) return;
		if (this.confirming) {
			this.confirming = false;
			if (data.toLowerCase() === "y") this.finish({ layout: this.layout, ...(this.options.showExperimental || this.layout !== "off" ? { cardStyle: this.cardStyle } : {}), experimental: true });
			return;
		}
		if (matchesKey(data, "escape")) { this.finish(null); return; }
		if (matchesKey(data, "enter")) {
			if (this.options.showExperimental && this.experimental && !this.options.experimental) { this.confirming = true; return; }
			this.finish({ ...(this.layout === "off" && !this.options.showExperimental ? { layout: "off" as const } : { layout: this.layout, cardStyle: this.cardStyle }), ...(this.options.showExperimental ? { experimental: this.experimental } : {}) });
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			const available = this.options.showExperimental ? [1, 2] : this.layout !== "off" ? [0, 1] : [0];
			this.focused = available[(available.indexOf(this.focused) + 1) % available.length]!;
			return;
		}
		const delta = matchesKey(data, "right") ? 1 : matchesKey(data, "left") ? -1 : 0;
		if (!delta) return;
		if (this.focused === 0) this.layout = layouts[(layouts.indexOf(this.layout) + delta + layouts.length) % layouts.length]!;
		else if (this.focused === 1) this.cardStyle = styles[(styles.indexOf(this.cardStyle) + delta + styles.length) % styles.length]!;
		else this.experimental = !this.experimental;
	}
	private finish(choice: Choice | null): void { this.completed = true; this.options.onDone(choice); }
	private setting(name: string, values: readonly string[], current: string, pending: string, focused: boolean, disabled: boolean, width: number): string {
		const { theme } = this.options;
		const prefix = focused ? theme.fg("accent", "▸ ") : "  ";
		const label = theme.fg(focused ? "text" : "muted", name.padEnd(6) + "  ");
		const choices = disabled ? theme.fg("muted", "(not used)") : values.map(value => {
			const cursor = focused && value === pending && value !== current;
			return theme.fg(value === current || cursor ? "accent" : "muted", `${value === current ? "●" : cursor ? "›" : "○"} ${value}`);
		}).join("  ");
		const line = truncateToWidth(prefix + label + choices, width, "…");
		const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
		return focused && theme.bg ? theme.bg("selectedBg", padded) : padded;
	}
	render(width: number): string[] {
		width = Math.max(0, Math.floor(width));
		if (!width) return [];
		const { theme } = this.options;
		if (width < 5) return [truncateToWidth(theme.fg("accent", "Gentle Shell Classic"), width, "")];
		const inner = width - 4;
		const description = this.confirming || this.focused === 2 ? EXPERIMENTAL_DISCLAIMER : this.options.showExperimental ? `${preview[this.cardStyle]}. Header and Status positions are set in /gentle:customize; the experimental patch works in any layout.` : preview[this.focused === 0 ? this.layout : this.cardStyle];
		const wrapped: string[] = [];
		let line = "";
		for (const word of description.split(" ")) {
			const next = line ? `${line} ${word}` : word;
			if (visibleWidth(next) > inner && line) { wrapped.push(line); line = word; } else line = next;
		}
		if (line) wrapped.push(line);
		const lines = [theme.fg("accent", "Gentle Shell Classic"), theme.fg("accent", `Classic look · ${this.options.showExperimental ? this.focused : this.focused + 1}/2`), "",
			...(!this.options.showExperimental ? [this.setting("Layout", layouts, this.options.layout, this.layout, this.focused === 0, false, inner)] : []),
			this.setting("Style", styles, this.options.cardStyle, this.cardStyle, this.focused === 1, !this.options.showExperimental && this.layout === "off", inner),
			...(this.options.showExperimental ? [this.setting("Experimental", ["off", "on"], this.options.experimental ? "on" : "off", this.experimental ? "on" : "off", this.focused === 2, false, inner)] : []), "",
			...wrapped.map(value => theme.fg("muted", value)), "", theme.fg("muted", this.confirming ? "y confirm · any other key cancel" : "↑/↓ settings · ←/→ choose · Enter apply · Esc close")];
		const border = (s: string) => theme.fg("border", s);
		const horizontal = "─".repeat(width - 2);
		return [border(`╭${horizontal}╮`), ...lines.map(value => {
			const fitted = truncateToWidth(value, inner, "…");
			return `${border("│")} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${border("│")}`;
		}), border(`╰${horizontal}╯`)];
	}
}
