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
import { isAbsolute, resolve } from "node:path";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { parseDiff, renderDiffRows } from "./diff.ts";
import { FAST_FORWARD, PAUSE, POINTER } from "./format.ts";
import type { Palette } from "./palette.ts";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** `Dr` of 2.1.330. */
export const MODE_INFO: Record<PermissionMode, { title: string; indicator: string; symbol: string; color: string }> = {
	default: { title: "Manual", indicator: "manual mode", symbol: PAUSE, color: "inactive" },
	plan: { title: "Plan", indicator: "plan mode", symbol: PAUSE, color: "planMode" },
	acceptEdits: { title: "Accept edits", indicator: "accept edits", symbol: FAST_FORWARD, color: "autoAccept" },
	bypassPermissions: { title: "Bypass Permissions", indicator: "bypass permissions", symbol: FAST_FORWARD, color: "error" },
};

const CYCLE: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

export function nextMode(mode: PermissionMode): PermissionMode {
	return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length]!;
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

/** The first word of a command, which "don't ask again" allows for the session. */
export function commandPrefix(command: string): string {
	const first = command.trim().split(/\s+/)[0] ?? "";
	return first.replace(/^['"]|['"]$/g, "");
}

export interface PermissionState {
	mode: PermissionMode;
	/** Commands allowed for the session by their first word. */
	allowedCommands: Set<string>;
}

/** Whether a call needs the prompt in the current mode. */
export function needsPrompt(state: PermissionState, toolName: string, input: Record<string, unknown>): boolean {
	if (state.mode === "bypassPermissions") return false;
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		return !state.allowedCommands.has(commandPrefix(command));
	}
	if (toolName === "edit" || toolName === "write") return state.mode !== "acceptEdits";
	return false;
}

export interface PermissionRequest {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
}

export interface PermissionOption {
	value: "yes" | "yes-session" | "no";
	label: string;
}

export function describeRequest(p: Palette, req: PermissionRequest, width: number, highlight?: (code: string, path: string) => string) {
	const path = typeof req.input.path === "string" ? req.input.path : typeof req.input.file_path === "string" ? req.input.file_path : "";
	const abs = path ? (isAbsolute(path) ? path : resolve(req.cwd, path)) : "";
	const shortPath = path;
	if (req.toolName === "bash") {
		const command = typeof req.input.command === "string" ? req.input.command : "";
		const prefix = commandPrefix(command);
		const options: PermissionOption[] = [
			{ value: "yes", label: "Yes" },
			{
				value: "yes-session",
				label: `Yes, and don't ask again for ${p.bold(prefix)} commands in ${p.bold(req.cwd.replace(process.env.HOME ?? "\0", "~"))}`,
			},
			{ value: "no", label: `No, and tell Claude what to do differently ${p.bold("(esc)")}` },
		];
		const body = command.split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 4)).map((l) => `  ${l}`));
		const description = typeof req.input.description === "string" ? [`  ${p.dim(req.input.description)}`] : [];
		return { title: "Bash command", body: [...body, ...description], question: "Do you want to proceed?", options };
	}
	const editOptions = (): PermissionOption[] => [
		{ value: "yes", label: "Yes" },
		// `sZe` + `Vs.acceptEdits`, then the cycle key in bold.
		{
			value: "yes-session",
			label: `Yes, and switch to ${p.bold("accept edits (auto-approve file edits and common file commands)")} for this session ${p.bold("(shift+tab)")}`,
		},
		{ value: "no", label: `No, and tell Claude what to do differently ${p.bold("(esc)")}` },
	];
	if (req.toolName === "write") {
		const exists = abs ? existsSync(abs) : false;
		const content = typeof req.input.content === "string" ? req.input.content : "";
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
		const before = (edit.oldText ?? "").split("\n");
		const after = (edit.newText ?? "").split("\n");
		const diff = [...before.map((l, i) => `-${i + 1} ${l}`), ...after.map((l, i) => `+${i + 1} ${l}`)].join("\n");
		body.push(...renderDiffRows(p, parseDiff(diff), Math.max(20, width - 4), { highlight: highlight ? (c) => highlight(c, path) : undefined }).map((l) => `  ${l}`));
	}
	return {
		title: "Edit file",
		body,
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
		if (option.value === "no" && feedback?.active) {
			label = `${p.fg("suggestion", "No")}, ${feedback.text ? feedback.text : p.dim("tell Claude what to do differently")}`;
		}
		out.push(truncateToWidth(` ${pointer} ${number} ${label}`, width, "…"));
	});
	out.push("");
	const hints = feedback?.active ? "enter to submit · esc to cancel" : "esc to cancel · tab to amend";
	out.push(` ${p.dim(hints)}`);
	return out.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
}
