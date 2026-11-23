/**
 * The turn summary (`lM` of 2.1.330): `✻ Cooked for 1m 5s`, glyph and text faint, after every
 * turn that completes. The verb is picked by hashing the message id (`Wy`).
 */
import { formatDuration, TEARDROP, turnVerb } from "./format.ts";
import type { Palette } from "./palette.ts";
import { MODE_INFO, modePill, type PermissionMode } from "./permissions.ts";

export const TURN_ENTRY = "cc-style-turn";

export interface TurnEntryData {
	id: string;
	durationMs: number;
}

/** The summary row; pi puts the blank line above custom entries itself. */
export function renderTurnSummary(p: Palette, data: TurnEntryData): string[] {
	return [`${p.dim(TEARDROP)} ${p.dim(`${turnVerb(data.id)} for ${formatDuration(data.durationMs)}`)}`];
}

/**
 * The row under the prompt (`jRe`): the mode pill when the mode is not manual, then a faint
 * italic hint — "esc to interrupt" while working, "shift+tab to cycle" next to a pill — or
 * "? for shortcuts" when there is nothing else.
 */
export function renderPromptFooter(p: Palette, mode: PermissionMode, busy: boolean): string {
	const items: string[] = [];
	if (mode !== "default") items.push(modePill(p, mode));
	if (busy) items.push(p.style("esc to interrupt", { dim: true, italic: true }));
	else if (mode !== "default") items.push(p.style("shift+tab to cycle", { dim: true, italic: true }));
	if (items.length === 0) items.push(p.dim("? for shortcuts"));
	return `  ${items.join(p.dim(" · "))}`;
}

export { MODE_INFO };
