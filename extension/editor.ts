/**
 * Claude Code's prompt box (`jpt` / `pbn` of 2.1.330): a round border drawn only above and below
 * the input in `promptBorder` (`bashBorder` in shell mode), `❯` + NBSP before the first line,
 * the continuation indented under it, and the `Try "…"` example while the session is empty.
 *
 * The box wraps whatever editor is installed (pi's own or another extension's), so features of
 * that editor stay; only the frame and the gutter change.
 */
import { CURSOR_MARKER, renderFakeCursor, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { NBSP, POINTER } from "./format.ts";
import type { Palette } from "./palette.ts";

export const GUTTER = 2;
const PATCHED = Symbol.for("pi-cc-style.editor");
const OPTIONS = Symbol.for("pi-cc-style.editor.options");

/** `─` across the width, with pi's scroll hint when lines are hidden. */
export function promptBorder(p: Palette, width: number, color: string, hidden: number, arrow: "↑" | "↓"): string {
	if (hidden <= 0 || width < 12) return p.fg(color, "─".repeat(Math.max(0, width)));
	const label = ` ${arrow} ${hidden} more `;
	const left = Math.max(1, Math.floor((width - visibleWidth(label)) / 2));
	const right = Math.max(0, width - left - visibleWidth(label));
	return p.fg(color, `${"─".repeat(left)}${label}${"─".repeat(right)}`);
}

/** `pbn` / `A`: the gutter of the first line, faint only while a turn runs (`dimColor: isLoading`). */
export function promptPointer(p: Palette, shell: boolean, busy = false): string {
	const text = shell ? p.fg("bashBorder", `!${NBSP}`) : `${POINTER}${NBSP}`;
	return busy ? p.dim(text) : text;
}

/** The placeholder line: the cursor on the first letter, the rest faint. */
export function placeholderLine(p: Palette, text: string, width: number, focused: boolean): string {
	const room = Math.max(1, width);
	const clipped = truncateToWidth(text, room, "");
	const [first = " ", ...rest] = Array.from(clipped);
	const head = focused ? `${CURSOR_MARKER}${renderFakeCursor(first)}` : p.dim(first);
	return head + p.dim(rest.join(""));
}

/** Reads the "↑ 3 more" count pi puts in a border. */
function hiddenCount(border: string | undefined, arrow: string): number {
	if (!border) return 0;
	const m = new RegExp(`${arrow} (\\d+) more`).exec(stripTerminalSequences(border));
	return m ? Number(m[1]) : 0;
}

interface EditorLike {
	render(width: number): string[];
	getText(): string;
	paddingX?: number;
	renderedVisibleLineCount?: number;
	focused?: boolean;
	handleMouse?(event: { x: number; y: number; width: number; height: number; [key: string]: unknown }): unknown;
	[PATCHED]?: boolean;
	[OPTIONS]?: PromptOptions;
}

export interface PromptOptions {
	palette: () => Palette;
	enabled: () => boolean;
	/** The `Try "…"` text to show while the input is empty, or undefined. */
	placeholder: () => string | undefined;
	/** A turn is running. */
	busy?: () => boolean;
}

/** Wraps an editor instance in Claude Code's prompt box. */
export function decorateEditor<T extends object>(editor: T, options: PromptOptions): T {
	const target = editor as unknown as EditorLike;
	target[OPTIONS] = options;
	if (target[PATCHED]) return editor;
	target[PATCHED] = true;
	const originalRender = target.render.bind(target);
	const originalMouse = target.handleMouse?.bind(target);

	target.render = (width: number) => {
		const current = target[OPTIONS]!;
		if (!current.enabled() || width < GUTTER + 4) return originalRender(width);
		const p = current.palette();
		if (typeof target.paddingX === "number") target.paddingX = 0;
		const inner = originalRender(width - GUTTER);
		const text = target.getText();
		const shell = text.startsWith("!");
		const color = shell ? "bashBorder" : "promptBorder";
		const visible = typeof target.renderedVisibleLineCount === "number" ? target.renderedVisibleLineCount : Math.max(1, inner.length - 2);
		const above = hiddenCount(inner[0], "\u2191");
		const content = inner.slice(1, 1 + visible);
		const hiddenBelow = hiddenCount(inner[1 + visible], "\u2193");
		const below = inner.slice(1 + visible + 1);
		const out = [promptBorder(p, width, color, above, "↑")];
		const placeholder = text.length === 0 ? current.placeholder() : undefined;
		content.forEach((line, i) => {
			const gutter = i === 0 && above === 0 ? promptPointer(p, shell, current.busy?.() ?? false) : " ".repeat(GUTTER);
			const body = placeholder !== undefined && i === 0 ? placeholderLine(p, placeholder, width - GUTTER, target.focused !== false) : line;
			out.push(gutter + body);
		});
		out.push(promptBorder(p, width, color, hiddenBelow, "↓"));
		for (const line of below) out.push(" ".repeat(GUTTER) + line);
		return out;
	};

	if (originalMouse) {
		target.handleMouse = (event) => {
			if (!target[OPTIONS]!.enabled()) return originalMouse(event);
			return originalMouse({ ...event, x: Math.max(0, event.x - GUTTER), width: Math.max(1, event.width - GUTTER) });
		};
	}
	return editor;
}
