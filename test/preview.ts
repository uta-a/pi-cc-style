/**
 * Prints the rows of each element with the Claude Code dark palette:
 *   node test/preview.ts [--light] [--plain]
 */
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { parseDiff, renderDiffRows } from "../extension/diff.ts";
import { renderHeader } from "../extension/header.ts";
import { renderApiError, renderBashRun, renderInterrupted, renderThinking, renderUserPrompt, resultRows } from "../extension/messages.ts";
import { Palette } from "../extension/palette.ts";
import { renderPermissionPrompt } from "../extension/permissions.ts";
import { renderSpinner, SpinnerState } from "../extension/spinner.ts";
import { BUILTIN_VIEWS, callRow } from "../extension/tools.ts";
import { renderPromptFooter, renderTurnSummary } from "../extension/turn.ts";

const plain = process.argv.includes("--plain");
const p = new Palette(process.argv.includes("--light") ? "light" : "dark", "truecolor");
const width = Math.min(process.stdout.columns || 100, 100);
const out = (lines: string[]) => {
	for (const line of lines) console.log(plain ? stripTerminalSequences(line) : line);
};
const section = (name: string) => console.log(`\n\x1b[2m── ${name} ${"─".repeat(Math.max(0, width - name.length - 4))}\x1b[22m`);
const done = { executionStarted: true, isPartial: false, isError: false, hasResult: true, expanded: false };
const ctx = { cwd: "/work", expanded: false, isError: false, isPartial: false, expandKey: "ctrl+o" };

section("header");
out(renderHeader(p, { title: "Pi", version: "1.5.2", model: "Opus 5.5", effort: "high", billing: "claude-bridge", cwd: "~/work/project" }, width));

section("prompt, thinking, reply");
out(["", ...renderUserPrompt(p, "Find where sessions are validated and fix the expiry check", width)]);
out(["", ...renderThinking(p, "The user wants the expiry check fixed. Look at the session module first.", width)]);
out(["", `${p.fg("text", "⏺")} I'll look at the session module first.`]);

section("tools");
out(["", ...callRow(p, done, "Read", "src/session.ts", width)]);
out(resultRows(BUILTIN_VIEWS.read!.result!(p, {}, { content: [{ type: "text", text: "a\n".repeat(128) }] }, ctx, width), p));
out(["", ...callRow(p, done, "Bash", "npm test", width)]);
out(resultRows(BUILTIN_VIEWS.bash!.result!(p, {}, { content: [{ type: "text", text: "> test\n> node --test\n✔ session expiry (2ms)\n✔ refresh (1ms)\nℹ pass 2" }] }, ctx, width), p));
out(["", ...callRow(p, done, "Update", "src/session.ts", width)]);
const diff = [" 11 export function isExpired(session: Session): boolean {", "-12   return session.expiresAt < Date.now() / 1000;", "+12   return session.expiresAt * 1000 <= Date.now();", " 13 }"].join("\n");
out(resultRows(["Added \x1b[1m1\x1b[22m line, removed \x1b[1m1\x1b[22m line", ...renderDiffRows(p, parseDiff(diff), width - 12)], p));
out(["", ...callRow(p, { ...done, isError: true }, "Bash", "npm run lint", width)]);
out(resultRows(BUILTIN_VIEWS.bash!.result!(p, {}, { content: [{ type: "text", text: "src/session.ts:12:3 error  Unexpected any" }] }, { ...ctx, isError: true }, width), p));

section("spinner");
const s = new SpinnerState();
s.start(0, () => 0, ["Pondering"]);
s.delta("text", 4800, 13_000);
out(renderSpinner(p, s, { now: 13_000, width }));
s.delta("thinking", 10, 14_000);
out(renderSpinner(p, s, { now: 26_000, width }));

section("interrupt, error, turn summary");
out(["", ...renderUserPrompt(p, "stop", width), ...renderInterrupted(p, width)]);
out(["", ...renderApiError(p, "API Error: 529 Overloaded", width)]);
out(["", ...renderTurnSummary(p, { id: "preview", durationMs: 95_000 })]);

section("! command");
out(renderBashRun(p, { command: "git status --short", outputLines: [" M src/session.ts", "?? notes.md"], status: "complete", expanded: false }, width, (text) => text.split("\n")));

section("permission prompt");
out(renderPermissionPrompt(p, { toolName: "bash", input: { command: "npm publish" }, cwd: "/work" }, 0, width, undefined));

section("prompt footer");
out([renderPromptFooter(p, "default", false), renderPromptFooter(p, "default", true), renderPromptFooter(p, "acceptEdits", false), renderPromptFooter(p, "bypassPermissions", false)]);
