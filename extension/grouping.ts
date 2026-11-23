/**
 * Claude Code collapses a run of read and search calls into one row while the transcript is not
 * expanded (`gZo` / the grouped-tool row of 2.1.330):
 *
 *   ⏺ Searched for 2 patterns, read 3 files (ctrl+o to expand)
 *   ⏺ Searching for 1 pattern, reading 2 files…              (while running)
 *
 * The first call of a run draws that row and the others draw nothing. A run is broken by assistant
 * text, a user message, or any other tool call. ctrl+o shows every call again.
 */
import { DOT, plural } from "./format.ts";
import type { Palette } from "./palette.ts";
import type { ToolCallState } from "./tools.ts";

export const COLLAPSIBLE: Record<string, "search" | "read" | "list"> = {
	read: "read",
	grep: "search",
	find: "search",
	ls: "list",
};

type Entry = { kind: "tool"; id: string; name: string } | { kind: "break" };

interface ContentLike {
	type: string;
	text?: string;
	id?: string;
	name?: string;
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
	private dirty = true;

	reset() {
		this.seq = 0;
		this.current = undefined;
		this.messages.clear();
		this.order.length = 0;
		this.states.clear();
		this.groupOf.clear();
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
				else if (block.type === "toolCall" && block.id && block.name) entries.push({ kind: "tool", id: block.id, name: block.name });
			}
		} else if (message.role === "user" || message.role === "bashExecution" || message.role === "custom") {
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
		let run: string[] = [];
		const flush = () => {
			if (run.length >= 2) for (const id of run) this.groupOf.set(id, run);
			run = [];
		};
		for (const key of this.order) {
			for (const entry of this.messages.get(key) ?? []) {
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
		for (const entries of this.messages.values()) {
			for (const entry of entries) if (entry.kind === "tool" && entry.id === id) return entry.name;
		}
		return undefined;
	}

	stateOf(id: string): ToolCallState | undefined {
		return this.states.get(id);
	}
}

/** `ao` + `gZo`: "Searched for 2 patterns, read 3 files" / "Searching for …, reading ……". */
export function groupSummary(counts: { search: number; read: number; list: number }, running: boolean): string {
	const parts: string[] = [];
	const add = (verb: string, count: number, noun: string) => {
		const word = parts.length === 0 ? verb[0]!.toUpperCase() + verb.slice(1) : verb;
		parts.push(`${word} ${count} ${plural(count, noun)}`);
	};
	if (counts.search > 0) add(running ? "searching for" : "searched for", counts.search, "pattern");
	if (counts.read > 0) add(running ? "reading" : "read", counts.read, "file");
	if (counts.list > 0) add(running ? "listing" : "listed", counts.list, "directory");
	const text = parts.join(", ");
	return running ? `${text}…` : text;
}

export function renderGroupRow(p: Palette, groups: ToolGroups, ids: string[], expandKey: string, now = Date.now()): string {
	const counts = { search: 0, read: 0, list: 0 };
	let running = false;
	let error = false;
	let started = false;
	for (const id of ids) {
		const kind = COLLAPSIBLE[groups.nameOf(id) ?? ""];
		if (kind) counts[kind]++;
		const state = groups.stateOf(id);
		if (!state || state.isPartial) running = true;
		if (state?.executionStarted) started = true;
		if (state?.isError && !state.isPartial) error = true;
	}
	let dot: string;
	if (!running) dot = p.fg(error ? "error" : "success", DOT);
	else if (!started) dot = p.dim(DOT);
	else dot = Math.floor(now / 600) % 2 === 0 ? p.dim(DOT) : " ";
	const text = groupSummary(counts, running);
	return running ? `${dot} ${text}` : `${dot} ${text} ${p.dim(`(${expandKey} to expand)`)}`;
}
