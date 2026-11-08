import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

type Env = Record<string, string | undefined>;
export interface GentleVersion { version?: string; source: string; unifiedEditor?: boolean }

function foundPackage(version: string, path: string): GentleVersion {
	let unifiedEditor = false;
	try { unifiedEditor = readFileSync(join(dirname(path), "extensions", "gentle-shell.ts"), "utf8").includes("chromeBarsShown"); } catch { /* If unreadable, use the version alone. */ }
	return { version, source: path, unifiedEditor };
}

/** Only stable 4.6 releases are verified; prereleases are not included. */
export function isSupportedGentleVersion(version: string | undefined): boolean {
	return typeof version === "string" && /^4\.6\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

export function isNewerGentleVersion(version: string | undefined): boolean {
	const match = version?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
	return !!match && (+match[1]! > 4 || (+match[1]! === 4 && +match[2]! >= 7));
}

export function isSupportedGentleInstall(install: GentleVersion): boolean {
	return !install.unifiedEditor && isSupportedGentleVersion(install.version);
}
export function canPatchGentleInstall(install: GentleVersion): boolean {
	return !!install.unifiedEditor || isNewerGentleVersion(install.version);
}

/** Detect the personal npm install only when it is actually declared in agent settings. */
export function detectGentleVersion(env: Env = process.env, home = homedir(), pi?: { getCommands(): { name: string; sourceInfo?: { path?: string; baseDir?: string } }[] }): GentleVersion {
	try {
		const command = pi?.getCommands().find(item => item.name === "gentle:customize");
		for (const candidate of [command?.sourceInfo?.path, command?.sourceInfo?.baseDir]) {
			if (!candidate || !isAbsolute(candidate)) continue;
			let current = candidate;
			for (;;) {
				try {
					const path = join(current, "package.json");
					const pkg = JSON.parse(readFileSync(path, "utf8"));
					if (pkg.name === "gentle-pi" && typeof pkg.version === "string") return foundPackage(pkg.version, path);
				} catch { /* Continue toward the filesystem root. */ }
				const parent = dirname(current);
				if (parent === current) break;
				current = parent;
			}
		}
	} catch { /* No public command metadata; try the configured npm install. */ }
	const dir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
	try {
		const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
		const declared = Array.isArray(settings.packages) && settings.packages.some((entry: unknown) => {
			const source = typeof entry === "string" ? entry : entry && typeof entry === "object" && "source" in entry ? entry.source : undefined;
			return typeof source === "string" && /^npm:gentle-pi(?:@.*)?$/.test(source);
		});
		if (!declared) return { source: "unknown" };
		const path = join(dir, "npm", "node_modules", "gentle-pi", "package.json");
		const pkg = JSON.parse(readFileSync(path, "utf8"));
		if (pkg.name === "gentle-pi" && typeof pkg.version === "string") return foundPackage(pkg.version, path);
	} catch { /* Missing or invalid metadata must not imply compatibility. */ }
	return { source: "unknown" };
}
