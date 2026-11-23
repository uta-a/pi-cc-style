import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { countChanges, pairRows, parseDiff, renderDiffRows, tokenize, wordRanges } from "../extension/diff.ts";
import { decorateEditor } from "../extension/editor.ts";
import { formatDuration, formatNumber, formatTokens, moreLines, sanitize, stringHash, turnVerb } from "../extension/format.ts";
import { renderClawd, renderHeader, truncateStart } from "../extension/header.ts";
import { Gutter, renderApiError, renderBashRun, renderCompaction, renderInterrupted, renderThinking, renderUserPrompt, updateAssistantContent } from "../extension/messages.ts";
import { Palette, rgbTo256, themeIdFor } from "../extension/palette.ts";
import { allowCommand, commandPrefix, isCompoundCommand, modePill, needsPrompt, nextMode, rejectReason, renderPermissionPrompt, resolveToolPath } from "../extension/permissions.ts";
import { palette, readSettings, settingsProblems, setUi } from "../extension/runtime.ts";
import { renderSpinner, SpinnerState, thinkingLabel } from "../extension/spinner.ts";
import { buildTheme } from "../extension/themes.ts";
import { BUILTIN_VIEWS, CallRow, callRow, displayPath, fullOutput, genericArgs, hardWrap, ResultRows, truncatedOutput } from "../extension/tools.ts";
import { formatDoneTime, renderPromptFooter, renderTurnSummary } from "../extension/turn.ts";

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
	assert.deepEqual(plain(BUILTIN_VIEWS.write!.result!(p, { path: "/w/a.txt", content: "x\ny\n" }, { content: [] }, ctx, 80)), ["Wrote 2 lines to a.txt", " 1 x", " 2 y"]);
	const many = plain(BUILTIN_VIEWS.write!.result!(p, { path: "/w/a.txt", content: "l\n".repeat(12) }, { content: [] }, ctx, 80));
	assert.equal(many.at(-1), "… +2 lines (ctrl+o to expand)");
	const failed = plain(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "ENOENT: no such file" }] }, { ...ctx, isError: true }, 80));
	assert.deepEqual(failed, ["Error: ENOENT: no such file"]);
	const removedPlain = renderDiffRows(p, parseDiff("-1 const a = 1;\n+1 const a = 2;"), 60, { highlight: (code) => `\x1b[35m${code}\x1b[39m` });
	const magenta = /\x1b\[(?:[0-9;]*;)?35[;m]/;
	assert.ok(!magenta.test(removedPlain[0]!));
	assert.ok(magenta.test(removedPlain[1]!));
	const errors = plain(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "ENOENT" }] }, { ...ctx, isError: true }, 80));
	assert.deepEqual(errors, ["Error: ENOENT"]);
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
	const effort = plain(renderSpinner(p, s, { now: 2500, width: 80, frames: ["a"], effort: "high" }))[1]!;
	assert.ok(effort.endsWith("· thinking with high effort)"));
	const narrow = plain(renderSpinner(p, s, { now: 2500, width: 40, frames: ["a"], effort: "high" }))[1]!;
	assert.ok(narrow.includes("thinking") && !narrow.includes("effort"));
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
	assert.equal(nextMode("plan", false), "default");
	const state = { mode: "default" as const, allowedCommands: new Set<string>() };
	assert.equal(needsPrompt(state, "bash", { command: "ls -la" }, "/w"), true);
	assert.equal(needsPrompt(state, "read", {}, "/w"), false);
	assert.equal(needsPrompt(state, "powershell", { command: "dir" }, "/w"), true);
	assert.equal(needsPrompt({ ...state, mode: "bypassPermissions" }, "bash", { command: "rm" }, "/w"), false);
	assert.ok(rejectReason("use pnpm").endsWith("To tell you how to proceed, the user said: use pnpm"));
	assert.equal(stripTerminalSequences(modePill(p, "acceptEdits")), "accept edits");
	const lines = plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: "npm test" }, cwd: "/w" }, 0, 60, undefined));
	assert.equal(lines[2], " Bash command");
	assert.ok(lines.includes(" Do you want to proceed?"));
	assert.ok(lines.some((l) => l.startsWith(" ❯ 1. Yes")));
	assert.ok(lines.includes("   3. No"));
	assert.ok(lines.includes(" Esc to cancel · Tab to amend"));
	const amending = plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: "npm test" }, cwd: "/w" }, 2, 60, { active: true, text: "" }));
	assert.ok(amending.includes(" ❯ 3. No and tell Claude what to do differently"));
	const edit = plain(renderPermissionPrompt(p, { toolName: "write", input: { path: "/w/src/a.ts", content: "x" }, cwd: "/w" }, 0, 60, undefined));
	assert.ok(edit.includes("   src/a.ts"));
});

test("allowed prefixes cover one program or subcommand in one directory", () => {
	assert.equal(commandPrefix("  git status --short"), "git status");
	assert.equal(commandPrefix("ls -la"), "ls");
	assert.equal(commandPrefix("/usr/bin/git status"), "/usr/bin/git status");
	assert.equal(commandPrefix("/usr/bin/git -c alias.x='!rm' x"), undefined);
	for (const command of ["git -c core.fsmonitor='rm -rf ~' status", "CI=1 npm test", "env rm -rf x", "sh -c 'rm x'", "node -e 'x'", "find . -exec rm {} +", "xargs rm", "sudo ls", "/usr/bin/env rm", "\"ls\" x"]) {
		assert.equal(commandPrefix(command), undefined, command);
	}
	const state = { mode: "default" as const, allowedCommands: new Set<string>() };
	allowCommand(state, "git status", "/w");
	allowCommand(state, "ls -la", "/w");
	assert.equal(needsPrompt(state, "bash", { command: "git status --short" }, "/w"), false);
	assert.equal(needsPrompt(state, "bash", { command: "ls src" }, "/w"), false);
	assert.equal(needsPrompt(state, "bash", { command: "git push --force" }, "/w"), true);
	assert.equal(needsPrompt(state, "bash", { command: "git status" }, "/elsewhere"), true);
	assert.equal(needsPrompt(state, "bash", { command: "git -c alias.x='!rm -rf ~' x" }, "/w"), true);
	// An allowed prefix must not let a chained or substituted command through.
	for (const command of ["git status && rm -rf x", "git status; curl x | sh", "git status `id`", "git status $(id)", "git status > out", "git status\nrm b", "git status & rm b", "ls\rrm x"]) {
		assert.equal(isCompoundCommand(command), true, command);
		assert.equal(needsPrompt(state, "bash", { command }, "/w"), true, command);
	}
	assert.equal(isCompoundCommand("git status --short"), false);
	const compound = plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: "git a && rm b" }, cwd: "/w" }, 0, 60, undefined));
	assert.ok(!compound.some((l) => l.includes("don't ask again")));
	assert.ok(compound.some((l) => l.startsWith("   2. No")));
});

test("accept edits stays inside the working directory and out of .git", () => {
	const state = { mode: "acceptEdits" as const, allowedCommands: new Set<string>() };
	assert.equal(needsPrompt(state, "edit", { path: "src/a.ts" }, "/w"), false);
	assert.equal(needsPrompt(state, "write", { path: "/w/notes.md" }, "/w"), false);
	assert.equal(needsPrompt(state, "write", { path: "~/.zshrc" }, "/w"), true);
	assert.equal(needsPrompt(state, "write", { path: "@../x" }, "/w"), true);
	assert.equal(needsPrompt(state, "write", { path: ".git/hooks/pre-commit" }, "/w"), true);
	assert.equal(needsPrompt({ ...state, mode: "plan" }, "edit", { path: "src/a.ts" }, "/w"), true);
	assert.equal(resolveToolPath("@~/x", "/w"), `${process.env.HOME}/x`);
});

test("the prompt shows tool text without terminal sequences and with a row limit", () => {
	const lines = renderPermissionPrompt(p, { toolName: "bash", input: { command: "rm -rf ~ # \x1b[1K\x1b[1G  git status" }, cwd: "/w" }, 0, 80, undefined);
	assert.ok(!lines.join("").includes("\x1b[1K"));
	const long = plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: Array.from({ length: 100 }, (_, i) => `echo ${i}`).join("\n") }, cwd: "/w" }, 0, 80, undefined));
	assert.ok(long.some((l) => l.includes("echo 0")));
	assert.ok(long.some((l) => l.includes("… +60 lines")));
	assert.ok(plain(renderPermissionPrompt(p, { toolName: "bash", input: { command: "ls" }, cwd: "/w", nested: true }, 0, 80, undefined)).some((l) => l.includes("subagent")));
});

test("settings: a misspelt permission mode falls back to manual", () => {
	assert.equal(readSettings({ permissionMode: "manual" }).permissionMode, "default");
	assert.equal(readSettings({ permissionMode: "Plan" }).permissionMode, "default");
	assert.equal(readSettings({}).permissionMode, "bypassPermissions");
	assert.equal(settingsProblems({ permissionMode: 1 }).length, 1);
	assert.equal(settingsProblems({ permissionMode: "plan" }).length, 0);
});

test("turn summary and prompt footer", () => {
	assert.deepEqual(plain(renderTurnSummary(p, { id: "abc", durationMs: 65_000 })), [`✻ ${turnVerb("abc")} for 1m 5s`]);
	const at = new Date(2026, 10, 23, 15, 4).getTime();
	assert.deepEqual(plain(renderTurnSummary(p, { id: "abc", durationMs: 65_000, endedAt: at }, at + 60_000)), [`✻ ${turnVerb("abc")} for 1m 5s · done ${formatDoneTime(at, at + 60_000)}`]);
	assert.equal(formatDoneTime(at, at + 60_000, "en-US"), "3:04 PM");
	assert.equal(formatDoneTime(at, at + 2 * 86_400_000, "en-US"), "Mon 3:04 PM");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "default", false)), "  ? for shortcuts");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "default", true)), "  esc to interrupt");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "acceptEdits", false)), "  ⏵⏵ accept edits on (shift+tab to cycle)");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "plan", true)), "  ⏸ plan mode on (shift+tab to cycle) · esc to interrupt");
	assert.equal(stripTerminalSequences(renderPromptFooter(p, "bypassPermissions", false, 36)).length, 36);
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

test("reads and searches collapse into one row, a single one included", async () => {
	const { ToolGroups, groupSummary, renderGroupRows } = await import("../extension/grouping.ts");
	assert.equal(groupSummary({ search: 2, read: 3, list: 0 }, false), "Searched for 2 patterns, read 3 files");
	assert.equal(groupSummary({ search: 0, read: 1, list: 0 }, true), "Reading 1 file…");
	assert.equal(groupSummary({ search: 1, read: 0, list: 2 }, false), "Searched for 1 pattern, listed 2 directories");
	const groups = new ToolGroups();
	groups.add({ role: "user", content: "hi", timestamp: 1 });
	groups.add({ role: "assistant", timestamp: 2, content: [
		{ type: "toolCall", id: "a", name: "read", arguments: { path: "src/a.ts" } },
		{ type: "toolCall", id: "b", name: "grep", arguments: { pattern: "isExpired" } },
		{ type: "toolCall", id: "a2", name: "read", arguments: { path: "src/a.ts" } },
		{ type: "toolCall", id: "c", name: "bash" },
		{ type: "toolCall", id: "d", name: "read", arguments: { path: "src/b.ts" } },
	] });
	groups.start({ role: "assistant", timestamp: 2, content: [{ type: "toolCall", id: "e", name: "find", arguments: { pattern: "*.md" } }] });
	assert.deepEqual(groups.group("a"), ["a", "b", "a2"]);
	assert.equal(groups.group("c"), undefined);
	assert.deepEqual(groups.group("e"), ["d", "e"]);
	const done = { executionStarted: true, isPartial: false, isError: false, hasResult: true, expanded: false };
	for (const id of ["a", "b", "a2"]) groups.setState(id, done);
	const finished = renderGroupRows(p, groups, ["a", "b", "a2"], "ctrl+o");
	// Done: no dot, faint, the same file counted once.
	assert.deepEqual(plain(finished), ["  Searched for 1 pattern, read 1 file (ctrl+o to expand)"]);
	groups.setState("b", { ...done, isError: true });
	const withFailure = renderGroupRows(p, groups, ["a", "b", "a2"], "ctrl+o");
	assert.deepEqual(plain(withFailure), ["  Searched for 1 pattern, read 1 file · 1 failed (ctrl+o to expand)"]);
	groups.setState("b", done);
	groups.setState("d", done);
	groups.setState("e", { ...done, isPartial: true });
	const running = plain(renderGroupRows(p, groups, ["d", "e"], "ctrl+o", (t, k) => (k === "search" ? `"${t}"` : t), 0));
	assert.equal(running[0]!.slice(2), "Searching for 1 pattern, reading 1 file… (ctrl+o to expand)");
	assert.equal(running[1], '  \u23BF \u00A0"*.md"');
	// A single read collapses too.
	const single = new ToolGroups();
	single.add({ role: "assistant", content: [{ type: "toolCall", id: "x", name: "read", arguments: { path: "a" } }] });
	assert.deepEqual(single.group("x"), ["x"]);
	groups.update({ role: "assistant", timestamp: 2, content: [{ type: "text", text: "x" }, { type: "toolCall", id: "e", name: "find" }] });
	assert.deepEqual(groups.group("e"), ["e"]);
	// A compaction ends a run.
	const compacted = new ToolGroups();
	compacted.add({ role: "assistant", content: [{ type: "toolCall", id: "r1", name: "read" }] });
	compacted.addBreak();
	compacted.add({ role: "assistant", content: [{ type: "toolCall", id: "r2", name: "read" }] });
	assert.deepEqual(compacted.group("r2"), ["r2"]);
});

test("hard wrap never exceeds the width, keeps styles and stays linear", () => {
	const wide = `a${"あ".repeat(40)}`;
	const pieces = hardWrap(wide, 76);
	assert.ok(pieces.every((piece) => visibleWidth(piece) <= 76));
	assert.equal(pieces.join(""), wide);
	const styled = hardWrap(`\x1b[31m${"x".repeat(10)}\x1b[0m`, 4);
	assert.equal(styled.length, 3);
	assert.ok(styled[1]!.startsWith("\x1b[31m"));
	assert.deepEqual(styled.map((piece) => stripTerminalSequences(piece)), ["xxxx", "xxxx", "xx"]);
	const started = Date.now();
	hardWrap("y".repeat(200_000), 70);
	assert.ok(Date.now() - started < 1500);
});

test("tool text is sanitized like pi's own renderers", () => {
	assert.equal(sanitize("a\x1b]52;c;ZXZpbA==\x07b\x1b[2Jc\rd\te\x00f\ng"), "abcd    ef\ng");
	const out = BUILTIN_VIEWS.bash!.result!(p, {}, { content: [{ type: "text", text: "ok\x1b]0;pwned\x07\x1b[?1049l\nprogress\r100%" }] }, { cwd: "/", expanded: true, isError: false, isPartial: false, expandKey: "ctrl+o" }, 80);
	assert.deepEqual(out, ["ok", "progress100%"]);
	const row = new CallRow(BUILTIN_VIEWS.bash!, "/", () => p);
	row.args = { command: "rm -rf ~ # \x1b[1K\x1b[1G  git status" };
	assert.ok(!row.render(80).join("").includes("\x1b[1K"));
});

test("narrow and wide rows stay within the width", () => {
	const run = { command: "printf", outputLines: ["a".repeat(200), "あ".repeat(60)], status: "complete" as const, expanded: true };
	const lines = renderBashRun(p, run, 40, (text, tone) => fullOutput(p, text, tone, 35));
	assert.ok(lines.every((line) => visibleWidth(line) <= 40), "! output");
	const rows = new ResultRows(() => p);
	rows.draw = () => ["あ".repeat(50)];
	for (const width of [8, 9, 13, 81]) assert.ok(rows.render(width).every((line) => visibleWidth(line) <= width), `result ${width}`);
	assert.ok(renderCompaction(p, "summary ".repeat(10), true, "ctrl+o", 6).every((line) => visibleWidth(line) <= 6));
	assert.ok(callRow(p, { executionStarted: true, isPartial: false, isError: false, hasResult: true, expanded: true }, "Bash", "あ".repeat(80), 81).every((line) => visibleWidth(line) <= 81));
});

test("the palette follows a theme change on the same theme object", () => {
	const theme = { name: "claude-code-light", getColorMode: () => "truecolor" as const };
	setUi({ theme });
	assert.equal(palette().id, "light");
	theme.name = "claude-code-dark";
	assert.equal(palette().id, "dark");
	setUi(undefined);
});

test("Bash call row, image size, Try examples and expanded thinking", async () => {
	const { commandPreview, formatBytes } = await import("../extension/tools.ts");
	const { promptExample } = await import("../extension/format.ts");
	assert.equal(commandPreview("ls"), "ls");
	assert.equal(commandPreview("a\nb\nc"), "a\nb…");
	assert.equal(commandPreview("x".repeat(170)), `${"x".repeat(160)}…`);
	const rows = plain(callRow(p, { executionStarted: true, isPartial: false, isError: false, hasResult: true, expanded: false }, "Bash", "a\nb…", 40));
	assert.deepEqual(rows.map((r) => r.slice(2)), ["Bash(a", "b…)"]);
	assert.equal(formatBytes(512), "512 bytes");
	assert.equal(formatBytes(12_595), "12.3KB");
	assert.match(promptExample("session", []), /^Try ".*"$/);
	assert.ok(!promptExample("s", []).includes("..."));
	for (const seed of ["s1", "s2", "s3", "s4"]) assert.ok(!promptExample(seed, ["a.ts"]).includes("<filepath>"));
	const expanded = plain(renderThinking(p, "line one\n\nline two", 80, true));
	assert.deepEqual(expanded, ["∴ line one", "  ", "  line two"]);
});
