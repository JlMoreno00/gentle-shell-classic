const OWNER = Symbol.for("gentle-pi.prompt-owner");
type Factory = ((...args: any[]) => any) & { [OWNER]?: boolean };
type UI = { getEditorComponent(): Factory | undefined; setEditorComponent(factory: Factory | undefined): void; notify(message: string, level: "warning"): void };

/** Experimental: wrap only Gentle's own editor; never change its module on disk. */
export function createPromptPatch() {
	let original: Factory | undefined;
	let wrapper: Factory | undefined;
	let warned = false;
	const restored: Array<() => void> = [];
	function warn(ui: UI) {
		if (!warned) ui.notify("Experimental patch could not find Gentle Shell's editor chrome; no editor was patched.", "warning");
		warned = true;
	}
	return {
		apply(ui: UI, quiet = false) {
			const factory = ui.getEditorComponent();
			if (factory === wrapper && wrapper) return;
			if (!factory || !factory[OWNER]) { if (!quiet) warn(ui); return; }
			original = factory;
			const next = ((...args: any[]) => {
				const editor = factory(...args);
				const deps = editor?.deps;
				if (!deps || typeof deps !== "object" || typeof deps.panelChrome !== "function") { warn(ui); return editor; }
				const chrome = deps.panelChrome, button = deps.panelButton;
				const disabled = () => false;
				deps.panelChrome = disabled;
				if (typeof button === "function") deps.panelButton = disabled;
				restored.push(() => {
					if (deps.panelChrome === disabled) deps.panelChrome = chrome;
					if (deps.panelButton === disabled) deps.panelButton = button;
				});
				return editor;
			}) as Factory;
			for (const key of Reflect.ownKeys(factory)) {
				const descriptor = Object.getOwnPropertyDescriptor(factory, key);
				if (descriptor) Object.defineProperty(next, key, descriptor);
			}
			wrapper = next;
			ui.setEditorComponent(next);
		},
		remove(ui: UI) {
			if (wrapper && ui.getEditorComponent() === wrapper) ui.setEditorComponent(original);
			for (const restore of restored.splice(0)) restore();
			wrapper = undefined;
			original = undefined;
		},
	};
}
