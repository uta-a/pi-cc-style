/**
 * The startup header of Claude Code 2.1.330 (`N5t`): Clawd on the left, a gap of two columns,
 * then three lines: the product name with its version, the model and billing, and the directory.
 * There is no box and no tips in this version.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Palette } from "./palette.ts";

/** `J.down`, `K.open`, `M.both`: Clawd's default pose. */
const CLAWD = {
	row0Left: " ▐",
	eyes: "▛███▛█",
	row1Left: "▝▜",
	row1Body: "█████",
	row1Right: "█▀",
	feet: " ▝▝   ▝▝ ",
} as const;

export const CLAWD_WIDTH = 9;

/** Clawd's three rows; the eyes and the middle of the body sit on `clawd_background`. */
export function renderClawd(p: Palette): string[] {
	const body = (text: string) => p.fg("clawd_body", text);
	const onBackground = (text: string) => p.style(text, { color: "clawd_body", backgroundColor: "clawd_background" });
	const pad = (line: string) => line + " ".repeat(Math.max(0, CLAWD_WIDTH - visibleWidth(line)));
	return [
		pad(body(CLAWD.row0Left) + onBackground(CLAWD.eyes)),
		pad(body(CLAWD.row1Left) + onBackground(CLAWD.row1Body) + body(CLAWD.row1Right)),
		pad(body(CLAWD.feet)),
	];
}

export interface HeaderInfo {
	title: string;
	version: string;
	/** Model display name, e.g. "Opus 5.5". */
	model?: string;
	/** Thinking level shown as " with <level> effort"; omitted when off or unknown. */
	effort?: string;
	/** Second half of the model line; Claude Code shows the billing type here. */
	billing?: string;
	cwd: string;
}

/** `lcn`: " with <level> effort". */
export function effortSuffix(effort: string | undefined): string {
	if (!effort || effort === "off") return "";
	return ` with ${effort} effort`;
}

export function renderHeader(p: Palette, info: HeaderInfo, width: number): string[] {
	const clawd = renderClawd(p);
	const textWidth = Math.max(10, width - CLAWD_WIDTH - 2);
	const modelText = [info.model ? `${info.model}${effortSuffix(info.effort)}` : undefined, info.billing]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
	const lines = [
		`${p.bold(info.title)} ${p.dim(`v${info.version}`)}`,
		modelText ? p.dim(truncateToWidth(modelText, textWidth, "…")) : "",
		p.dim(truncateStart(info.cwd, textWidth)),
	];
	return clawd.map((row, i) => truncateToWidth(`${row}  ${lines[i] ?? ""}`, width, ""));
}

/** Ink's `truncate-start`: keeps the end of a path. */
export function truncateStart(text: string, width: number): string {
	if (visibleWidth(text) <= width) return text;
	const chars = Array.from(text);
	let out = "";
	for (let i = chars.length - 1; i >= 0; i--) {
		const next = chars[i] + out;
		if (visibleWidth(next) + 1 > width) break;
		out = next;
	}
	return `…${out}`;
}
