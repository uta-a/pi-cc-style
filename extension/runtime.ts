/**
 * State shared by the prototype patches, which run outside any extension context: the current
 * UI (for its theme), the extension settings, and whether tool output is expanded.
 */
import { Palette, type ThemeInfo } from "./palette.ts";

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
	if (typeof source.permissionMode === "string" && (MODES as readonly string[]).includes(source.permissionMode)) {
		out.permissionMode = source.permissionMode as StyleSettings["permissionMode"];
	}
	return out;
}

interface UiLike {
	readonly theme: ThemeInfo;
}

let ui: UiLike | undefined;
let settings: StyleSettings = { ...DEFAULT_SETTINGS };
let toolsExpanded = false;
let cachedPalette: { theme: ThemeInfo | undefined; palette: Palette } | undefined;

export function setUi(next: UiLike | undefined) {
	ui = next;
}

export function setSettings(next: StyleSettings) {
	settings = next;
}

export function getSettings(): StyleSettings {
	return settings;
}

export function setToolsExpanded(expanded: boolean) {
	toolsExpanded = expanded;
}

export function isToolsExpanded(): boolean {
	return toolsExpanded;
}

/** The Claude Code palette for the active pi theme. */
export function palette(): Palette {
	let theme: ThemeInfo | undefined;
	try {
		theme = ui?.theme;
	} catch {
		theme = undefined;
	}
	if (cachedPalette && cachedPalette.theme === theme) return cachedPalette.palette;
	const next = Palette.for(theme);
	cachedPalette = { theme, palette: next };
	return next;
}
