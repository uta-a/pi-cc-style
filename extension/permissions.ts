/**
 * Claude Code's permission modes and permission prompt, for pi's bash / edit / write tools.
 *
 * pi itself asks for nothing, which is Claude Code's bypassPermissions; that is the default here
 * so installing the extension does not change what runs. shift+tab cycles the modes like
 * Claude Code: manual (default) → accept edits → plan → bypass permissions → manual.
 *
 *   manual             asks before bash, edit and write
 *   accept edits       asks before bash; edits and writes run
 *   plan               asks before bash, edit and write
 *   bypass permissions asks for nothing
 *
 * The prompt (`tl` + `Ate`): a top border in `permission`, the bold title ("Bash command",
 * "Edit file", "Create file" / "Overwrite file"), the command or diff, the question, and the
 * options with the `❯` pointer in `suggestion`.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { parseDiff, renderDiffRows } from "./diff.ts";
import { displayPath } from "./tools.ts";
import { FAST_FORWARD, moreLines, PAUSE, POINTER, sanitize } from "./format.ts";
import type { Palette } from "./palette.ts";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** `Dr` of 2.1.330. */
export const MODE_INFO: Record<PermissionMode, { title: string; indicator: string; symbol: string; color: string }> = {
	default: { title: "Manual", indicator: "manual mode", symbol: PAUSE, color: "inactive" },
	plan: { title: "Plan", indicator: "plan mode", symbol: PAUSE, color: "planMode" },
	acceptEdits: { title: "Accept edits", indicator: "accept edits", symbol: FAST_FORWARD, color: "autoAccept" },
	bypassPermissions: { title: "Bypass Permissions", indicator: "bypass permissions", symbol: FAST_FORWARD, color: "error" },
};

/**
 * `Tr`: manual → accept edits → plan → bypass permissions → manual. Like Claude Code, bypass is in
 * the cycle only when it is available: the session started in it or `/cc-mode` selected it.
 */
export function nextMode(mode: PermissionMode, bypassAvailable = true): PermissionMode {
	const cycle: PermissionMode[] = bypassAvailable ? ["default", "acceptEdits", "plan", "bypassPermissions"] : ["default", "acceptEdits", "plan"];
	const at = cycle.indexOf(mode);
	return cycle[(at + 1) % cycle.length]!;
}

/** `eH`: the mode pill of the footer, lower-case title; faint, bypass in `error`. */
export function modePill(p: Palette, mode: PermissionMode): string {
	const label = MODE_INFO[mode].title.toLowerCase();
	return mode === "bypassPermissions" ? p.fg("error", label) : p.dim(label);
}

/** `hp` / `r8i`: what the model is told when the user declines. */
export const REJECT_MESSAGE =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
/** `O6`: the same refusal followed by what the user typed. */
export const REJECT_WITH_FEEDBACK =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said: ";

export function rejectReason(feedback?: string): string {
	if (!feedback?.trim()) return REJECT_MESSAGE;
	return `${REJECT_WITH_FEEDBACK}${feedback.trim()}`;
}

/**
 * Whether a command chains, pipes, substitutes or redirects. Such a command is never covered by
 * an allowed prefix: `git status && rm -rf x` would otherwise run under an allowed `git status`.
 */
export function isCompoundCommand(command: string): boolean {
	return /[;&|`<>\n\r]|\$\(/.test(command.trim());
}

/**
 * Programs that run other programs or code given as arguments (`env rm`, `sh -c`, `node -e`,
 * `find -exec`, `xargs`, ...). Allowing them by name would allow anything, so they always ask.
 */
const RUNS_ANYTHING = new Set([
	"env", "xargs", "parallel", "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "eval", "exec", "source", ".",
	"sudo", "doas", "su", "nohup", "timeout", "command", "builtin", "nice", "ionice", "time", "watch", "script", "ssh",
	"find", "awk", "gawk", "sed", "perl", "python", "python2", "python3", "ruby", "node", "nodejs", "php", "lua", "osascript",
	"pwsh", "powershell", "Rscript", "tclsh", "expect", "open",
]);

/** Programs with subcommands; allowing one allows that subcommand only (`git status`, not `git push`). */
const HAS_SUBCOMMANDS = new Set([
	"git", "npm", "pnpm", "yarn", "bun", "deno", "npx", "bunx", "cargo", "go", "docker", "podman", "kubectl", "gh", "brew",
	"pip", "pip3", "uv", "poetry", "make", "just", "dotnet", "swift", "gradle", "./gradlew", "mvn", "terraform", "rustup",
]);

const WORD = /^[A-Za-z0-9._+\/-]+$/;
const SUBCOMMAND = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function words(command: string): string[] {
	return command.trim().split(/[ \t]+/).filter(Boolean);
}

/**
 * The prefix "don't ask again" allows for a command, or undefined when the command cannot be
 * allowed by a prefix: compound commands, leading `NAME=value` assignments, quoting or unusual
 * characters in the program name, programs that run anything, and subcommand tools called with
 * a flag first (`git -c core.fsmonitor=… status`).
 */
export function commandPrefix(command: string): string | undefined {
	// `uIe`: commands with tabs, line breaks or characters altered by `sanitize` get no prefix rule.
	if (/[\t\n\u2028\u2029]/.test(command) || sanitize(command) !== command) return undefined;
	if (isCompoundCommand(command)) return undefined;
	const [first, second] = words(command);
	if (!first || !WORD.test(first) || RUNS_ANYTHING.has(basename(first))) return undefined;
	// By the program's name, so `/usr/bin/git` is a subcommand tool too.
	if (!HAS_SUBCOMMANDS.has(first) && !HAS_SUBCOMMANDS.has(basename(first))) return first;
	return second && SUBCOMMAND.test(second) ? `${first} ${second}` : undefined;
}

export interface PermissionState {
	mode: PermissionMode;
	/** Prefixes allowed for the session, as `<cwd>\0<prefix>`. */
	allowedCommands: Set<string>;
	/** Whether shift+tab may cycle into bypass permissions. */
	bypassAvailable?: boolean;
}

export function allowCommand(state: PermissionState, command: string, cwd: string) {
	const prefix = commandPrefix(command);
	if (prefix) state.allowedCommands.add(`${cwd}\0${prefix}`);
}

/** Whether a command starts with a prefix allowed in this directory. */
export function isAllowedCommand(state: PermissionState, command: string, cwd: string): boolean {
	if (commandPrefix(command) === undefined) return false;
	const tokens = words(command);
	for (const rule of state.allowedCommands) {
		const [ruleCwd, prefix] = rule.split("\0");
		if (ruleCwd !== cwd || !prefix) continue;
		if (prefix.split(" ").every((word, i) => tokens[i] === word)) return true;
	}
	return false;
}

/** pi's `resolveToCwd`: a leading `@` dropped, Unicode spaces made plain, `~` expanded. */
export function resolveToolPath(path: string, cwd: string): string {
	let p = path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = homedir();
	else if (p.startsWith("~/")) p = homedir() + p.slice(1);
	return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

/** accept edits approves edits inside the working directory only, and never under `.git/`. */
export function isInsideWorkspace(path: string, cwd: string): boolean {
	const rel = relative(resolve(cwd), resolveToolPath(path, cwd));
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
	return !rel.split(sep).includes(".git");
}

const SHELL_TOOLS = new Set(["bash", "powershell"]);

/** Whether a call needs the prompt in the current mode. */
export function needsPrompt(state: PermissionState, toolName: string, input: Record<string, unknown>, cwd = process.cwd()): boolean {
	if (state.mode === "bypassPermissions") return false;
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		return !isAllowedCommand(state, command, cwd);
	}
	if (SHELL_TOOLS.has(toolName)) return true;
	if (toolName === "edit" || toolName === "write") {
		if (state.mode !== "acceptEdits") return true;
		const path = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : "";
		return !path || !isInsideWorkspace(path, cwd);
	}
	return false;
}

export interface PermissionRequest {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
	/** Another tool (a subagent, a codemode script) issued the call. */
	nested?: boolean;
}

/** Rows of a command or diff shown in the prompt; the rest is counted. The start stays visible. */
const MAX_BODY_ROWS = 40;

function limitRows(p: Palette, rows: string[]): string[] {
	if (rows.length <= MAX_BODY_ROWS) return rows;
	return [...rows.slice(0, MAX_BODY_ROWS), `  ${p.dim(moreLines(rows.length - MAX_BODY_ROWS))}`];
}

export interface PermissionOption {
	value: "yes" | "yes-session" | "no";
	label: string;
}

export function describeRequest(p: Palette, req: PermissionRequest, width: number, highlight?: (code: string, path: string) => string) {
	const rawPath = typeof req.input.path === "string" ? req.input.path : typeof req.input.file_path === "string" ? req.input.file_path : "";
	const path = sanitize(rawPath).replace(/\n/g, " ");
	const abs = rawPath ? resolveToolPath(rawPath, req.cwd) : "";
	// `Xo`: the path relative to the working directory, or with ~.
	const shortPath = abs ? displayPath(abs, req.cwd) : path;
	if (SHELL_TOOLS.has(req.toolName)) {
		const rawCommand = typeof req.input.command === "string" ? req.input.command : "";
		const command = sanitize(rawCommand);
		const prefix = req.toolName === "bash" ? commandPrefix(rawCommand) : undefined;
		// A command no prefix can cover (compound, wrappers, interpreters) only gets yes / no.
		const options: PermissionOption[] = [
			{ value: "yes", label: "Yes" },
			...(prefix === undefined
				? []
				: [
						{
							value: "yes-session" as const,
							label: `Yes, and don't ask again for ${p.bold(prefix)} commands in ${p.bold(sanitize(req.cwd))}`,
						},
					]),
			{ value: "no", label: "No" },
		];
		const body = limitRows(p, command.split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 4)).map((l) => `  ${l}`)));
		const description = typeof req.input.description === "string" ? [`  ${p.dim(sanitize(req.input.description).replace(/\n/g, " "))}`] : [];
		const title = req.toolName === "bash" ? "Bash command" : "PowerShell command";
		return { title, body: [...body, ...description], question: "Do you want to proceed?", options };
	}
	// accept edits would not cover a file outside the working directory, so it is not offered there.
	const inside = rawPath ? isInsideWorkspace(rawPath, req.cwd) : false;
	const editOptions = (): PermissionOption[] => [
		{ value: "yes", label: "Yes" },
		// `sZe` + `Vs.acceptEdits`, then the cycle key in bold.
		...(inside
			? [
					{
						value: "yes-session" as const,
						label: `Yes, and switch to ${p.bold("accept edits (auto-approve file edits and common file commands)")} for this session ${p.bold("(shift+tab)")}`,
					},
				]
			: []),
		{ value: "no", label: "No" },
	];
	if (req.toolName === "write") {
		const exists = abs ? existsSync(abs) : false;
		const content = sanitize(typeof req.input.content === "string" ? req.input.content : "");
		const lines = content.replace(/\n$/, "").split("\n");
		const shown = lines.slice(0, 20).map((line) => `  ${truncateToWidth(highlight ? highlight(line, path) : line, Math.max(1, width - 4), "…")}`);
		if (lines.length > 20) shown.push(p.dim(`  … +${lines.length - 20} lines`));
		return {
			title: exists ? "Overwrite file" : "Create file",
			body: [`  ${p.dim(shortPath)}`, ...shown],
			question: `Do you want to ${exists ? "overwrite" : "create"} ${p.bold(shortPath.split("/").pop() ?? shortPath)}?`,
			options: editOptions(),
		};
	}
	// edit: show the replacements as a diff of old → new text
	const edits = Array.isArray(req.input.edits)
		? (req.input.edits as { oldText?: string; newText?: string }[])
		: [{ oldText: req.input.oldText as string | undefined, newText: req.input.newText as string | undefined }];
	const body: string[] = [`  ${p.dim(shortPath)}`];
	for (const edit of edits) {
		const before = sanitize(edit.oldText ?? "", { keepTabs: true }).split("\n");
		const after = sanitize(edit.newText ?? "", { keepTabs: true }).split("\n");
		const diff = [...before.map((l, i) => `-${i + 1} ${l}`), ...after.map((l, i) => `+${i + 1} ${l}`)].join("\n");
		body.push(...renderDiffRows(p, parseDiff(diff), Math.max(20, width - 4), { highlight: highlight ? (c) => highlight(c, path) : undefined }).map((l) => `  ${l}`));
	}
	return {
		title: "Edit file",
		body: limitRows(p, body),
		question: `Do you want to make this edit to ${p.bold(shortPath.split("/").pop() ?? shortPath)}?`,
		options: editOptions(),
	};
}

/** The prompt as lines. `selected` is the focused option index. */
export function renderPermissionPrompt(
	p: Palette,
	req: PermissionRequest,
	selected: number,
	width: number,
	feedback: { active: boolean; text: string } | undefined,
	highlight?: (code: string, path: string) => string,
): string[] {
	const d = describeRequest(p, req, width, highlight);
	const out: string[] = [""];
	out.push(p.fg("permission", "─".repeat(Math.max(0, width))));
	out.push(` ${p.style(d.title, { bold: true, color: "permission" })}`);
	if (req.nested) out.push(` ${p.dim("Requested by a subagent or another tool")}`);
	out.push("");
	for (const line of d.body) out.push(truncateToWidth(` ${line}`, width, ""));
	out.push("");
	out.push(` ${d.question}`);
	const numberWidth = String(d.options.length).length + 1;
	d.options.forEach((option, i) => {
		const focused = i === selected;
		const pointer = focused ? p.fg("suggestion", POINTER) : " ";
		const number = p.dim(`${i + 1}.`.padEnd(numberWidth));
		let label = focused ? p.fg("suggestion", option.label) : option.label;
		// The `No` option is an input (`type: "input"`) once amending; its placeholder is faint.
		if (option.value === "no" && feedback?.active) {
			label = `${p.fg("suggestion", "No")} ${feedback.text ? feedback.text : p.dim("and tell Claude what to do differently")}`;
		}
		out.push(truncateToWidth(` ${pointer} ${number} ${label}`, width, "…"));
	});
	out.push("");
	const hints = feedback?.active ? "Enter to submit · Esc to cancel" : "Esc to cancel · Tab to amend";
	out.push(` ${p.dim(hints)}`);
	return out.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
}
