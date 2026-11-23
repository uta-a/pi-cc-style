/**
 * Claude Code's message rows, patched into pi's own message components.
 *
 * - User prompt (`vm`): `❯ ` in `inactive` before the text, on `userMessageBackground`, wrapped
 *   with the continuation indented under the text. Plain text, not Markdown.
 * - Assistant text (`ef` / `ki`): a 2-column gutter with `⏺` in `text` before the first text block
 *   of a response; the Markdown sits in the column right of it.
 * - Thinking (`Ur`): `∴` dim, then the thinking with its whitespace collapsed, dim and italic.
 * - Interrupt (`YS`): `  ⎿  Interrupted · What should Claude do instead?` dim.
 * - API error (`Xg`): `⏺` and the message in `warning`.
 */
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { DOT, ELLIPSIS, POINTER, RESULT_INDENT, RESULT_PREFIX, THEREFORE } from "./format.ts";
import type { Palette } from "./palette.ts";

export interface Component {
	render(width: number): string[];
	invalidate(): void;
}

/** A child drawn right of a 2-column gutter: `first` before its first line, spaces before the rest. */
export class Gutter implements Component {
	child: Component;
	first: string;
	rest: string;
	constructor(child: Component, first: string, rest = "  ") {
		this.child = child;
		this.first = first;
		this.rest = rest;
	}
	render(width: number): string[] {
		const gutter = visibleWidth(this.rest);
		const lines = this.child.render(Math.max(1, width - gutter));
		return lines.map((line, i) => (i === 0 ? this.first : this.rest) + line);
	}
	invalidate() {
		this.child.invalidate();
	}
}

/** Fixed lines produced by a function of the width. */
export class Lines implements Component {
	private readonly draw: (width: number) => string[];
	constructor(draw: (width: number) => string[]) {
		this.draw = draw;
	}
	render(width: number): string[] {
		return this.draw(width);
	}
	invalidate() {}
}

/** Lines that depend only on the width and the palette, computed once per width. */
export class CachedLines implements Component {
	private readonly draw: (width: number) => string[];
	private readonly palette: () => Palette;
	private cache: { width: number; palette: Palette; lines: string[] } | undefined;
	constructor(draw: (width: number) => string[], palette: () => Palette) {
		this.draw = draw;
		this.palette = palette;
	}
	render(width: number): string[] {
		const p = this.palette();
		if (this.cache && this.cache.width === width && this.cache.palette === p) return this.cache.lines;
		const lines = this.draw(width);
		this.cache = { width, palette: p, lines };
		return lines;
	}
	invalidate() {
		this.cache = undefined;
	}
}

export class Blank implements Component {
	render(): string[] {
		return [""];
	}
	invalidate() {}
}

/** The user prompt row. */
export function renderUserPrompt(p: Palette, text: string, width: number): string[] {
	const contentWidth = Math.max(1, width - 2 - 1);
	const body = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
	const wrapped = body.split("\n").flatMap((line) => (line.length === 0 ? [""] : wrapTextWithAnsi(line, contentWidth)));
	return wrapped.map((line, i) => {
		const prefix = i === 0 ? `${p.fg("inactive", POINTER)} ` : "  ";
		const content = prefix + p.fg("text", line);
		const padded = content + " ".repeat(Math.max(0, width - visibleWidth(content)));
		return p.bg("userMessageBackground", truncateToWidth(padded, width, ""));
	});
}

/** Thinking row: `∴` and the thinking on one paragraph, both dim; the thinking italic. */
export function renderThinking(p: Palette, thinking: string, width: number): string[] {
	const text = thinking.replace(/\s+/g, " ").trim();
	const lines = wrapTextWithAnsi(text, Math.max(1, width - 2));
	return lines.map((line, i) => `${i === 0 ? p.dim(THEREFORE) + " " : "  "}${p.style(line, { dim: true, italic: true })}`);
}

/** `YS`: the interrupt line. */
export function renderInterrupted(p: Palette, width: number): string[] {
	return [truncateToWidth(p.dim(`${RESULT_PREFIX}Interrupted · What should Claude do instead?`), width, ELLIPSIS)];
}

/** `Xg`: an API error, `⏺` and text in `warning`. */
export function renderApiError(p: Palette, message: string, width: number): string[] {
	const lines = wrapTextWithAnsi(message, Math.max(1, width - 2));
	return lines.map((line, i) => `${i === 0 ? `${p.fg("warning", DOT)} ` : "  "}${p.fg("warning", line)}`);
}

/** Continuation rows of a tool result: `  ⎿  ` before the first line, five spaces before the rest. */
export function resultRows(lines: string[], p: Palette): string[] {
	return lines.map((line, i) => (i === 0 ? p.dim(RESULT_PREFIX) : RESULT_INDENT) + line);
}

/* ------------------------------------------------------------------------------------------------ */
/* Patches                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const PATCHED = Symbol.for("pi-cc-style.messages");

type MarkdownTransformer = (markdown: string, context: Record<string, unknown>) => string | undefined;

function markdownTransform(
	messageType: string,
	isStreaming: () => boolean,
	transformers: MarkdownTransformer[] | undefined,
	messageId?: string,
	timestamp?: number,
) {
	return (markdown: string, availableWidth: number) => {
		let out = markdown;
		for (const transformer of transformers ?? []) {
			try {
				const next = transformer(out, { messageType, isStreaming: isStreaming(), availableWidth, messageId, timestamp });
				if (typeof next === "string") out = next;
			} catch {
				// Keep the current Markdown.
			}
		}
		return out;
	};
}

interface AssistantLike {
	contentContainer: { clear(): void; addChild(c: Component): void };
	markdownSlots: { kind: string; markdown: Markdown }[];
	markdownTheme: MarkdownTheme;
	markdownTransformers: MarkdownTransformer[];
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	thinkingVisibilityOverrides: Map<number, boolean>;
	lastMessage: unknown;
	isStreaming: boolean;
	hasToolCalls: boolean;
	messageId?: string;
	timestamp?: number;
}

interface AssistantContent {
	type: string;
	text?: string;
	thinking?: string;
}

interface AssistantMessageLike {
	content: AssistantContent[];
	stopReason?: string;
	errorMessage?: string;
}

/** Rebuilds an assistant message in Claude Code's layout. `this` is pi's AssistantMessageComponent. */
export function updateAssistantContent(
	this: AssistantLike,
	message: AssistantMessageLike,
	isStreaming: boolean,
	getPalette: () => Palette,
) {
	this.lastMessage = message;
	this.isStreaming = isStreaming;
	this.contentContainer.clear();
	const previous = this.markdownSlots ?? [];
	this.markdownSlots = [];
	const markdownBlock = (kind: string, text: string) => {
		const slot = previous[this.markdownSlots.length];
		const markdown =
			slot?.kind === kind
				? slot.markdown
				: new Markdown(text, 0, 0, this.markdownTheme, undefined, {
						transform: markdownTransform("assistant", () => this.isStreaming, this.markdownTransformers, this.messageId, this.timestamp),
					});
		markdown.setText(text);
		this.markdownSlots.push({ kind, markdown });
		return markdown;
	};
	let needsSpacer = true;
	const add = (child: Component) => {
		if (needsSpacer) {
			this.contentContainer.addChild(new Blank());
			needsSpacer = false;
		}
		this.contentContainer.addChild(child);
	};
	let shownDot = false;
	let thinkingRun = 0;
	const content = message.content ?? [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i]!;
		if (block.type === "text" && block.text?.trim()) {
			const markdown = markdownBlock("text", block.text.trim());
			const dot = shownDot ? "  " : `${getPalette().fg("text", DOT)} `;
			shownDot = true;
			add(new Gutter(markdown, dot));
			needsSpacer = true;
		} else if (block.type === "thinking") {
			const parts: string[] = [];
			for (; i < content.length && content[i]!.type === "thinking"; i++) {
				const thinking = content[i]!.thinking?.trim();
				if (thinking) parts.push(thinking);
			}
			i--;
			if (parts.length === 0) continue;
			const run = thinkingRun++;
			const hidden = this.thinkingVisibilityOverrides?.get(run) ?? this.hideThinkingBlock;
			const label = (this.hiddenThinkingLabel ?? "").trim();
			if (hidden && !label) continue;
			const text = hidden ? label.replace(/\.\.\.$/, ELLIPSIS) : parts.join("\n\n");
			add(new CachedLines((width) => renderThinking(getPalette(), text, width), getPalette));
			needsSpacer = true;
		}
	}
	const hasToolCalls = content.some((c) => c.type === "toolCall");
	this.hasToolCalls = hasToolCalls;
	if (message.stopReason === "length") {
		add(new CachedLines((width) => renderApiError(getPalette(), "Response was truncated before completion.", width), getPalette));
	} else if (!hasToolCalls) {
		if (message.stopReason === "aborted") {
			const custom = message.errorMessage && message.errorMessage !== "Request was aborted" ? message.errorMessage : undefined;
			if (custom) {
				add(new CachedLines((width) => renderApiError(getPalette(), custom, width), getPalette));
			} else {
				// The elbow hangs under the row above it, so no blank line in between.
				this.contentContainer.addChild(new CachedLines((width) => renderInterrupted(getPalette(), width), getPalette));
			}
		} else if (message.stopReason === "error") {
			const text = message.errorMessage || "Unknown error";
			add(new CachedLines((width) => renderApiError(getPalette(), text, width), getPalette));
		}
	}
}

interface PatchTargets {
	AssistantMessageComponent: { prototype: Record<string | symbol, unknown> };
	UserMessageComponent: { prototype: Record<string | symbol, unknown> };
}

/**
 * Replaces the rendering of pi's user and assistant message components. `enabled` is read on every
 * call so the setting can be switched without reloading; the originals stay in place otherwise.
 */
export function patchMessages(targets: PatchTargets, getPalette: () => Palette, enabled: () => boolean) {
	const assistant = targets.AssistantMessageComponent.prototype;
	const user = targets.UserMessageComponent.prototype;
	if (assistant[PATCHED]) return;
	assistant[PATCHED] = true;

	const originalUpdate = assistant.updateContent as (this: unknown, message: unknown, isStreaming?: boolean) => void;
	assistant.updateContent = function (this: AssistantLike, message: AssistantMessageLike, isStreaming = this.isStreaming) {
		if (!enabled()) return originalUpdate.call(this, message, isStreaming);
		return updateAssistantContent.call(this, message, isStreaming, getPalette);
	};

	const originalRender = user.render as (this: unknown, width: number) => string[];
	user.render = function (this: { text: string }, width: number) {
		if (!enabled()) return originalRender.call(this, width);
		const lines = renderUserPrompt(getPalette(), this.text ?? "", width);
		if (lines.length === 0) return lines;
		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	};
}

/* ------------------------------------------------------------------------------------------------ */
/* `!` commands and compaction                                                                      */
/* ------------------------------------------------------------------------------------------------ */

export interface BashRunLike {
	command: string;
	outputLines: string[];
	status: "running" | "complete" | "error" | "cancelled";
	exitCode?: number | null;
	expanded: boolean;
}

/**
 * A `!` command: the input row (`! ` in `bashBorder` on `bashMessageBackgroundColor`, like a user
 * prompt) and the output under the elbow, three lines unless expanded.
 */
export function renderBashRun(
	p: Palette,
	run: BashRunLike,
	width: number,
	output: (text: string, tone: "plain" | "error") => string[],
): string[] {
	const contentWidth = Math.max(1, width - 3);
	const input = wrapTextWithAnsi(run.command, contentWidth).map((line, i) => {
		const prefix = i === 0 ? `${p.fg("bashBorder", "!")} ` : "  ";
		const content = prefix + line;
		return p.bg("bashMessageBackgroundColor", content + " ".repeat(Math.max(0, width - visibleWidth(content))));
	});
	const text = run.outputLines.join("\n");
	let rows: string[];
	if (run.status === "running") rows = text.trim() ? output(text, "plain") : [p.dim("Running…")];
	else if (run.status === "cancelled") rows = [...output(text, "plain"), p.dim("Interrupted")];
	else {
		rows = output(text, run.status === "error" ? "error" : "plain");
		if (rows.length === 0) rows = [p.dim(run.status === "error" ? `Exit code ${run.exitCode}` : "(No output)")];
	}
	return ["", ...input, ...resultRows(rows, p)];
}

/** `⏺ Compact summary (ctrl+o to expand)`, the summary under the elbow when expanded. */
export function renderCompaction(p: Palette, summary: string, expanded: boolean, expandKey: string, width: number): string[] {
	const head = `${p.fg("text", DOT)} ${p.bold("Compact summary")}${expanded ? "" : ` ${p.dim(`(${expandKey} to expand)`)}`}`;
	if (!expanded) return [truncateToWidth(head, width, "")];
	const body = summary
		.split("\n")
		.flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(1, width - 5)) : [""]))
		.map((line) => p.dim(line));
	return [head, ...resultRows(body, p)];
}

interface ExtraTargets {
	BashExecutionComponent: { prototype: Record<string | symbol, unknown> };
	CompactionSummaryMessageComponent: { prototype: Record<string | symbol, unknown> };
}

const EXTRAS_PATCHED = Symbol.for("pi-cc-style.extras");

export function patchExtras(
	targets: ExtraTargets,
	getPalette: () => Palette,
	enabled: () => boolean,
	output: (text: string, tone: "plain" | "error", width: number, expanded: boolean) => string[],
	expandKey: () => string,
) {
	const bash = targets.BashExecutionComponent.prototype;
	const compaction = targets.CompactionSummaryMessageComponent.prototype;
	if (bash[EXTRAS_PATCHED]) return;
	bash[EXTRAS_PATCHED] = true;
	const bashRender = bash.render as (this: unknown, width: number) => string[];
	bash.render = function (this: BashRunLike, width: number) {
		if (!enabled()) return bashRender.call(this, width);
		return renderBashRun(getPalette(), this, width, (text, tone) => output(text, tone, width, this.expanded));
	};
	const compactionRender = compaction.render as (this: unknown, width: number) => string[];
	compaction.render = function (this: { message: { summary: string }; expanded: boolean }, width: number) {
		if (!enabled()) return compactionRender.call(this, width);
		return renderCompaction(getPalette(), this.message?.summary ?? "", this.expanded, expandKey(), width);
	};
}
