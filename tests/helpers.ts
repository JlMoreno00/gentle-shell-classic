import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function scratch(): string {
	const root = fileURLToPath(new URL("../.tmp/", import.meta.url));
	mkdirSync(root, { recursive: true });
	return mkdtempSync(join(root, "gsc-"));
}
