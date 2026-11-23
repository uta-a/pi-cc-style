/**
 * Claude Code's tool rows for pi's tools.
 *
 *   ⏺ Read(src/index.ts)
 *     ⎿  Read 42 lines
 *
 * The call row (`Ote` + name + args): the dot is faint while the call waits, blinks every 600 ms
 * while it runs, and turns `success` / `error` when it ends. The name is bold, the arguments follow
 * in parentheses on one line. Result rows hang under it behind `  ⎿  ` (`Wn`).
 *
 * pi's tools map to Claude Code's: read → Read, bash → Bash, edit → Update, write → Write,
 * grep / find → Search, ls → List. Tools that draw themselves (Agent, set_todos, ...) keep their
 * renderers; other tools without a renderer get the generic row.
 */
import { isAbsolute, relative } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { countChanges, parseDiff, renderDiffRows } from "./diff.ts";
import { renderGroupRows, type ToolGroups } from "./grouping.ts";
import { clampLines, DOT, ELLIPSIS, moreLines, plural, sanitize, tildify } from "./format.ts";
import { type Component, resultRows } from "./messages.ts";
import type { Palette } from "./palette.ts";

export interface ToolCallState {
	executionStarted: boolean;
	isPartial: boolean;
	isError: boolean;
	hasResult: boolean;
	expanded: boolean;
}

/** `Ote`: the dot of a tool row. */
export function toolDot(p: Palette, state: ToolCallState, now = Date.now()): string {
	if (state.hasResult && !state.isPartial) return p.fg(state.isError ? "error" : "success", DOT);
	if (!state.executionStarted) return p.dim(DOT);
	return Math.floor(now / 600) % 2 === 0 ? p.dim(DOT) : " ";
}

export function callRow(p: Palette, state: ToolCallState, name: string, args: string, width: number, now?: number): string[] {
	const head = `${toolDot(p, state, now)} ${p.bold(name)}`;
	if (!args) return [truncateToWidth(head, width, "")];
	const room = width - visibleWidth(head) - 2;
	if (state.expanded) {
		// Verbose mode keeps the whole argument text and wraps it.
		const rows = wrapPlain(`${name}(${args})`, Math.max(1, width - 2)).map((line, i) =>
			i === 0 ? `${toolDot(p, state, now)} ${p.bold(line.slice(0, name.length))}${line.slice(name.length)}` : `  ${line}`,
		);
		return clampLines(rows, width);
	}
	const inner = room > 1 ? truncateToWidth(args, room, ELLIPSIS) : "";
	return [truncateToWidth(`${head}(${inner})`, width, "")];
}

function wrapPlain(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => hardWrap(line, width));
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** CSI (SGR and others), OSC and APC sequences, terminated by BEL or ST. */
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]_][^\x07\x1b]*(?:\x07|\x1b\\))/y;

function extractAnsiCode(line: string, at: number): { code: string; length: number } | undefined {
	ANSI.lastIndex = at;
	const m = ANSI.exec(line);
	return m ? { code: m[0], length: m[0].length } : undefined;
}

/**
 * Cuts a line into pieces of at most `width` columns in one pass, keeping ANSI styles: a wide
 * character that would straddle the edge starts the next piece, and each piece reopens the styles
 * active where it starts.
 */
export function hardWrap(line: string, width: number): string[] {
	if (width <= 0 || visibleWidth(line) <= width) return [line];
	const out: string[] = [];
	let piece = "";
	let used = 0;
	let active = "";
	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const ansi = extractAnsiCode(line, i);
			if (ansi) {
				piece += ansi.code;
				if (/^\x1b\[[0-9;:]*m$/.test(ansi.code)) active = /^\x1b\[0?m$/.test(ansi.code) ? "" : active + ansi.code;
				i += ansi.length;
				continue;
			}
		}
		let end = line.indexOf("\x1b", i + 1);
		if (end < 0) end = line.length;
		for (const { segment } of segmenter.segment(line.slice(i, end))) {
			const w = visibleWidth(segment);
			if (used > 0 && used + w > width) {
				out.push(active ? `${piece}\x1b[0m` : piece);
				piece = active;
				used = 0;
			}
			piece += segment;
			used += w;
		}
		i = end;
	}
	out.push(piece);
	return out;
}

/** How many rows `hardWrap` makes of a line, without building them. */
function wrappedRows(line: string, width: number): number {
	const w = visibleWidth(line);
	return w <= width ? 1 : Math.ceil(w / width);
}

/** `Po`: paths below the working directory are shown relative to it, others with ~. */
export function displayPath(path: string | undefined, cwd: string): string {
	if (!path) return "";
	if (isAbsolute(path)) {
		const rel = relative(cwd, path);
		if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
		return tildify(path);
	}
	return path;
}

/** Collapses a command to the first line for the one-line call row. */
export function oneLine(text: string): string {
	const lines = text.replace(/\r/g, "").split("\n");
	const first = lines[0] ?? "";
	return lines.length > 1 ? `${first} ${ELLIPSIS}` : first;
}

/**
 * `Lyi`: output wrapped hard at the width minus 10, the first three lines (four when only one
 * more would be hidden), then "… +N lines (ctrl+o to expand)" faint.
 */
export function truncatedOutput(p: Palette, text: string, columns: number, expandKey: string, tone: "plain" | "error" = "plain"): string[] {
	const trimmed = text.replace(/\s+$/, "");
	if (!trimmed) return [];
	const width = Math.max(columns - 10, 10);
	// Only the first rows are built; the rest are counted, so a huge output stays cheap.
	const wrapped: string[] = [];
	let total = 0;
	for (const line of trimmed.split("\n")) {
		if (wrapped.length < 4) {
			const rows = hardWrap(line.replace(/\t/g, "    "), width).map((l) => l.trimEnd());
			wrapped.push(...rows);
			total += rows.length;
		} else total += wrappedRows(line, width);
	}
	const hidden = total - 3;
	const shown = hidden === 1 ? wrapped.slice(0, 4) : wrapped.slice(0, 3);
	const color = (line: string) => (tone === "error" ? p.fg("error", line) : line);
	const lines = shown.map(color);
	if (hidden > 1) lines.push(p.dim(`${moreLines(hidden)} (${expandKey} to expand)`));
	return lines;
}

/** Full output for verbose mode. */
export function fullOutput(p: Palette, text: string, tone: "plain" | "error" = "plain", width?: number): string[] {
	const trimmed = text.replace(/\s+$/, "");
	if (!trimmed) return [];
	const lines = trimmed.split("\n");
	const wrapped = width === undefined ? lines : lines.flatMap((line) => hardWrap(line, Math.max(1, width)));
	return wrapped.map((line) => (tone === "error" ? p.fg("error", line) : line));
}

/** Wraps result lines to the room right of the elbow. */
function fit(lines: string[], width: number): string[] {
	const room = Math.max(1, width - 5);
	return lines.flatMap((line) => hardWrap(line, room));
}

export interface ToolResultLike {
	content?: { type: string; text?: string; data?: string; mimeType?: string }[];
	details?: unknown;
}

export function resultText(result: ToolResultLike | undefined): string {
	return (result?.content ?? [])
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => sanitize(c.text!))
		.join("\n");
}

/** Drops pi's trailing notices such as "[Showing lines 1-2000 of 5000. ...]". */
export function stripNotices(text: string): string {
	return text.replace(/(\n+\[[^\n]*\])+\s*$/, "").replace(/\n+$/, "");
}

export function countLines(text: string): number {
	if (!text) return 0;
	return text.replace(/\n$/, "").split("\n").length;
}

const b = (p: Palette, text: string | number) => p.bold(String(text));

export interface ResultContext {
	cwd: string;
	expanded: boolean;
	isError: boolean;
	isPartial: boolean;
	expandKey: string;
	highlight?: (code: string, path: string) => string;
}

/** `Cb`: an error result, in `error`, up to ten lines in normal mode, always starting with "Error: ". */
function errorRows(p: Palette, text: string, ctx: ResultContext): string[] {
	const trimmed = text.trim();
	const body = !trimmed ? "Error" : /^(Error|Cancelled): /.test(trimmed) ? trimmed : `Error: ${trimmed}`;
	const lines = body.split("\n");
	const shown = ctx.expanded ? lines : lines.slice(0, 10);
	const out = shown.map((line) => p.fg("error", line));
	if (!ctx.expanded && lines.length > 10) out.push(p.dim(`${moreLines(lines.length - 10)} (${ctx.expandKey} to expand)`));
	return out;
}

export interface ToolView {
	name: string;
	args(args: Record<string, unknown>, ctx: { cwd: string; expanded: boolean }): string;
	result?(p: Palette, args: Record<string, unknown>, result: ToolResultLike, ctx: ResultContext, width: number): string[];
}

function str(value: unknown): string {
	return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export const BUILTIN_VIEWS: Record<string, ToolView> = {
	read: {
		name: "Read",
		args(args, ctx) {
			const path = displayPath(str(args.path ?? args.file_path), ctx.cwd);
			const offset = typeof args.offset === "number" ? args.offset : undefined;
			const limit = typeof args.limit === "number" ? args.limit : undefined;
			if (ctx.expanded && (offset || limit)) {
				const start = offset ?? 1;
				return `${path} · ${limit ? `lines ${start}-${start + limit - 1}` : `from line ${start}`}`;
			}
			return path;
		},
		result(p, _args, result, ctx) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const image = result.content?.find((c) => c.type === "image");
			if (image) return ["Read image"];
			const n = countLines(stripNotices(resultText(result)));
			return [`Read ${b(p, n)} ${plural(n, "line")}`];
		},
	},
	bash: {
		name: "Bash",
		args(args, ctx) {
			const command = str(args.command);
			return ctx.expanded ? command : oneLine(command);
		},
		result(p, _args, result, ctx, width) {
			const text = resultText(result);
			const tone = ctx.isError ? "error" : "plain";
			const lines = ctx.expanded ? fullOutput(p, text, tone) : truncatedOutput(p, text, width, ctx.expandKey, tone);
			if (lines.length === 0) return ctx.isPartial ? [] : [p.dim("(No output)")];
			return lines;
		},
	},
	edit: {
		name: "Update",
		args(args, ctx) {
			return displayPath(str(args.path ?? args.file_path), ctx.cwd);
		},
		result(p, args, result, ctx, width) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const details = result.details as { diff?: string } | undefined;
			if (!details?.diff) return [p.dim(stripNotices(resultText(result)) || "Updated")];
			const items = parseDiff(sanitize(details.diff));
			const { added, removed } = countChanges(items);
			const parts: string[] = [];
			if (added > 0) parts.push(`Added ${b(p, added)} ${added > 1 ? "lines" : "line"}`);
			if (removed > 0) parts.push(`${added === 0 ? "R" : "r"}emoved ${b(p, removed)} ${removed > 1 ? "lines" : "line"}`);
			const path = str(args.path ?? args.file_path);
			const rows = renderDiffRows(p, items, Math.max(20, width - 12), {
				highlight: ctx.highlight ? (code) => ctx.highlight!(code, path) : undefined,
			});
			return [parts.join(", "), ...rows];
		},
	},
	write: {
		name: "Write",
		args(args, ctx) {
			return displayPath(str(args.path ?? args.file_path), ctx.cwd);
		},
		result(p, args, result, ctx) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const content = sanitize(str(args.content));
			const n = countLines(content);
			const path = displayPath(str(args.path ?? args.file_path), ctx.cwd);
			const out = [`Wrote ${b(p, n)} ${plural(n, "line")} to ${b(p, path)}`];
			const lines = content.replace(/\n$/, "").split("\n");
			const shown = ctx.expanded ? lines : lines.slice(0, 10);
			const rawPath = str(args.path ?? args.file_path);
			// `Hv`: the code view with a faint line-number gutter.
			const digits = String(shown.length).length;
			shown.forEach((line, i) => {
				const code = ctx.highlight ? ctx.highlight(line, rawPath) : line;
				out.push(`${p.dim(` ${String(i + 1).padStart(digits)} `)}${code}`);
			});
			if (!ctx.expanded && lines.length > 10) out.push(p.dim(`${moreLines(lines.length - 10)} (${ctx.expandKey} to expand)`));
			return out;
		},
	},
	grep: {
		name: "Search",
		args(args, ctx) {
			const parts = [`pattern: "${str(args.pattern).replace(/\n/g, "\\n")}"`];
			if (args.path) parts.push(`path: "${displayPath(str(args.path), ctx.cwd)}"`);
			if (args.glob) parts.push(`glob: "${str(args.glob)}"`);
			return parts.join(", ");
		},
		result(p, _args, result, ctx) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const text = stripNotices(resultText(result));
			const matches = /^No matches found/i.test(text) ? [] : text.split("\n").filter((l) => /^.+?[:-]\d+[:-]/.test(l) || /^.+?:\d+:/.test(l));
			const n = matches.length;
			const summary = `Found ${b(p, n)} ${n === 1 ? "line" : "lines"}`;
			if (ctx.expanded) return [summary, ...text.split("\n")];
			return [n > 0 ? `${summary} ${p.dim(`(${ctx.expandKey} to expand)`)}` : summary];
		},
	},
	find: {
		name: "Search",
		args(args, ctx) {
			const parts = [`pattern: "${str(args.pattern).replace(/\n/g, "\\n")}"`];
			if (args.path) parts.push(`path: "${displayPath(str(args.path), ctx.cwd)}"`);
			return parts.join(", ");
		},
		result(p, _args, result, ctx) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const text = stripNotices(resultText(result));
			const files = /^No files found/i.test(text) ? [] : text.split("\n").filter((l) => l.trim() && !l.startsWith("["));
			const n = files.length;
			const summary = `Found ${b(p, n)} ${n === 1 ? "file" : "files"}`;
			if (ctx.expanded) return [summary, ...files];
			return [n > 0 ? `${summary} ${p.dim(`(${ctx.expandKey} to expand)`)}` : summary];
		},
	},
	ls: {
		name: "List",
		args(args, ctx) {
			return displayPath(str(args.path) || ".", ctx.cwd);
		},
		result(p, _args, result, ctx) {
			if (ctx.isError) return errorRows(p, resultText(result), ctx);
			const text = stripNotices(resultText(result));
			const entries = /^\(empty directory\)/i.test(text) ? [] : text.split("\n").filter((l) => l.trim() && !l.startsWith("["));
			const n = entries.length;
			const summary = `Listed ${b(p, n)} ${n === 1 ? "path" : "paths"}`;
			if (ctx.expanded) return [summary, ...entries];
			return [n > 0 ? `${summary} ${p.dim(`(${ctx.expandKey} to expand)`)}` : summary];
		},
	},
};

/** Claude Code's generic row for other tools: `key: "value"` pairs, output truncated like Bash. */
export function genericArgs(args: Record<string, unknown>): string {
	return Object.entries(args ?? {})
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`)
		.join(", ");
}

export function genericView(name: string): ToolView {
	return {
		name,
		args: (args) => genericArgs(args),
		result(p, _args, result, ctx, width) {
			const text = resultText(result);
			if (ctx.isError) return errorRows(p, text, ctx);
			const lines = ctx.expanded ? fullOutput(p, text) : truncatedOutput(p, text, width, ctx.expandKey);
			if (lines.length === 0) return ctx.isPartial ? [] : [p.dim("(No output)")];
			return lines;
		},
	};
}

/** The call row as a component; it reads its state on every render so the dot can blink. */
export class CallRow implements Component {
	view: ToolView;
	args: Record<string, unknown> = {};
	state: ToolCallState = { executionStarted: false, isPartial: true, isError: false, hasResult: false, expanded: false };
	cwd: string;
	/** Set for calls that may be collapsed with neighbouring reads and searches. */
	grouping?: { id: string; groups: ToolGroups; expandKey: () => string };
	private readonly palette: () => Palette;
	constructor(view: ToolView, cwd: string, palette: () => Palette) {
		this.view = view;
		this.cwd = cwd;
		this.palette = palette;
	}
	render(width: number): string[] {
		if (this.grouping && !this.state.expanded) {
			const ids = this.grouping.groups.group(this.grouping.id);
			if (ids) {
				if (ids[0] !== this.grouping.id) return [];
				const show = (target: string, kind: string) => (kind === "search" ? `"${target}"` : displayPath(target, this.cwd));
				return clampLines(renderGroupRows(this.palette(), this.grouping.groups, ids, this.grouping.expandKey(), (t, k) => sanitize(show(t, k)).replace(/\n/g, " ")), width);
			}
		}
		const args = sanitize(this.view.args(this.args ?? {}, { cwd: this.cwd, expanded: this.state.expanded }));
		return callRow(this.palette(), this.state, this.view.name, args, width);
	}
	invalidate() {}
}

/** Result rows under the elbow. */
export class ResultRows implements Component {
	draw: (width: number) => string[] = () => [];
	/** Returns true while the call is folded into a group row. */
	collapsed: () => boolean = () => false;
	private readonly palette: () => Palette;
	constructor(palette: () => Palette) {
		this.palette = palette;
	}
	private cache: { width: number; draw: (width: number) => string[]; palette: Palette; lines: string[] } | undefined;
	render(width: number): string[] {
		if (this.collapsed()) return [];
		// The result only changes when pi calls renderResult again (a new draw) or the width changes.
		const p = this.palette();
		const c = this.cache;
		if (c && c.width === width && c.draw === this.draw && c.palette === p) return c.lines;
		const fitted = fit(this.draw(width), width);
		const lines = fitted.length > 0 ? clampLines(resultRows(fitted, p), width) : [];
		this.cache = { width, draw: this.draw, palette: p, lines };
		return lines;
	}
	invalidate() {}
}
