import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { countChanges, pairRows, parseDiff, renderDiffRows, tokenize, wordRanges } from "../extension/diff.ts";
import { decorateEditor } from "../extension/editor.ts";
import { formatDuration, formatNumber, formatTokens, moreLines, stringHash, turnVerb } from "../extension/format.ts";
import { renderClawd, renderHeader, truncateStart } from "../extension/header.ts";
import { Gutter, renderApiError, renderBashRun, renderCompaction, renderInterrupted, renderThinking, renderUserPrompt, updateAssistantContent } from "../extension/messages.ts";
import { Palette, rgbTo256, themeIdFor } from "../extension/palette.ts";
import { commandPrefix, modePill, needsPrompt, nextMode, rejectReason, renderPermissionPrompt } from "../extension/permissions.ts";
import { readSettings } from "../extension/runtime.ts";
import { renderSpinner, SpinnerState, thinkingLabel } from "../extension/spinner.ts";
import { buildTheme } from "../extension/themes.ts";
import { BUILTIN_VIEWS, callRow, displayPath, genericArgs, hardWrap, truncatedOutput } from "../extension/tools.ts";
import { renderPromptFooter, renderTurnSummary } from "../extension/turn.ts";

const p = new Palette("dark", "truecolor");
const plain = (lines: string[]) => lines.map((l) => stripTerminalSequences(l));

test("formatDuration follows Claude Code's Cn", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(12_400), "12s");
	assert.equal(formatDuration(65_000), "1m 5s");
	assert.equal(formatDuration(3_723_000), "1h 2m 3s");
	assert.equal(formatDuration(93_780_000), "1d 2h 3m");
	assert.equal(formatDuration(119_600), "2m 0s");
	assert.equal(formatDuration(120_000, { hideTrailingZeros: true }), "2m");
});

test("token and number formats", () => {
	assert.equal(formatNumber(999), "999");
	assert.equal(formatNumber(1000), "1.0k");
	assert.equal(formatNumber(12345), "12.3k");
	assert.equal(formatTokens(1000), "1k");
	assert.equal(formatTokens(1_200_000), "1.2m");
	assert.equal(moreLines(3), "… +3 lines");
	assert.equal(moreLines(1), "… +1 line");
});

test("turn verb is chosen by hash like Wy", () => {
	assert.equal(stringHash("abc"), 96354);
	const verbs = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];
	assert.ok(verbs.includes(turnVerb("some-id")));
	assert.equal(turnVerb("abc"), verbs[96354 % 8]);
});

test("palette picks the variant of the pi theme", () => {
	assert.equal(themeIdFor({ name: "claude-code-light-daltonized" }), "light-daltonized");
	assert.equal(themeIdFor({ name: "dark" }), "dark");
	assert.equal(themeIdFor({ name: "x", appearance: "light" }), "light");
	assert.equal(p.fg("claude", "x"), "\x1b[38;2;215;119;87mx\x1b[39m");
	assert.equal(new Palette("dark", "256color").fg("claude", "x"), `\x1b[38;5;${rgbTo256({ r: 215, g: 119, b: 87 })}mx\x1b[39m`);
	assert.equal(new Palette("dark-ansi").fg("claude", "x"), "\x1b[91mx\x1b[39m");
	assert.equal(p.dim("x"), "\x1b[2mx\x1b[22m");
});

test("themes map Claude Code colours onto pi tokens", () => {
	const t = buildTheme("dark");
	assert.equal(t.name, "claude-code-dark");
	assert.equal(t.vars.claude, "#d77757");
	assert.equal(t.colors.userMessageBg, "userMessageBackground");
	assert.equal(t.colors.thinkingHigh, "promptBorder");
	assert.equal(buildTheme("light-ansi").appearance, "light");
});

test("settings fall back to defaults", () => {
	assert.equal(readSettings(undefined).permissionMode, "bypassPermissions");
	assert.equal(readSettings({ permissionMode: "acceptEdits", spinner: false }).permissionMode, "acceptEdits");
	assert.equal(readSettings({ spinner: false }).spinner, false);
	assert.equal(readSettings({ permissionMode: "nope", headerTitle: " " }).headerTitle, "Pi");
});

test("header draws Clawd beside three lines", () => {
	const clawd = plain(renderClawd(p));
	assert.deepEqual(clawd, [" ▐▛███▛█ ", "▝▜██████▀", " ▝▝   ▝▝ "]);
	const lines = plain(renderHeader(p, { title: "Pi", version: "1.5.2", model: "Opus 5.5", effort: "high", billing: "claude-bridge", cwd: "~/work" }, 80));
	assert.equal(lines[0], `${clawd[0]}  Pi v1.5.2`);
	assert.equal(lines[1], `${clawd[1]}  Opus 5.5 with high effort · claude-bridge`);
	assert.equal(lines[2], `${clawd[2]}  ~/work`);
	assert.equal(truncateStart("/a/very/long/path", 8), "…ng/path");
});

test("user prompt: pointer, background to the edge, wrapped under the text", () => {
	const lines = renderUserPrompt(p, "hello world again", 12);
	assert.deepEqual(plain(lines), ["❯ hello     ", "  world     ", "  again     "]);
	assert.ok(lines.every((l) => visibleWidth(l) === 12));
	assert.ok(lines[0]!.includes("48;2;55;55;55"));
});

test("thinking, interrupt and API error rows", () => {
	assert.deepEqual(plain(renderThinking(p, "a\n\nb  c", 20)), ["∴ a b c"]);
	assert.deepEqual(plain(renderInterrupted(p, 80)), ["  ⎿  Interrupted · What should Claude do instead?"]);
	const err = plain(renderApiError(p, "API Error: 500", 40));
	assert.ok(err[0]!.endsWith("API Error: 500"));
});

test("assistant message: dot before the first text block only", () => {
	const children: { render(w: number): string[] }[] = [];
	const self = {
		contentContainer: { clear: () => (children.length = 0), addChild: (c: { render(w: number): string[] }) => children.push(c) },
		markdownSlots: [],
		markdownTheme: {
			heading: (t: string) => t, link: (t: string) => t, linkUrl: (t: string) => t, code: (t: string) => t, codeBlock: (t: string) => t,
			codeBlockBorder: (t: string) => t, quote: (t: string) => t, quoteBorder: (t: string) => t, hr: (t: string) => t, listBullet: (t: string) => t,
			bold: (t: string) => t, italic: (t: string) => t, strikethrough: (t: string) => t, underline: (t: string) => t,
		},
		markdownTransformers: [],
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		thinkingVisibilityOverrides: new Map(),
		lastMessage: undefined,
		isStreaming: false,
		hasToolCalls: false,
	};
	updateAssistantContent.call(self as never, {
		content: [
			{ type: "thinking", thinking: "plan it" },
			{ type: "text", text: "First" },
			{ type: "text", text: "Second" },
		],
		stopReason: "stop",
	}, false, () => p);
	const out = plain(children.flatMap((c) => c.render(30))).map((l) => l.trimEnd());
	assert.deepEqual(out, ["", "∴ plan it", "", `${process.platform === "darwin" ? "⏺" : "●"} First`, "", "  Second"]);
});

test("assistant message: interrupt hangs under the row above", () => {
	const children: { render(w: number): string[] }[] = [];
	const self = {
		contentContainer: { clear: () => (children.length = 0), addChild: (c: { render(w: number): string[] }) => children.push(c) },
		markdownSlots: [], markdownTheme: {} as never, markdownTransformers: [], hideThinkingBlock: false, hiddenThinkingLabel: "",
		thinkingVisibilityOverrides: new Map(), lastMessage: undefined, isStreaming: false, hasToolCalls: false,
	};
	updateAssistantContent.call(self as never, { content: [], stopReason: "aborted", errorMessage: "Request was aborted" }, false, () => p);
	assert.deepEqual(plain(children.flatMap((c) => c.render(80))), ["  ⎿  Interrupted · What should Claude do instead?"]);
});

test("gutter wraps a child two columns in", () => {
	const g = new Gutter({ render: (w) => [`w=${w}`, "b"], invalidate() {} }, "* ");
	assert.deepEqual(g.render(10), ["* w=8", "  b"]);
});

test("tool call row: dot states", () => {
	const state = { executionStarted: true, isPartial: true, isError: false, hasResult: false, expanded: false };
	assert.equal(stripTerminalSequences(callRow(p, state, "Read", "a.ts", 40, 0)[0]!).trim(), `${process.platform === "darwin" ? "⏺" : "●"} Read(a.ts)`);
	assert.equal(stripTerminalSequences(callRow(p, state, "Read", "a.ts", 40, 600)[0]!), "  Read(a.ts)");
	const done = callRow(p, { ...state, isPartial: false, hasResult: true }, "Read", "a.ts", 40)[0]!;
	assert.ok(done.includes("38;2;78;186;101"));
	const failed = callRow(p, { ...state, isPartial: false, hasResult: true, isError: true }, "Read", "a.ts", 40)[0]!;
	assert.ok(failed.includes("38;2;255;107;128"));
	const long = stripTerminalSequences(callRow(p, state, "Bash", "x".repeat(100), 30, 0)[0]!);
	assert.equal(visibleWidth(long), 30);
	assert.ok(long.endsWith("…)"));
});

test("Bash output keeps three lines, four when one more would hide", () => {
	assert.deepEqual(plain(truncatedOutput(p, "1\n2\n3\n4", 80, "ctrl+o")), ["1", "2", "3", "4"]);
	assert.deepEqual(plain(truncatedOutput(p, "1\n2\n3\n4\n5", 80, "ctrl+o")), ["1", "2", "3", "… +2 lines (ctrl+o to expand)"]);
	assert.deepEqual(plain(truncatedOutput(p, "", 80, "ctrl+o")), []);
	assert.deepEqual(hardWrap("abcdef", 4), ["abcd", "ef"]);
});

test("built-in views", () => {
	const ctx = { cwd: "/w", expanded: false, isError: false, isPartial: false, expandKey: "ctrl+o" };
	assert.equal(BUILTIN_VIEWS.read!.args({ path: "/w/src/a.ts" }, ctx), "src/a.ts");
	assert.deepEqual(plain(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "a\nb\nc\n" }] }, ctx, 80)), ["Read 3 lines"]);
	assert.deepEqual(plain(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "a\n\n[Showing lines 1-1 of 9. Use offset=2 to continue.]" }] }, ctx, 80)), ["Read 1 line"]);
	assert.deepEqual(plain(BUILTIN_VIEWS.bash!.result!(p, {}, { content: [{ type: "text", text: "" }] }, ctx, 80)), ["(No output)"]);
	assert.equal(BUILTIN_VIEWS.grep!.args({ pattern: "foo", path: "/w/src" }, ctx), 'pattern: "foo", path: "src"');
	assert.deepEqual(plain(BUILTIN_VIEWS.grep!.result!(p, {}, { content: [{ type: "text", text: "a.ts:1: foo\nb.ts:3: foo" }] }, ctx, 80)), ["Found 2 lines (ctrl+o to expand)"]);
	assert.deepEqual(plain(BUILTIN_VIEWS.find!.result!(p, {}, { content: [{ type: "text", text: "a.ts\nb.ts" }] }, ctx, 80)), ["Found 2 files (ctrl+o to expand)"]);
	assert.deepEqual(plain(BUILTIN_VIEWS.write!.result!(p, { path: "/w/a.txt", content: "x\ny\n" }, { content: [] }, ctx, 80)), ["Wrote 2 lines to a.txt", "x", "y"]);
	const errors = plain(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "ENOENT" }] }, { ...ctx, isError: true }, 80));
	assert.deepEqual(errors, ["ENOENT"]);
	assert.equal(displayPath("/elsewhere/x", "/w"), "/elsewhere/x");
	assert.equal(genericArgs({ q: "a", n: 2 }), 'q: "a", n: 2');
});

test("edit view: summary and diff", () => {
	const ctx = { cwd: "/w", expanded: false, isError: false, isPartial: false, expandKey: "ctrl+o" };
	const diff = [" 1 a", "-2 old line", "+2 new line", " 3 c"].join("\n");
	const out = plain(BUILTIN_VIEWS.edit!.result!(p, { path: "/w/f.txt" }, { content: [], details: { diff } }, ctx, 60));
	assert.equal(out[0], "Added 1 line, removed 1 line");
	assert.equal(out[1]!.trimEnd(), " 1  a");
	assert.ok(out[2]!.startsWith(" 2 -old line"));
	assert.equal(visibleWidth(out[2]!), 48);
});

test("diff parsing, pairing and word ranges", () => {
	const items = parseDiff(["+1 a", " 2 b", "   ...", "-9 c"].join("\n"));
	assert.equal(items.length, 4);
	assert.deepEqual(countChanges(items), { added: 1, removed: 1 });
	assert.deepEqual(tokenize("foo(bar, 12)"), ["foo", "(", "bar", ",", " ", "12", ")"]);
	assert.deepEqual(pairRows([{ marker: "-", lineNumber: 1, code: "" }, { marker: "-", lineNumber: 2, code: "" }, { marker: "+", lineNumber: 1, code: "" }]), [[0, 2]]);
	const [removed, added] = wordRanges("const value = 1;", "const value = 2;");
	assert.deepEqual(removed, [{ start: 14, end: 15 }]);
	assert.deepEqual(added, [{ start: 14, end: 15 }]);
	assert.deepEqual(wordRanges("abc", "xyz"), [[], []]);
	const rows = renderDiffRows(p, parseDiff("-1 const value = 1;\n+1 const value = 2;"), 40);
	assert.ok(rows[0]!.includes("48;2;179;89;107"), "removed word background");
	assert.ok(rows[1]!.includes("48;2;56;166;96"), "added word background");
});

test("spinner: glyph, verb, parenthesis", () => {
	const s = new SpinnerState();
	s.start(0, () => 0, ["Pondering"]);
	assert.deepEqual(plain(renderSpinner(p, s, { now: 0, width: 80, frames: ["·", "✢", "✳", "✶", "✻", "✽"] })), ["", "· Pondering…"]);
	s.delta("text", 4800, 1000);
	const line = plain(renderSpinner(p, s, { now: 1000, width: 80, frames: ["·", "✢", "✳", "✶", "✻", "✽"] }))[1]!;
	assert.equal(line, "✽ Pondering… (1s · ↓ 1.2k tokens)");
	s.delta("thinking", 10, 2000);
	const thinking = plain(renderSpinner(p, s, { now: 2500, width: 80, frames: ["a"] }))[1]!;
	assert.ok(thinking.endsWith("· thinking)"));
	s.stop();
	assert.deepEqual(renderSpinner(p, s, { now: 3000, width: 80 }), []);
	assert.equal(thinkingLabel(46000), "deep in thought");
});

test("spinner: thought-for shows after the thinking ends", () => {
	const s = new SpinnerState();
	s.start(0, () => 0, ["X"]);
	s.delta("thinking", 4, 0);
	s.delta("text", 4, 5000);
	const line = plain(renderSpinner(p, s, { now: 5100, width: 80, frames: ["a"] }))[1]!;
	assert.ok(line.includes("thought for 5s"), line);
});

test("prompt box wraps any editor", () => {
	const fake = {
		paddingX: 1,
		renderedVisibleLineCount: 1,
		focused: true,
		text: "",
		getText() {
			return this.text;
		},
		render(width: number) {
			return ["─".repeat(width), `${this.text}`.padEnd(width), "─".repeat(width)];
		},
	};
	decorateEditor(fake, { palette: () => p, enabled: () => true, placeholder: () => 'Try "fix lint errors"' });
	const empty = plain(fake.render(20));
	assert.equal(empty[0], "─".repeat(20));
	assert.ok(empty[1]!.startsWith('❯ Try "fix'));
	fake.text = "!ls";
	const shell = fake.render(20);
	assert.ok(stripTerminalSequences(shell[1]!).startsWith("! !ls"));
	assert.ok(shell[0]!.includes("38;2;253;93;177"));
	assert.equal(fake.paddingX, 0);
});

test("permission modes and prompt", () => {
	assert.equal(nextMode("default"), "acceptEdits");
	assert.equal(nextMode("bypassPermissions"), "default");
	const state = { mode: "default" as const, allowedCommands: new Set<string>() };
	assert.equal(needsPrompt(state, "bash", { command: "ls -la" }), true);
	assert.equal(needsPrompt(state, "read", {}), false);
	assert.equal(needsPrompt({ ...state, mode: "acceptEdits" }, "edit", {}), false);
	assert.equal(needsPrompt({ ...state, allowedCommands: new Set(["ls"]) }, "bash", { command: "ls x" }), false);
	assert.equal(needsPrompt({ ...state, mode: "bypassPermissions" }, "bash", { command: "rm" }), false);
	assert.equal(commandPrefix("  git status"), "git");
	assert.ok(rejectReason("use pnpm").endsWith("the user said:\nuse pnpm"));
	assert.equal(stripTerminalSequences(modePill(p, "acceptEdits")), "accept edits");
	const lines = plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: "npm test" }, cwd: "/w" }, 0, 60, undefined));
	assert.equal(lines[2], " Bash command");
	assert.ok(lines.includes(" Do you want to proceed?"));
	assert.ok(lines.some((l) => l.startsWith(" ❯ 1. Yes")));
	assert.ok(lines.some((l) => l.includes("3. No, and tell Claude what to do differently (esc)")));
});

test("turn summary and prompt footer", () => {
	assert.deepEqual(plain(renderTurnSummary(p, { id: "abc", durationMs: 65_000 })), [`✻ ${turnVerb("abc")} for 1m 5s`]);
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "default", false)), "  ? for shortcuts");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "default", true)), "  esc to interrupt");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "acceptEdits", false)), "  accept edits · shift+tab to cycle");
});

test("! commands and compaction", () => {
	const out = (text: string) => (text ? text.split("\n") : []);
	const run = { command: "echo hi", outputLines: ["hi"], status: "complete" as const, expanded: false };
	const lines = renderBashRun(p, run, 20, out);
	assert.deepEqual(plain(lines), ["", "! echo hi           ", "  \u23BF \u00A0hi"]);
	assert.ok(lines[1]!.includes("48;2;65;60;65"));
	assert.deepEqual(plain(renderBashRun(p, { ...run, outputLines: [], status: "running" }, 20, out)).slice(2), ["  \u23BF \u00A0Running\u2026"]);
	assert.deepEqual(plain(renderBashRun(p, { ...run, outputLines: [""], status: "error", exitCode: 2 }, 20, out)).slice(2), ["  \u23BF \u00A0Exit code 2"]);
	const dot = process.platform === "darwin" ? "\u23FA" : "\u25CF";
	assert.deepEqual(plain(renderCompaction(p, "s", false, "ctrl+o", 80)), [`${dot} Compact summary (ctrl+o to expand)`]);
	assert.deepEqual(plain(renderCompaction(p, "line one", true, "ctrl+o", 80)), [`${dot} Compact summary`, "  \u23BF \u00A0line one"]);
});
