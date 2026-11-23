/**
 * pi-cc-style — Claude Code 2.1.330's look and UI behaviour for pi.
 *
 * - Themes: claude-code-{dark,light}{,-ansi,-daltonized} from Claude Code's theme table
 * - Startup header: Clawd and three lines (product, model, directory)
 * - Messages: `❯` user prompts, `⏺` replies, `∴` thinking, interrupts and API errors
 * - Tool rows: `⏺ Read(path)` with the blinking dot, `  ⎿  Read 42 lines`, diffs, Bash output
 * - Spinner: the eased glyph, the verb with its glimmer, elapsed time, tokens, thinking state
 * - Turn summary: `✻ Cooked for 1m 5s`
 * - Prompt box: round border above and below, `❯`, the `Try "…"` example, the hint row
 * - Permission modes on shift+tab with Claude Code's permission prompt for bash / edit / write
 *
 * System prompt and tools stay pi's. Does nothing inside pi-subagents children.
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import {
	AssistantMessageComponent,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getLanguageFromPath,
	highlightCode,
	InteractiveMode,
	UserMessageComponent,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { decorateEditor } from "./editor.ts";
import { PROMPT_EXAMPLES, tildify } from "./format.ts";
import { renderHeader } from "./header.ts";
import { Lines, patchMessages } from "./messages.ts";
import {
	needsPrompt,
	nextMode,
	type PermissionMode,
	type PermissionState,
	rejectReason,
	renderPermissionPrompt,
	commandPrefix,
} from "./permissions.ts";
import { getSettings, isToolsExpanded, palette, readSettings, setSettings, setToolsExpanded, setUi } from "./runtime.ts";
import { renderSpinner, SpinnerState } from "./spinner.ts";
import { BUILTIN_VIEWS, CallRow, genericView, ResultRows, type ToolView } from "./tools.ts";
import { renderPromptFooter, renderTurnSummary, TURN_ENTRY, type TurnEntryData } from "./turn.ts";

const isSubagentChild = () => process.env.PI_SUBAGENT_CHILD === "1" || Boolean(process.env.PI_SUBAGENT_PARENT_SESSION);

const STATUS_PATCHED = Symbol.for("pi-cc-style.status");

/** Highlights one line of code for a path, in the active theme's syntax colours. */
function highlightLine(code: string, path: string): string {
	try {
		const lang = getLanguageFromPath(path);
		if (!lang) return code;
		return highlightCode(code, lang)[0] ?? code;
	} catch {
		return code;
	}
}

/** Claude Code shows the model without the "Claude " prefix and the context suffix. */
export function modelLabel(name: string | undefined): string | undefined {
	if (!name) return undefined;
	return name.replace(/^Claude\s+/i, "").replace(/\s*\((?:1M|200k)[^)]*\)\s*$/i, "").replace(/\s+1M$/i, "");
}

function pickExample(cwd: string): string {
	let file: string | undefined;
	try {
		file = readdirSync(cwd).find((name) => /\.(ts|tsx|js|py|go|rs|rb|java|swift|kt)$/.test(name));
	} catch {
		file = undefined;
	}
	const examples = file ? PROMPT_EXAMPLES : PROMPT_EXAMPLES.filter((e) => !e.includes("<file>"));
	const example = examples[Math.floor(Math.random() * examples.length)] ?? "fix lint errors";
	return `Try "${example.replace("<file>", file ?? "")}"`;
}

export default function piCcStyle(pi: ExtensionAPI) {
	if (isSubagentChild()) return;

	const loadSettings = () => setSettings(readSettings((pi.getSettings() as Record<string, unknown>).ccStyle));
	loadSettings();

	// Message rows (prototype patches; they follow the setting on every render).
	patchMessages({ AssistantMessageComponent, UserMessageComponent } as never, palette, () => getSettings().messages);

	// ctrl+o: Claude Code toggles the transcript without a notice.
	const modeProto = InteractiveMode.prototype as unknown as Record<string | symbol, unknown>;
	if (!modeProto[STATUS_PATCHED] && typeof modeProto.showStatus === "function") {
		modeProto[STATUS_PATCHED] = true;
		const showStatus = modeProto.showStatus as (this: unknown, message: string) => void;
		modeProto.showStatus = function (this: unknown, message: string) {
			const m = /^Tool output: (expanded|collapsed)/.exec(message);
			if (m) {
				setToolsExpanded(m[1] === "expanded");
				if (getSettings().tools) return;
			}
			return showStatus.call(this, message);
		};
	}

	const spinner = new SpinnerState();
	const permissions: PermissionState = { mode: getSettings().permissionMode, allowedCommands: new Set() };
	let tui: TUI | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let hasUserMessage = false;
	let placeholder: string | undefined;
	let unsubscribeInput: (() => void) | undefined;
	let currentCtx: ExtensionContext | undefined;

	const requestRender = () => tui?.requestRender();
	const startTicker = () => {
		if (ticker) return;
		ticker = setInterval(requestRender, 50);
		ticker.unref?.();
	};
	const stopTicker = () => {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	};

	// Tool rows.
	pi.registerToolRenderer((toolName, next) => {
		if (!getSettings().tools) return next();
		const existing = next();
		let view: ToolView | undefined = BUILTIN_VIEWS[toolName];
		if (!view) {
			if (existing?.renderCall || existing?.renderResult) return existing;
			view = genericView(toolName);
		}
		const toolView = view;
		return {
			renderShell: "self",
			renderCall(args, _theme, context) {
				const state = context.state as { call?: CallRow };
				const row = state.call ?? new CallRow(toolView, context.cwd ?? process.cwd(), palette);
				state.call = row;
				row.args = (args ?? {}) as Record<string, unknown>;
				row.state = {
					executionStarted: context.executionStarted,
					isPartial: context.isPartial,
					isError: context.isError,
					hasResult: !context.isPartial,
					expanded: context.expanded,
				};
				return row;
			},
			renderResult(result, options, _theme, context) {
				const state = context.state as { result?: ResultRows; call?: CallRow };
				const rows = state.result ?? new ResultRows(palette);
				state.result = rows;
				if (state.call) {
					state.call.state = {
						...state.call.state,
						isPartial: options.isPartial,
						isError: context.isError,
						hasResult: !options.isPartial,
						expanded: options.expanded,
					};
				}
				const expandKey = context.keyText?.("app.tools.expand") || "ctrl+o";
				const args = (context.args ?? {}) as Record<string, unknown>;
				rows.draw = (width) =>
					toolView.result?.(palette(), args, result as never, {
						cwd: context.cwd ?? process.cwd(),
						expanded: options.expanded,
						isError: context.isError,
						isPartial: options.isPartial,
						expandKey,
						highlight: highlightLine,
					}, width) ?? [];
				return rows;
			},
		};
	});

	// Turn summary entries.
	pi.registerEntryRenderer<TurnEntryData>(TURN_ENTRY, (entry) => {
		const data = entry.data;
		if (!data || !getSettings().turnDuration) return undefined;
		return new Lines(() => renderTurnSummary(palette(), data));
	});

	const installUi = (ctx: ExtensionContext) => {
		currentCtx = ctx;
		setUi(ctx.ui);
		const settings = getSettings();
		try {
			setToolsExpanded(ctx.ui.getToolsExpanded());
		} catch {
			// Older pi without getToolsExpanded.
		}

		if (settings.header) {
			ctx.ui.setHeader((headerTui) => {
				tui = headerTui;
				return new Lines((width) => [
					...renderHeader(
						palette(),
						{
							title: getSettings().headerTitle,
							version: VERSION,
							model: modelLabel(currentCtx?.model?.name ?? currentCtx?.model?.id),
							effort: currentCtx?.model?.reasoning ? pi.getThinkingLevel() : undefined,
							billing: currentCtx?.model?.provider,
							cwd: tildify(currentCtx?.cwd ?? process.cwd()),
						},
						width,
					),
					"",
				]);
			});
		}

		if (settings.spinner) {
			ctx.ui.setWorkingVisible(false);
			ctx.ui.setWidget(
				"cc-style-spinner",
				(widgetTui) => {
					tui = widgetTui;
					return new Lines((width) => renderSpinner(palette(), spinner, { now: Date.now(), width }));
				},
				{ placement: "aboveEditor" },
			);
		}

		if (settings.prompt) {
			ctx.ui.setWidget(
				"cc-style-hints",
				(widgetTui) => {
					tui = widgetTui;
					return new Lines(() => [renderPromptFooter(palette(), permissions.mode, spinner.active)]);
				},
				{ placement: "belowEditor" },
			);
			const previous = ctx.ui.getEditorComponent();
			ctx.ui.setEditorComponent((editorTui, theme, keybindings) => {
				tui = editorTui;
				const editor = previous ? previous(editorTui, theme, keybindings) : new CustomEditor(editorTui, theme, keybindings);
				return decorateEditor(editor, {
					palette,
					enabled: () => getSettings().prompt,
					placeholder: () => (hasUserMessage ? undefined : placeholder),
				});
			});
		}

		// shift+tab cycles the permission mode, as in Claude Code.
		unsubscribeInput?.();
		unsubscribeInput = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, Key.shift("tab"))) return undefined;
			permissions.mode = nextMode(permissions.mode);
			requestRender();
			return { consume: true };
		});
	};

	pi.on("session_start", (_event, ctx) => {
		loadSettings();
		permissions.mode = getSettings().permissionMode;
		permissions.allowedCommands.clear();
		hasUserMessage = ctx.sessionManager
			.getBranch()
			.some((entry) => entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "user");
		placeholder = pickExample(ctx.cwd);
		if (!ctx.hasUI) return;
		installUi(ctx);
	});

	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());

	pi.on("session_shutdown", () => {
		stopTicker();
		spinner.stop();
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		setUi(undefined);
	});

	// Spinner state.
	pi.on("agent_start", () => {
		if (!getSettings().spinner) return;
		spinner.start(Date.now());
		startTicker();
	});
	pi.on("message_start", (event) => {
		const role = (event.message as { role?: string }).role;
		if (role === "user") hasUserMessage = true;
		if (role === "assistant") spinner.request(Date.now());
	});
	pi.on("message_update", (event) => {
		const e = event.assistantMessageEvent as { type: string; delta?: string };
		const length = typeof e.delta === "string" ? e.delta.length : 0;
		if (e.type === "text_delta") spinner.delta("text", length, Date.now());
		else if (e.type === "thinking_delta") spinner.delta("thinking", length, Date.now());
		else if (e.type === "toolcall_delta") spinner.delta("toolcall", length, Date.now());
	});
	pi.on("tool_execution_start", () => spinner.toolStart(Date.now()));
	pi.on("tool_execution_end", () => spinner.toolEnd(Date.now()));
	pi.on("agent_end", (event) => {
		const startedAt = spinner.startedAt;
		const wasActive = spinner.active;
		spinner.stop();
		stopTicker();
		requestRender();
		if (!wasActive || !getSettings().turnDuration) return;
		const last = [...event.messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as
			| { stopReason?: string }
			| undefined;
		if (last?.stopReason === "aborted" || last?.stopReason === "error") return;
		pi.appendEntry<TurnEntryData>(TURN_ENTRY, { id: randomUUID(), durationMs: Date.now() - startedAt });
	});

	// Permission prompt.
	pi.on("tool_call", async (event, ctx) => {
		const input = (event.input ?? {}) as Record<string, unknown>;
		if (!needsPrompt(permissions, event.toolName, input)) return undefined;
		if (!ctx.hasUI) return { block: true, reason: "Permission required, but there is no UI to ask." };
		const request = { toolName: event.toolName, input, cwd: ctx.cwd };
		const answer = await ctx.ui.custom<{ value: "yes" | "yes-session" | "no"; feedback?: string }>((dialogTui, _theme, _kb, done) => {
			let selected = 0;
			let feedback: { active: boolean; text: string } | undefined;
			return {
				render: (width: number) => renderPermissionPrompt(palette(), request, selected, width, feedback, highlightLine),
				invalidate() {},
				handleInput(data: string) {
					if (feedback?.active) {
						if (matchesKey(data, Key.escape)) feedback = undefined;
						else if (matchesKey(data, Key.enter)) return done({ value: "no", feedback: feedback.text });
						else if (matchesKey(data, Key.backspace)) feedback.text = feedback.text.slice(0, -1);
						else if (data.length === 1 && data >= " ") feedback.text += data;
						else if (data.length > 1 && !data.startsWith("\x1b")) feedback.text += data;
						dialogTui.requestRender();
						return;
					}
					if (matchesKey(data, Key.up)) selected = (selected + 2) % 3;
					else if (matchesKey(data, Key.down)) selected = (selected + 1) % 3;
					else if (matchesKey(data, Key.tab)) feedback = { active: true, text: "" };
					else if (matchesKey(data, Key.shift("tab")) && event.toolName !== "bash") return done({ value: "yes-session" });
					else if (matchesKey(data, Key.escape)) return done({ value: "no" });
					else if (data === "1" || data === "2" || data === "3") return done({ value: (["yes", "yes-session", "no"] as const)[Number(data) - 1]! });
					else if (matchesKey(data, Key.enter)) return done({ value: (["yes", "yes-session", "no"] as const)[selected]! });
					dialogTui.requestRender();
				},
			};
		});
		if (answer?.value === "yes") return undefined;
		if (answer?.value === "yes-session") {
			if (event.toolName === "bash") permissions.allowedCommands.add(commandPrefix(String(input.command ?? "")));
			else permissions.mode = "acceptEdits";
			requestRender();
			return undefined;
		}
		return { block: true, reason: rejectReason(answer?.feedback), terminate: true };
	});

	pi.registerCommand("cc-mode", {
		description: "Set the permission mode: default, acceptEdits, plan, bypassPermissions",
		getArgumentCompletions: (prefix: string) =>
			(["default", "acceptEdits", "plan", "bypassPermissions"] as const)
				.filter((m) => m.startsWith(prefix))
				.map((m) => ({ value: m, label: m })),
		handler: async (args, ctx) => {
			const mode = args.trim() as PermissionMode;
			if (!["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode)) {
				ctx.ui.notify(`Permission mode: ${permissions.mode}`, "info");
				return;
			}
			permissions.mode = mode;
			requestRender();
		},
	});
}

export { isToolsExpanded };
