/**
 * Claude Code collapses a run of read and search calls, a single one included, into one row while
 * the transcript is not expanded (`collapsed_read_search` → `oc` / `Ey` of 2.1.330):
 *
 *     Searched for 2 patterns, read 3 files · 1 failed (ctrl+o to expand)   (done: no dot, faint)
 *   ⏺ Searching for 1 pattern, reading 2 files… (ctrl+o to expand)   (running: the tool dot)
 *     ⎿  src/session.ts                                              (running: the latest target)
 *
 * Counts are bold; files read are counted once per path. The first call of a run draws the row and
 * the others draw nothing. A run is broken by assistant text, a user message, a compaction, or any
 * other tool call. ctrl+o shows every call again.
 */
import { DOT, plural, RESULT_PREFIX } from "./format.ts";
import type { Palette } from "./palette.ts";
import type { ToolCallState } from "./tools.ts";

export const COLLAPSIBLE: Record<string, "search" | "read" | "list"> = {
	read: "read",
	grep: "search",
	find: "search",
	ls: "list",
};

type Entry = { kind: "tool"; id: string; name: string; target?: string } | { kind: "break" };

interface ContentLike {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

/** What a call reads or searches for: the path of a read / ls, the pattern of a grep / find. */
function targetOf(name: string, args: Record<string, unknown> | undefined): string | undefined {
	const value = COLLAPSIBLE[name] === "search" ? args?.pattern : (args?.path ?? args?.file_path);
	return typeof value === "string" && value ? value : undefined;
}

interface MessageLike {
	role?: string;
	content?: unknown;
	timestamp?: number;
}

export class ToolGroups {
	private readonly messages = new Map<string, Entry[]>();
	private readonly order: string[] = [];
	private readonly states = new Map<string, ToolCallState>();
	private groupOf = new Map<string, string[]>();
	private calls = new Map<string, { name: string; target?: string }>();
	private dirty = true;

	reset() {
		this.seq = 0;
		this.current = undefined;
		this.messages.clear();
		this.order.length = 0;
		this.states.clear();
		this.groupOf.clear();
		this.calls.clear();
		this.dirty = true;
	}

	/** A non-message entry of the session (a compaction) that ends a run. */
	addBreak() {
		this.messages.set(`m${++this.seq}`, [{ kind: "break" }]);
		this.order.push(`m${this.seq}`);
		this.dirty = true;
	}

	private seq = 0;
	private current: string | undefined;

	/** A message starts: assistant messages keep their key through their updates and end. */
	start(message: MessageLike) {
		const key = `m${++this.seq}`;
		if (message.role === "assistant") this.current = key;
		this.observe(message, key);
	}

	/** The streaming assistant message changed or ended. */
	update(message: MessageLike) {
		if (message.role !== "assistant") return;
		this.observe(message, this.current ?? `m${++this.seq}`);
	}

	/** A message from the session history. */
	add(message: MessageLike) {
		this.observe(message, `m${++this.seq}`);
	}

	/** Records a message under a key that identifies it across updates. */
	observe(message: MessageLike, key: string) {
		const entries: Entry[] = [];
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content as ContentLike[]) {
				if (block.type === "text" && block.text?.trim()) entries.push({ kind: "break" });
				else if (block.type === "toolCall" && block.id && block.name) {
					entries.push({ kind: "tool", id: block.id, name: block.name, target: targetOf(block.name, block.arguments) });
				}
			}
		} else if (message.role === "user" || message.role === "bashExecution" || message.role === "custom" || message.role === "compactionSummary") {
			entries.push({ kind: "break" });
		} else {
			return;
		}
		if (!this.messages.has(key)) this.order.push(key);
		this.messages.set(key, entries);
		this.dirty = true;
	}

	setState(id: string, state: ToolCallState) {
		this.states.set(id, state);
	}

	private rebuild() {
		if (!this.dirty) return;
		this.dirty = false;
		this.groupOf = new Map();
		this.calls = new Map();
		let run: string[] = [];
		const flush = () => {
			if (run.length >= 1) for (const id of run) this.groupOf.set(id, run);
			run = [];
		};
		for (const key of this.order) {
			for (const entry of this.messages.get(key) ?? []) {
				if (entry.kind === "tool") this.calls.set(entry.id, { name: entry.name, target: entry.target });
				if (entry.kind === "tool" && COLLAPSIBLE[entry.name]) run.push(entry.id);
				else flush();
			}
		}
		flush();
	}

	/** The run a call belongs to, when it is collapsed with others. */
	group(id: string): string[] | undefined {
		this.rebuild();
		return this.groupOf.get(id);
	}

	nameOf(id: string): string | undefined {
		this.rebuild();
		return this.calls.get(id)?.name;
	}

	targetOf(id: string): string | undefined {
		this.rebuild();
		return this.calls.get(id)?.target;
	}

	stateOf(id: string): ToolCallState | undefined {
		return this.states.get(id);
	}
}

/** `ao` + `oo`: "Searched for 2 patterns, read 3 files" / "Searching for …, reading ……". Counts are marked. */
export function groupSummaryParts(counts: { search: number; read: number; list: number }, running: boolean): { text: string; count?: boolean }[] {
	const parts: { text: string; count?: boolean }[] = [];
	const add = (verb: string, count: number, noun: string) => {
		if (parts.length > 0) parts.push({ text: ", " });
		const word = parts.length === 0 ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
		parts.push({ text: `${word} ` }, { text: String(count), count: true }, { text: ` ${plural(count, noun)}` });
	};
	if (counts.search > 0) add(running ? "searching for" : "searched for", counts.search, "pattern");
	if (counts.read > 0) add(running ? "reading" : "read", counts.read, "file");
	if (counts.list > 0) add(running ? "listing" : "listed", counts.list, "directory");
	if (running) parts.push({ text: "…" });
	return parts;
}

export function groupSummary(counts: { search: number; read: number; list: number }, running: boolean): string {
	return groupSummaryParts(counts, running)
		.map((part) => part.text)
		.join("");
}

/** The row (and, while running, the latest target under the elbow) for a collapsed run. */
export function renderGroupRows(
	p: Palette,
	groups: ToolGroups,
	ids: string[],
	expandKey: string,
	displayTarget: (target: string, kind: "search" | "read" | "list") => string = (t) => t,
	now = Date.now(),
): string[] {
	const counts = { search: 0, read: 0, list: 0 };
	const paths = new Set<string>();
	let running = false;
	let started = false;
	let failedCount = 0;
	let latest: { target: string; kind: "search" | "read" | "list" } | undefined;
	for (const id of ids) {
		const kind = COLLAPSIBLE[groups.nameOf(id) ?? ""];
		const target = groups.targetOf(id);
		if (kind === "read") paths.add(target ?? id);
		else if (kind) counts[kind]++;
		if (kind && target) latest = { target, kind };
		const state = groups.stateOf(id);
		if (!state || state.isPartial) running = true;
		if (state?.executionStarted) started = true;
		if (state?.isError && !state.isPartial) failedCount++;
	}
	counts.read = paths.size;
	const parts = groupSummaryParts(counts, running);
	const hint = ` (${expandKey} to expand)`;
	if (!running) {
		// Done: no dot, the whole row faint with the counts bold.
		const text = parts.map((part) => p.style(part.text, { dim: true, bold: part.count })).join("");
		// `Xp`: once done, failed calls are counted in `error` after a separator.
		const failed = failedCount > 0 ? `${p.dim(" · ")}${p.fg("error", `${failedCount} failed`)}` : "";
		return [`  ${text}${failed}${p.dim(hint)}`];
	}
	const dot = !started ? p.dim(DOT) : Math.floor(now / 600) % 2 === 0 ? p.dim(DOT) : " ";
	const text = parts.map((part) => (part.count ? p.bold(part.text) : part.text)).join("");
	const rows = [`${dot} ${text}${p.dim(hint)}`];
	if (latest) rows.push(`${p.dim(RESULT_PREFIX)}${p.dim(displayTarget(latest.target, latest.kind))}`);
	return rows;
}
