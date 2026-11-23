/**
 * State shared by the prototype patches, which run outside any extension context: the current
 * UI (for its theme), the extension settings, and whether tool output is expanded.
 */
import { Palette, type ThemeInfo, themeIdFor } from "./palette.ts";

export interface StyleSettings {
	/** Product name in the startup header. */
	headerTitle: string;
	/** Draw the startup header. */
	header: boolean;
	/** Replace the working indicator with Claude Code's spinner. */
	spinner: boolean;
	/** Show "✻ Worked for 12s" after each turn (Claude Code's `showTurnDuration`). */
	turnDuration: boolean;
	/** Claude Code's prompt box. */
	prompt: boolean;
	/** Claude Code's tool rows. */
	tools: boolean;
	/** Claude Code's message rendering (⏺, ❯, ∴, interrupts). */
	messages: boolean;
	/** shift+tab cycles the permission mode (it then no longer cycles pi's thinking level). */
	modeCycle: boolean;
	/** Initial permission mode. pi itself asks for nothing, which is bypassPermissions. */
	permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
}

export const DEFAULT_SETTINGS: StyleSettings = {
	headerTitle: "Pi",
	header: true,
	spinner: true,
	turnDuration: true,
	prompt: true,
	tools: true,
	messages: true,
	modeCycle: true,
	permissionMode: "bypassPermissions",
};

const MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;

/** Reads the `ccStyle` object of pi's settings; invalid values fall back to the defaults. */
export function readSettings(raw: unknown): StyleSettings {
	const out = { ...DEFAULT_SETTINGS };
	if (!raw || typeof raw !== "object") return out;
	const source = raw as Record<string, unknown>;
	for (const key of ["header", "spinner", "turnDuration", "prompt", "tools", "messages", "modeCycle"] as const) {
		if (typeof source[key] === "boolean") out[key] = source[key];
	}
	if (typeof source.headerTitle === "string" && source.headerTitle.trim()) out.headerTitle = source.headerTitle;
	if (source.permissionMode !== undefined) {
		const mode = source.permissionMode === "manual" ? "default" : source.permissionMode;
		// A misspelt mode falls back to manual, not to bypass: a typo must not turn the prompts off.
		out.permissionMode = typeof mode === "string" && (MODES as readonly string[]).includes(mode) ? (mode as StyleSettings["permissionMode"]) : "default";
	}
	return out;
}

/** What `readSettings` had to correct, for a notice at startup. */
export function settingsProblems(raw: unknown): string[] {
	if (!raw || typeof raw !== "object") return [];
	const mode = (raw as Record<string, unknown>).permissionMode;
	if (mode === undefined || mode === "manual" || (MODES as readonly unknown[]).includes(mode)) return [];
	return [`ccStyle.permissionMode ${JSON.stringify(mode)} is not one of ${MODES.join(", ")}; using default (manual).`];
}

interface UiLike {
	readonly theme: ThemeInfo;
}

/**
 * The state lives on globalThis: `/reload` loads a fresh copy of this module, but the prototype
 * patches installed by the first copy stay, and they must see the settings and theme the new copy
 * sets.
 */
interface RuntimeState {
	ui: UiLike | undefined;
	settings: StyleSettings;
	toolsExpanded: boolean;
	palettes: Map<string, Palette>;
}

const STATE = Symbol.for("pi-cc-style.runtime");
const globalState = globalThis as { [STATE]?: RuntimeState };
const state: RuntimeState = (globalState[STATE] ??= {
	ui: undefined,
	settings: { ...DEFAULT_SETTINGS },
	toolsExpanded: false,
	palettes: new Map(),
});

export function setUi(next: UiLike | undefined) {
	state.ui = next;
}

export function setSettings(next: StyleSettings) {
	state.settings = next;
}

export function getSettings(): StyleSettings {
	return state.settings;
}

export function setToolsExpanded(expanded: boolean) {
	state.toolsExpanded = expanded;
}

export function isToolsExpanded(): boolean {
	return state.toolsExpanded;
}

/**
 * The Claude Code palette for the active pi theme. pi's theme object keeps its identity when the
 * theme changes, so the palette is keyed by the variant and colour mode it resolves to.
 */
export function palette(): Palette {
	let theme: ThemeInfo | undefined;
	let mode = "truecolor";
	try {
		theme = state.ui?.theme;
		mode = theme?.getColorMode?.() ?? "truecolor";
	} catch {
		theme = undefined;
	}
	const key = `${themeIdFor(theme)}|${mode}`;
	let cached = state.palettes.get(key);
	if (!cached) {
		cached = Palette.for(theme);
		state.palettes.set(key, cached);
	}
	return cached;
}
