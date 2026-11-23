/**
 * The turn summary (`lM` of 2.1.330): `✻ Cooked for 1m 5s`, glyph and text faint, after every
 * turn that completes. The verb is picked by hashing the message id (`Wy`).
 */
import { clampLines, formatDuration, TEARDROP, turnVerb } from "./format.ts";
import type { Palette } from "./palette.ts";
import { MODE_INFO, modePill, type PermissionMode } from "./permissions.ts";

export const TURN_ENTRY = "cc-style-turn";

export interface TurnEntryData {
	id: string;
	durationMs: number;
	/** When the turn ended (ms since the epoch); older entries have none. */
	endedAt?: number;
}

/** The locale of LC_ALL / LC_TIME / LANG (`ja_JP.UTF-8` → `ja-JP`), as Claude Code reads it. */
function timeLocale(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const raw = env.LC_ALL || env.LC_TIME || env.LANG;
	const tag = raw?.split(".")[0]?.replace(/_/g, "-");
	if (!tag || tag === "C" || tag === "POSIX") return undefined;
	try {
		return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 ? tag : undefined;
	} catch {
		return undefined;
	}
}

/** The `done` time: the time of day today, with the weekday within a week, else with the date. */
export function formatDoneTime(at: number, now = Date.now(), locale = timeLocale()): string {
	const when = new Date(at);
	const today = new Date(now);
	const sameDay = when.toDateString() === today.toDateString();
	const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
	const options: Intl.DateTimeFormatOptions = sameDay
		? time
		: now - at < 7 * 24 * 60 * 60 * 1000
			? { weekday: "short", ...time }
			: { month: "short", day: "numeric", ...time };
	return new Intl.DateTimeFormat(locale, options).format(when);
}

/** The summary row (`lM`): `✻ Cooked for 1m 5s · done 3:04 PM`, all faint; pi adds the blank line above. */
export function renderTurnSummary(p: Palette, data: TurnEntryData, now = Date.now()): string[] {
	const done = data.endedAt !== undefined ? ` · done ${formatDoneTime(data.endedAt, now)}` : "";
	return [`${p.dim(TEARDROP)} ${p.dim(`${turnVerb(data.id)} for ${formatDuration(data.durationMs)}${done}`)}`];
}

/**
 * The row under the prompt (`jRe`): the mode pill when the mode is not manual, then a faint
 * italic hint — "esc to interrupt" while working, "shift+tab to cycle" next to a pill — or
 * "? for shortcuts" when there is nothing else.
 */
export function renderPromptFooter(p: Palette, mode: PermissionMode, busy: boolean, width = Infinity): string {
	const items: string[] = [];
	if (mode !== "default") items.push(modePill(p, mode));
	if (busy) items.push(p.style("esc to interrupt", { dim: true, italic: true }));
	else if (mode !== "default") items.push(p.style("shift+tab to cycle", { dim: true, italic: true }));
	if (items.length === 0) items.push(p.dim("? for shortcuts"));
	const line = `  ${items.join(p.dim(" · "))}`;
	return Number.isFinite(width) ? clampLines([line], width)[0]! : line;
}

export { MODE_INFO };
