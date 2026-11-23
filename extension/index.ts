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
	BashExecutionComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getLanguageFromPath,
	highlightCode,
	InteractiveMode,
	keyText,
	UserMessageComponent,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { decorateEditor } from "./editor.ts";
import { COLLAPSIBLE, ToolGroups } from "./grouping.ts";
import { PROMPT_EXAMPLES, sanitize, tildify } from "./format.ts";
import { renderHeader } from "./header.ts";
import { CachedLines, Lines, patchExtras, patchMessages } from "./messages.ts";
import {
	allowCommand,
	describeRequest,
	needsPrompt,
	nextMode,
	type PermissionMode,
	type PermissionState,
	REJECT_MESSAGE,
	rejectReason,
	renderPermissionPrompt,
} from "./permissions.ts";
import { getSettings, isToolsExpanded, palette, readSettings, setSettings, settingsProblems, setToolsExpanded, setUi } from "./runtime.ts";
import { renderSpinner, SpinnerState } from "./spinner.ts";
import { BUILTIN_VIEWS, CallRow, fullOutput, genericView, ResultRows, type ToolView, truncatedOutput } from "./tools.ts";
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

	let settingsWarnings: string[] = [];
	// pi.getSettings() is unavailable while extensions load; settings are read at session_start.
	const loadSettings = () => {
		try {
			const raw = (pi.getSettings() as Record<string, unknown>).ccStyle;
			setSettings(readSettings(raw));
			settingsWarnings = settingsProblems(raw);
		} catch {
			// Keep the current settings.
		}
	};

	// Message rows (prototype patches; they follow the setting on every render).
	patchMessages({ AssistantMessageComponent, UserMessageComponent } as never, palette, () => getSettings().messages);
	const expandKey = () => {
		try {
			return keyText("app.tools.expand") || "ctrl+o";
		} catch {
			return "ctrl+o";
		}
	};
	patchExtras(
		{ BashExecutionComponent, CompactionSummaryMessageComponent } as never,
		palette,
		() => getSettings().messages,
		(text, tone, width, expanded) =>
			expanded ? fullOutput(palette(), text, tone, width - 5) : truncatedOutput(palette(), text, width, expandKey(), tone),
		expandKey,
	);

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
	const groups = new ToolGroups();
	const permissions: PermissionState = { mode: getSettings().permissionMode, allowedCommands: new Set() };
	let tui: TUI | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let hasUserMessage = false;
	let placeholder: string | undefined;
	let unsubscribeInput: (() => void) | undefined;
	let currentCtx: ExtensionContext | undefined;
	/** A permission prompt is open; the hint row under the prompt hides meanwhile. */
	let prompting = 0;
	/** The prompt editor, to know whether it has the focus. */
	let promptEditor: { focused?: boolean } | undefined;

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
				if (COLLAPSIBLE[toolName]) {
					row.grouping = { id: context.toolCallId, groups, expandKey: () => context.keyText?.("app.tools.expand") || "ctrl+o" };
					groups.setState(context.toolCallId, row.state);
				}
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
					if (COLLAPSIBLE[toolName]) groups.setState(context.toolCallId, state.call.state);
				}
				rows.collapsed = () => Boolean(COLLAPSIBLE[toolName] && !options.expanded && groups.group(context.toolCallId));
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
		return new CachedLines(() => renderTurnSummary(palette(), data), palette);
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
					return new Lines((width) => (prompting > 0 ? [] : [renderPromptFooter(palette(), permissions.mode, turnStartedAt !== undefined, width)]));
				},
				{ placement: "belowEditor" },
			);
			const previous = ctx.ui.getEditorComponent();
			ctx.ui.setEditorComponent((editorTui, theme, keybindings) => {
				tui = editorTui;
				const editor = previous ? previous(editorTui, theme, keybindings) : new CustomEditor(editorTui, theme, keybindings);
				promptEditor = editor as { focused?: boolean };
				return decorateEditor(editor, {
					palette,
					enabled: () => getSettings().prompt,
					placeholder: () => (hasUserMessage ? undefined : placeholder),
				});
			});
		}

		// shift+tab cycles the permission mode, as in Claude Code: only while the prompt has the focus,
		// so dialogs and pi's selectors keep the key.
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		if (getSettings().modeCycle) {
			unsubscribeInput = ctx.ui.onTerminalInput((data) => {
				if (!matchesKey(data, Key.shift("tab"))) return undefined;
				if (prompting > 0 || !promptEditor?.focused) return undefined;
				permissions.mode = nextMode(permissions.mode, permissions.bypassAvailable);
				requestRender();
				return { consume: true };
			});
		}
	};

	pi.on("session_start", (_event, ctx) => {
		loadSettings();
		permissions.mode = getSettings().permissionMode;
		permissions.bypassAvailable = permissions.mode === "bypassPermissions";
		permissions.allowedCommands.clear();
		hasUserMessage = ctx.sessionManager
			.getBranch()
			.some((entry) => entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "user");
		placeholder = pickExample(ctx.cwd);
		groups.reset();
		for (const entry of ctx.sessionManager.getBranch()) {
			const message = (entry as { type?: string; message?: { role?: string; content?: unknown; timestamp?: number } }).message;
			if (entry.type === "message" && message) groups.add(message);
			else if (entry.type === "compaction") groups.addBreak();
		}
		if (!ctx.hasUI) return;
		for (const warning of settingsWarnings) ctx.ui.notify(`pi-cc-style: ${warning}`, "warning");
		installUi(ctx);
	});

	pi.on("session_compact", () => groups.addBreak());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());

	pi.on("session_shutdown", () => {
		stopTicker();
		spinner.stop();
		unsubscribeInput?.();
		unsubscribeInput = undefined;
		setUi(undefined);
	});

	// Turn and spinner state. The turn is tracked even with the spinner off, for the summary and hints.
	let turnStartedAt: number | undefined;
	pi.on("agent_start", () => {
		turnStartedAt = Date.now();
		if (getSettings().spinner) {
			spinner.start(turnStartedAt);
			startTicker();
		}
		requestRender();
	});
	pi.on("message_start", (event) => {
		groups.start(event.message as never);
		const role = (event.message as { role?: string }).role;
		if (role === "user") hasUserMessage = true;
		if (role === "assistant") {
			spinner.request(Date.now());
			declinedBatch = false;
		}
	});
	pi.on("message_end", (event) => groups.update(event.message as never));
	pi.on("message_update", (event) => {
		groups.update(event.message as never);
		const e = event.assistantMessageEvent as { type: string; delta?: string };
		const length = typeof e.delta === "string" ? e.delta.length : 0;
		if (e.type === "text_delta") spinner.delta("text", length, Date.now());
		else if (e.type === "thinking_delta") spinner.delta("thinking", length, Date.now());
		else if (e.type === "toolcall_delta") spinner.delta("toolcall", length, Date.now());
	});
	// Calls made by other tools (subagents, codemode) are not the main turn's tool use.
	pi.on("tool_execution_start", (event) => {
		if (!(event as { parentToolCallId?: string }).parentToolCallId) spinner.toolStart(Date.now());
	});
	pi.on("tool_execution_end", (event) => {
		if (!(event as { parentToolCallId?: string }).parentToolCallId) spinner.toolEnd(Date.now());
	});
	pi.on("agent_end", (event) => {
		const startedAt = turnStartedAt;
		turnStartedAt = undefined;
		spinner.stop();
		stopTicker();
		requestRender();
		if (startedAt === undefined || !getSettings().turnDuration) return;
		const last = [...event.messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as
			| { stopReason?: string }
			| undefined;
		if (last?.stopReason === "aborted" || last?.stopReason === "error") return;
		pi.appendEntry<TurnEntryData>(TURN_ENTRY, { id: randomUUID(), durationMs: Date.now() - startedAt });
	});

	// Permission prompt.
	/** The user declined a call of the current response; its remaining calls are declined too. */
	let declinedBatch = false;
	pi.on("tool_call", async (event, ctx) => {
		const input = (event.input ?? {}) as Record<string, unknown>;
		const nested = Boolean((event as { parentToolCallId?: string }).parentToolCallId);
		if (declinedBatch && !nested) return { block: true, reason: REJECT_MESSAGE, terminate: true };
		if (!needsPrompt(permissions, event.toolName, input, ctx.cwd)) return undefined;
		if (!ctx.hasUI) return { block: true, reason: "Permission required, but there is no UI to ask." };
		const request = { toolName: event.toolName, input, cwd: ctx.cwd, nested };
		const options = describeRequest(palette(), request, 80).options;
		const values = options.map((option) => option.value);
		let answer: { value: "yes" | "yes-session" | "no"; feedback?: string } | undefined;
		prompting++;
		requestRender();
		try {
			if (ctx.mode !== "tui") {
				// RPC and JSON clients get a plain choice instead of the terminal component.
				const labels = options.map((option) => stripTerminalSequences(option.label));
				const d = describeRequest(palette(), request, 80);
				const picked = await ctx.ui.select(stripTerminalSequences(`${d.title}: ${d.question}`), labels);
				const at = picked === undefined ? -1 : labels.indexOf(picked);
				answer = { value: at >= 0 ? values[at]! : "no" };
			} else {
				answer = await ctx.ui.custom<{ value: "yes" | "yes-session" | "no"; feedback?: string }>((dialogTui, _theme, _kb, done) => {
					let selected = 0;
					let feedback: { active: boolean; text: string } | undefined;
					// Keys typed just before the prompt opened (a steering message, Enter) must not answer it.
					const openedAt = Date.now();
					let cache: { key: string; palette: unknown; lines: string[] } | undefined;
					return {
						render(width: number) {
							const p = palette();
							const key = [width, selected, feedback?.active, feedback?.text].join("\0");
							if (cache?.key === key && cache.palette === p) return cache.lines;
							cache = { key, palette: p, lines: renderPermissionPrompt(p, request, selected, width, feedback, highlightLine) };
							return cache.lines;
						},
						invalidate() {
							cache = undefined;
						},
						handleInput(data: string) {
							if (Date.now() - openedAt < 300) return;
							if (feedback?.active) {
								if (matchesKey(data, Key.escape)) feedback = undefined;
								else if (matchesKey(data, Key.enter)) return done({ value: "no", feedback: feedback.text });
								else if (matchesKey(data, Key.backspace)) feedback.text = feedback.text.slice(0, -1);
								else if (data.length === 1 && data >= " ") feedback.text += data;
								else if (data.length > 1 && !data.startsWith("\x1b")) feedback.text += sanitize(data);
								dialogTui.requestRender();
								return;
							}
							if (matchesKey(data, Key.up)) selected = (selected + values.length - 1) % values.length;
							else if (matchesKey(data, Key.down)) selected = (selected + 1) % values.length;
							else if (matchesKey(data, Key.tab)) {
								feedback = { active: true, text: "" };
								selected = values.indexOf("no");
							}
							else if (matchesKey(data, Key.shift("tab")) && values.includes("yes-session") && event.toolName !== "bash") return done({ value: "yes-session" });
							else if (matchesKey(data, Key.escape)) return done({ value: "no" });
							else if (/^[1-9]$/.test(data) && Number(data) <= values.length) return done({ value: values[Number(data) - 1]! });
							else if (matchesKey(data, Key.enter)) return done({ value: values[selected]! });
							dialogTui.requestRender();
						},
					};
				});
			}
		} finally {
			prompting--;
			requestRender();
		}
		if (answer?.value === "yes") return undefined;
		if (answer?.value === "yes-session") {
			if (event.toolName === "bash") allowCommand(permissions, String(input.command ?? ""), ctx.cwd);
			else permissions.mode = "acceptEdits";
			requestRender();
			return undefined;
		}
		if (!nested) declinedBatch = true;
		return { block: true, reason: rejectReason(answer?.feedback), terminate: true };
	});

	pi.registerCommand("cc-mode", {
		description: "Set the permission mode: default, acceptEdits, plan, bypassPermissions",
		getArgumentCompletions: (prefix: string) =>
			(["default", "acceptEdits", "plan", "bypassPermissions"] as const)
				.filter((m) => m.startsWith(prefix))
				.map((m) => ({ value: m, label: m })),
		handler: async (args, ctx) => {
			const arg = args.trim();
			const mode = (arg === "manual" ? "default" : arg) as PermissionMode;
			if (!["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode)) {
				ctx.ui.notify(`Permission mode: ${permissions.mode}`, "info");
				return;
			}
			permissions.mode = mode;
			if (mode === "bypassPermissions") permissions.bypassAvailable = true;
			requestRender();
		},
	});
}

export { isToolsExpanded };
