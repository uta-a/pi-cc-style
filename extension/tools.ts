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
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { countChanges, parseDiff, renderDiffRows } from "./diff.ts";
import { renderGroupRow, type ToolGroups } from "./grouping.ts";
import { DOT, ELLIPSIS, moreLines, plural, tildify } from "./format.ts";
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
		return wrapPlain(`${name}(${args})`, width - 2).map((line, i) =>
			i === 0 ? `${toolDot(p, state, now)} ${p.bold(line.slice(0, name.length))}${line.slice(name.length)}` : `  ${line}`,
		);
	}
	const inner = room > 1 ? truncateToWidth(args, room, ELLIPSIS) : "";
	return [truncateToWidth(`${head}(${inner})`, width, "")];
}

function wrapPlain(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => hardWrap(line, width));
}

/** Cuts a line every `width` columns, keeping ANSI styles intact. */
export function hardWrap(line: string, width: number): string[] {
	const total = visibleWidth(line);
	if (width <= 0 || total <= width) return [line];
	const out: string[] = [];
	for (let col = 0; col < total; col += width) out.push(sliceByColumn(line, col, width));
	return out;
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
	const wrapped = trimmed.split("\n").flatMap((raw) => hardWrap(raw.replace(/\t/g, "    "), width).map((l) => l.trimEnd()));
	const hidden = wrapped.length - 3;
	const shown = hidden === 1 ? wrapped.slice(0, 4) : wrapped.slice(0, 3);
	const color = (line: string) => (tone === "error" ? p.fg("error", line) : line);
	const lines = shown.map(color);
	if (hidden > 1) lines.push(p.dim(`${moreLines(hidden)} (${expandKey} to expand)`));
	return lines;
}

/** Full output for verbose mode. */
export function fullOutput(p: Palette, text: string, tone: "plain" | "error" = "plain"): string[] {
	const trimmed = text.replace(/\s+$/, "");
	if (!trimmed) return [];
	return trimmed.split("\n").map((line) => (tone === "error" ? p.fg("error", line) : line));
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
		.map((c) => c.text)
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

/** `Cb`: an error result, in `error`, up to ten lines in normal mode. */
function errorRows(p: Palette, text: string, ctx: ResultContext): string[] {
	const body = text.trim() || "Error";
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
			const items = parseDiff(details.diff);
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
			const content = str(args.content);
			const n = countLines(content);
			const path = displayPath(str(args.path ?? args.file_path), ctx.cwd);
			const out = [`Wrote ${b(p, n)} ${plural(n, "line")} to ${b(p, path)}`];
			const lines = content.replace(/\n$/, "").split("\n");
			const shown = ctx.expanded ? lines : lines.slice(0, 10);
			const rawPath = str(args.path ?? args.file_path);
			for (const line of shown) out.push(ctx.highlight ? ctx.highlight(line, rawPath) : line);
			if (!ctx.expanded && lines.length > 10) out.push(p.dim(moreLines(lines.length - 10)));
			return out;
		},
	},
	grep: {
		name: "Search",
		args(args, ctx) {
			const parts = [`pattern: "${str(args.pattern)}"`];
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
			const parts = [`pattern: "${str(args.pattern)}"`];
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
				return [truncateToWidth(renderGroupRow(this.palette(), this.grouping.groups, ids, this.grouping.expandKey()), width, "")];
			}
		}
		const args = this.view.args(this.args ?? {}, { cwd: this.cwd, expanded: this.state.expanded });
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
	render(width: number): string[] {
		if (this.collapsed()) return [];
		const lines = fit(this.draw(width), width);
		return lines.length > 0 ? resultRows(lines, this.palette()) : [];
	}
	invalidate() {}
}
