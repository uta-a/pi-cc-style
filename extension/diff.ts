/**
 * Claude Code's structured diff (the color-diff renderer of 2.1.330).
 *
 * Each row is ` <line number> ` + marker + code. Added and removed rows sit on `diffAdded` /
 * `diffRemoved` up to the full width, their gutter and marker in a decoration colour, and the
 * words that changed inside a removed/added pair on `diffAddedWord` / `diffRemovedWord` when no
 * more than 40% of the pair changed. Context rows have a faint gutter and no background. The code
 * keeps its syntax colours; long lines wrap with the gutter left blank.
 *
 * Input is pi's display diff (`+12 text`, `-12 text`, ` 12 text`, `   ...`).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Palette, RGB } from "./palette.ts";

export type Marker = "+" | "-" | " ";

export interface DiffRow {
	marker: Marker;
	lineNumber: number;
	code: string;
}

export type DiffItem = DiffRow | { gap: true };

export function parseDiff(diff: string): DiffItem[] {
	const items: DiffItem[] = [];
	for (const raw of diff.split("\n")) {
		const m = /^([+\- ])\s*(\d+) (.*)$/.exec(raw);
		if (m) {
			items.push({ marker: m[1] as Marker, lineNumber: Number(m[2]), code: m[3] ?? "" });
		} else if (/^\s*\.\.\.\s*$/.test(raw) || /^ \s+\.\.\.$/.test(raw)) {
			if (items.length > 0 && !("gap" in items[items.length - 1]!)) items.push({ gap: true });
		}
	}
	while (items.length > 0 && "gap" in items[items.length - 1]!) items.pop();
	return items;
}

export function countChanges(items: DiffItem[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const item of items) {
		if ("gap" in item) continue;
		if (item.marker === "+") added++;
		else if (item.marker === "-") removed++;
	}
	return { added, removed };
}

/** `z`: words (letters, digits, _), runs of whitespace, or single other characters. */
export function tokenize(text: string): string[] {
	const out: string[] = [];
	let i = 0;
	const word = /[\p{L}\p{N}_]/u;
	while (i < text.length) {
		const ch = text[i]!;
		if (word.test(ch)) {
			let j = i + 1;
			while (j < text.length && word.test(text[j]!)) j++;
			out.push(text.slice(i, j));
			i = j;
		} else if (/\s/.test(ch)) {
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j]!)) j++;
			out.push(text.slice(i, j));
			i = j;
		} else {
			const size = (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
			out.push(text.slice(i, i + size));
			i += size;
		}
	}
	return out;
}

interface Range {
	start: number;
	end: number;
}

/** Token LCS, then the removed / added character ranges (`We`); none when more than 40% changed. */
export function wordRanges(before: string, after: string): [Range[], Range[]] {
	const a = tokenize(before);
	const b = tokenize(after);
	if (a.length * b.length > 250_000) return [[], []];
	const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}
	const removed: Range[] = [];
	const added: Range[] = [];
	let i = 0;
	let j = 0;
	let posA = 0;
	let posB = 0;
	let changed = 0;
	const push = (list: Range[], start: number, len: number) => {
		const last = list[list.length - 1];
		if (last && last.end === start) last.end += len;
		else list.push({ start, end: start + len });
	};
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			posA += a[i]!.length;
			posB += b[j]!.length;
			i++;
			j++;
		} else if (j < b.length && (i >= a.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
			push(added, posB, b[j]!.length);
			changed += b[j]!.length;
			posB += b[j]!.length;
			j++;
		} else {
			push(removed, posA, a[i]!.length);
			changed += a[i]!.length;
			posA += a[i]!.length;
			i++;
		}
	}
	const total = before.length + after.length;
	if (total > 0 && changed / total > 0.4) return [[], []];
	return [removed, added];
}

/** `_e`: pairs each run of removed rows with the added rows that follow it, position by position. */
export function pairRows(rows: DiffRow[]): [number, number][] {
	const pairs: [number, number][] = [];
	let i = 0;
	while (i < rows.length) {
		if (rows[i]!.marker !== "-") {
			i++;
			continue;
		}
		const start = i;
		while (i < rows.length && rows[i]!.marker === "-") i++;
		const addStart = i;
		while (i < rows.length && rows[i]!.marker === "+") i++;
		const n = Math.min(addStart - start, i - addStart);
		for (let k = 0; k < n; k++) pairs.push([start + k, addStart + k]);
	}
	return pairs;
}

/** `ee`: the decoration colours of the gutter and marker, per theme. */
function decoration(p: Palette, marker: "+" | "-"): RGB | number {
	const id = p.id;
	if (id.endsWith("-ansi")) return marker === "+" ? 10 : 9;
	const dark = id.startsWith("dark");
	if (id.endsWith("daltonized")) {
		if (marker === "+") return dark ? { r: 81, g: 160, b: 200 } : { r: 36, g: 87, b: 138 };
		return dark ? { r: 220, g: 90, b: 90 } : { r: 207, g: 34, b: 46 };
	}
	if (marker === "+") return dark ? { r: 80, g: 200, b: 80 } : { r: 36, g: 138, b: 61 };
	return dark ? { r: 220, g: 90, b: 90 } : { r: 207, g: 34, b: 46 };
}

interface Segment {
	text: string;
	/** SGR parameters of the foreground, or undefined for the default. */
	fg?: string;
	bg?: string;
}

/** Splits an ANSI string into runs of plain text with their foreground colour. */
export function ansiSegments(text: string): Segment[] {
	const out: Segment[] = [];
	let fg: string | undefined;
	const re = /\x1b\[([0-9;]*)m/g;
	let last = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index), fg });
		last = re.lastIndex;
		const params = m[1] ?? "";
		const parts = params.split(";");
		for (let k = 0; k < parts.length; k++) {
			const code = Number(parts[k] || 0);
			if (code === 0 || code === 39) fg = undefined;
			else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = String(code);
			else if (code === 38) {
				if (parts[k + 1] === "2") {
					fg = parts.slice(k, k + 5).join(";");
					k += 4;
				} else if (parts[k + 1] === "5") {
					fg = parts.slice(k, k + 3).join(";");
					k += 2;
				}
			} else if (code === 48) {
				k += parts[k + 1] === "2" ? 4 : 2;
			}
		}
	}
	if (last < text.length) out.push({ text: text.slice(last), fg });
	return out.filter((s) => s.text.length > 0);
}

function bgCode(p: Palette, color: string | RGB | number): string {
	return p.style("x", { backgroundColor: typeof color === "number" ? String(color) : color }).match(/\x1b\[([0-9;]*)m/)?.[1] ?? "";
}

function fgCodeOf(p: Palette, color: RGB | number | string): string {
	if (typeof color === "number") return color < 8 ? String(30 + color) : String(90 + color - 8);
	return p.style("x", { color }).match(/\x1b\[([0-9;]*)m/)?.[1] ?? "";
}

/** Gives the characters inside `ranges` the `wordBg` background and the rest `lineBg`. */
function applyBackground(segments: Segment[], lineBg: string | undefined, wordBg: string | undefined, ranges: Range[]): Segment[] {
	if (!lineBg && ranges.length === 0) return segments;
	const out: Segment[] = [];
	let pos = 0;
	for (const seg of segments) {
		let start = 0;
		while (start < seg.text.length) {
			const abs = pos + start;
			const inside = ranges.find((r) => abs >= r.start && abs < r.end);
			let end: number;
			if (inside) end = Math.min(seg.text.length, inside.end - pos);
			else {
				const next = ranges.filter((r) => r.start > abs).reduce((min, r) => Math.min(min, r.start), Infinity);
				end = Math.min(seg.text.length, next - pos);
			}
			out.push({ text: seg.text.slice(start, end), fg: seg.fg, bg: inside && wordBg ? wordBg : lineBg });
			start = end;
		}
		pos += seg.text.length;
	}
	return out;
}

/** Hard-wraps segments at `width` columns, like Claude Code (not at word boundaries). */
function wrapSegments(segments: Segment[], width: number): Segment[][] {
	const rows: Segment[][] = [[]];
	let col = 0;
	for (const seg of segments) {
		let current = "";
		for (const ch of Array.from(seg.text)) {
			const w = Math.max(0, visibleWidth(ch));
			if (col + w > width && col > 0) {
				if (current) rows[rows.length - 1]!.push({ ...seg, text: current });
				rows.push([]);
				current = "";
				col = 0;
			}
			current += ch;
			col += w;
		}
		if (current) rows[rows.length - 1]!.push({ ...seg, text: current });
	}
	return rows;
}

function serialize(segments: Segment[]): string {
	let out = "";
	for (const seg of segments) {
		const codes = [seg.fg, seg.bg].filter(Boolean).join(";");
		out += codes ? `\x1b[${codes}m${seg.text}\x1b[39;49m` : seg.text;
	}
	return out;
}

export interface DiffRenderOptions {
	/** Highlights one line of code; returns it with ANSI foreground colours. */
	highlight?: (code: string) => string;
	/** Draw the whole diff faint (Claude Code's `dim` diffs). */
	dim?: boolean;
}

/** Renders the rows at `width` columns (Claude Code passes the terminal width minus 12). */
export function renderDiffRows(p: Palette, items: DiffItem[], width: number, options: DiffRenderOptions = {}): string[] {
	const rows = items.filter((item): item is DiffRow => !("gap" in item));
	const digits = String(rows.reduce((max, r) => Math.max(max, r.lineNumber), 0)).length;
	const codeWidth = Math.max(1, width - digits - 2 - 1);
	const ranges = new Map<DiffRow, Range[]>();
	for (const [a, b] of pairRows(rows)) {
		const [removed, added] = wordRanges(rows[a]!.code, rows[b]!.code);
		ranges.set(rows[a]!, removed);
		ranges.set(rows[b]!, added);
	}
	const addedBg = bgCode(p, options.dim ? "diffAddedDimmed" : "diffAdded");
	const removedBg = bgCode(p, options.dim ? "diffRemovedDimmed" : "diffRemoved");
	const addedWord = bgCode(p, "diffAddedWord");
	const removedWord = bgCode(p, "diffRemovedWord");
	const out: string[] = [];
	for (const item of items) {
		if ("gap" in item) {
			out.push(p.dim(`${" ".repeat(digits + 1)}...`));
			continue;
		}
		const changed = item.marker !== " ";
		const lineBg = item.marker === "+" ? addedBg : item.marker === "-" ? removedBg : undefined;
		const wordBg = item.marker === "+" ? addedWord : item.marker === "-" ? removedWord : undefined;
		const code = item.code.replace(/\t/g, "        ");
		const highlighted = options.highlight ? options.highlight(code) : code;
		const segments = applyBackground(ansiSegments(highlighted), lineBg, wordBg, ranges.get(item) ?? []);
		const wrapped = wrapSegments(segments, codeWidth);
		const deco = changed ? fgCodeOf(p, decoration(p, item.marker as "+" | "-")) : undefined;
		wrapped.forEach((row, index) => {
			const gutterText = index === 0 ? ` ${String(item.lineNumber).padStart(digits)} ` : " ".repeat(digits + 2);
			let line: string;
			if (changed) {
				const head = serialize([{ text: gutterText + item.marker, fg: deco, bg: lineBg }]);
				const body = serialize(row);
				const used = digits + 3 + visibleWidth(row.map((s) => s.text).join(""));
				const pad = used < width ? serialize([{ text: " ".repeat(width - used), bg: lineBg }]) : "";
				line = head + body + pad;
			} else {
				line = `${p.dim(gutterText)} ${serialize(row)}`;
			}
			out.push(options.dim ? p.dim(line) : line);
		});
	}
	return out;
}
