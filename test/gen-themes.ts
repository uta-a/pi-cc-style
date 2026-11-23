/**
 * Writes theme/claude-code-*.json from the Claude Code theme table:
 *   node test/gen-themes.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTheme, THEME_IDS, themeName } from "../extension/themes.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "theme");
mkdirSync(dir, { recursive: true });
for (const id of THEME_IDS) {
	writeFileSync(join(dir, `${themeName(id)}.json`), `${JSON.stringify(buildTheme(id), null, "\t")}\n`);
}
console.log(`wrote ${THEME_IDS.length} themes to ${dir}`);
