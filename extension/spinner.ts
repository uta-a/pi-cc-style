/**
 * Claude Code's spinner row (`Iya` / `De` / `Omt` / `i7n` of 2.1.330):
 *
 *   ✶ Pondering… (12s · ↓ 1.2k tokens · thinking)
 *
 * - The glyph eases through · ✢ ✳ ✶ ✻ ✽ and back over two seconds, in `claude`.
 * - The verb is picked once per turn and shown with "…". A three-column glimmer in
 *   `claudeShimmer` sweeps it: left to right every 50 ms while the request waits, right to left
 *   every 200 ms otherwise. While tools run the whole verb pulses between the two colours.
 * - After ten seconds without a token the colour slides towards `error`; after ten seconds of
 *   thinking towards `warning` (and the glyph turns bold past half way).
 * - The faint parenthesis shows the elapsed time, the output tokens (characters / 4, ↑ while
 *   waiting, ↓ while streaming) and the thinking state, each only when it fits.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { ARROW_DOWN, ARROW_UP, ELLIPSIS, SPINNER_VERBS, formatDuration, formatNumber, spinnerFrames } from "./format.ts";
import { cosineEase, mixRGB, type Palette, quantize, type RGB } from "./palette.ts";

export type SpinnerMode = "requesting" | "responding" | "thinking" | "tool-use";

/** `On`: the thinking label by how long the current burst lasts. */
export function thinkingLabel(ms: number): string {
	if (ms >= 45000) return "deep in thought";
	if (ms >= 30000) return "thinking some more";
	if (ms >= 20000) return "thinking more";
	if (ms >= 10000) return "still thinking";
	return "thinking";
}

/** `Ln`. */
export function thoughtFor(ms: number): string {
	return `thought for ${Math.max(1, Math.round(ms / 1000))}s`;
}

export class SpinnerState {
	active = false;
	verb = "Working";
	mode: SpinnerMode = "requesting";
	startedAt = 0;
	/** Characters received in this turn; tokens are shown as a quarter of it. */
	responseLength = 0;
	lastTokenAt = 0;
	activeTools = 0;
	thinkingStartedAt: number | undefined;
	/** The last finished thinking burst and when it may be shown ("thought for Ns"). */
	thought: { ms: number; showFrom: number; showUntil: number } | undefined;
	/** A message replacing the verb, e.g. while compacting. */
	overrideMessage: string | undefined;

	start(now: number, random: () => number = Math.random, verbs: string[] = SPINNER_VERBS) {
		this.active = true;
		this.verb = verbs[Math.floor(random() * verbs.length)] ?? "Working";
		this.mode = "requesting";
		this.startedAt = now;
		this.responseLength = 0;
		this.lastTokenAt = now;
		this.activeTools = 0;
		this.thinkingStartedAt = undefined;
		this.thought = undefined;
		this.overrideMessage = undefined;
	}

	stop() {
		this.active = false;
	}

	private endThinking(now: number) {
		if (this.thinkingStartedAt === undefined) return;
		const ms = now - this.thinkingStartedAt;
		this.thinkingStartedAt = undefined;
		// `Oya`: the result shows once the label has been up for two seconds, then for two seconds.
		const showFrom = now + Math.max(0, 2000 - ms);
		this.thought = { ms, showFrom, showUntil: showFrom + 2000 };
	}

	/** A streamed delta of the assistant message. */
	delta(kind: "text" | "thinking" | "toolcall", length: number, now: number) {
		this.responseLength += length;
		this.lastTokenAt = now;
		if (kind === "thinking") {
			if (this.thinkingStartedAt === undefined) this.thinkingStartedAt = now;
			if (this.activeTools === 0) this.mode = "thinking";
		} else {
			this.endThinking(now);
			if (this.activeTools === 0) this.mode = "responding";
		}
	}

	/** A new model request starts (a turn or the follow-up after tools). */
	request(now: number) {
		this.endThinking(now);
		if (this.activeTools === 0) this.mode = "requesting";
		this.lastTokenAt = now;
	}

	toolStart(now: number) {
		this.endThinking(now);
		this.activeTools++;
		this.mode = "tool-use";
	}

	toolEnd(now: number) {
		this.activeTools = Math.max(0, this.activeTools - 1);
		if (this.activeTools === 0) {
			this.mode = "requesting";
			this.lastTokenAt = now;
		}
	}
}

interface Intensities {
	stalled: number;
	thinking: number;
}

function intensities(state: SpinnerState, now: number): Intensities {
	const waitingOnTools = state.mode === "tool-use" || state.mode === "thinking";
	const sinceToken = waitingOnTools ? 0 : now - state.lastTokenAt;
	const stalled = sinceToken > 10000 ? Math.min((sinceToken - 10000) / 10000, 1) : 0;
	let thinking = 0;
	if (state.mode === "thinking" && state.thinkingStartedAt !== undefined && state.activeTools === 0) {
		thinking = Math.min(Math.max((now - state.thinkingStartedAt - 10000) / 10000, 0), 1);
	}
	return { stalled, thinking };
}

/** `tt`: the message colour moved towards `to` by an intensity. */
function blendKey(p: Palette, from: string, to: string, intensity: number): string | RGB {
	return p.blend(from, to, intensity);
}

/** `$n`: the thinking label pulses between `inactive` and `inactiveShimmer` after three seconds. */
function thinkingColor(p: Palette, elapsed: number, intensity: number): string | RGB | undefined {
	const a = p.rgb("inactive");
	const b = p.rgb("inactiveShimmer");
	const w = p.rgb("warning");
	if (!a || !b || !w) return intensity > 0.5 ? "warning" : undefined;
	const phase = elapsed < 3000 ? 0 : (Math.sin(((elapsed - 3000) / 1000) * Math.PI * 2 / 2) + 1) / 2;
	const base = mixRGB(a, b, quantize(phase));
	return intensity > 0 ? mixRGB(base, w, quantize(intensity)) : base;
}

export interface SpinnerRender {
	now: number;
	width: number;
	frames?: string[];
	/** Color of the verb and glyph; Claude Code uses `claude` for the main loop. */
	messageColor?: string;
	shimmerColor?: string;
}

/** The spinner row, or nothing when idle. Includes the blank line above it (`marginTop: 1`). */
export function renderSpinner(p: Palette, state: SpinnerState, options: SpinnerRender): string[] {
	if (!state.active) return [];
	const { now, width } = options;
	const t = now - state.startedAt;
	const frames = options.frames ?? spinnerFrames();
	const messageColor = options.messageColor ?? "claude";
	const shimmerColor = options.shimmerColor ?? "claudeShimmer";
	const { stalled, thinking } = intensities(state, now);

	// Glyph (`Omt`).
	const frameIndex = Math.round(cosineEase(t, 2000) * (frames.length - 1));
	const glyphColor = stalled > 0 ? blendKey(p, messageColor, "error", stalled) : thinking > 0 ? blendKey(p, messageColor, "warning", thinking) : messageColor;
	const glyph = p.style(frames[frameIndex] ?? frames[0]!, { color: glyphColor, bold: stalled === 0 && thinking >= 0.5 });

	// Message with glimmer (`i7n`).
	const message = `${state.overrideMessage ?? state.verb}${state.overrideMessage ? "" : ELLIPSIS}`;
	const chars = Array.from(message);
	const messageWidth = visibleWidth(message);
	let text: string;
	const override = stalled > 0 ? blendKey(p, messageColor, "error", stalled) : thinking > 0 ? blendKey(p, messageColor, "warning", thinking) : undefined;
	if (override !== undefined) {
		text = p.fg(override, message);
	} else if (state.mode === "tool-use") {
		const flash = quantize((Math.sin((t / 1000) * Math.PI) + 1) / 2);
		text = p.fg(blendKey(p, messageColor, shimmerColor, flash), message);
	} else {
		const step = state.mode === "requesting" ? 50 : 200;
		const cycle = messageWidth + 20;
		const tick = Math.floor(t / step);
		const index = state.mode === "requesting" ? (tick % cycle) - 10 : messageWidth + 10 - (tick % cycle);
		const lo = index - 1;
		const hi = index + 1;
		if (lo >= messageWidth || hi < 0) {
			text = p.fg(messageColor, message);
		} else {
			let before = "";
			let glow = "";
			let after = "";
			let col = 0;
			for (const ch of chars) {
				const w = visibleWidth(ch);
				if (col + w <= Math.max(0, lo)) before += ch;
				else if (col > hi) after += ch;
				else glow += ch;
				col += w;
			}
			text = p.fg(messageColor, before) + p.fg(shimmerColor, glow) + p.fg(messageColor, after);
		}
	}

	// Parenthesis (`Iya`).
	const sep = " · ";
	const elapsedText = formatDuration(t);
	const tokens = Math.round(state.responseLength / 4);
	const tokensText = `${state.mode === "requesting" ? ARROW_UP : ARROW_DOWN} ${formatNumber(tokens)} tokens`;
	let thinkingText: string | undefined;
	let thinkingKind: "thinking" | "thought" | undefined;
	if (state.mode === "thinking" && state.thinkingStartedAt !== undefined && state.activeTools === 0) {
		thinkingText = thinkingLabel(now - state.thinkingStartedAt);
		thinkingKind = "thinking";
	} else if (state.thought && now >= state.thought.showFrom && now < state.thought.showUntil) {
		thinkingText = thoughtFor(state.thought.ms);
		thinkingKind = "thought";
	}
	const hasThinking = thinkingText !== undefined;
	const showAny = hasThinking || tokens > 0 || t > 16000;
	const room = width - (messageWidth + 2) - 5;
	let showThinking = hasThinking && room > visibleWidth(thinkingText ?? "");
	if (!showThinking && hasThinking && thinkingKind === "thinking" && room > visibleWidth("thinking")) {
		thinkingText = "thinking";
		showThinking = true;
	}
	const used1 = showThinking ? visibleWidth(thinkingText!) + visibleWidth(sep) : 0;
	const showElapsed = showAny && room > used1 + visibleWidth(elapsedText);
	const used2 = used1 + (showElapsed ? visibleWidth(elapsedText) + visibleWidth(sep) : 0);
	const showTokens = showAny && tokens > 0 && room > used2 + visibleWidth(tokensText);
	const thinkingOnly = showThinking && thinkingKind === "thinking" && !showElapsed && !showTokens;
	const items: string[] = [];
	if (showElapsed) items.push(p.dim(elapsedText));
	if (showTokens) items.push(p.dim(tokensText));
	if (showThinking && thinkingText) {
		if (thinkingKind === "thinking") {
			const color = thinkingColor(p, now - (state.thinkingStartedAt ?? now), thinking);
			const label = thinkingOnly ? `(${thinkingText})` : thinkingText;
			items.push(color ? p.fg(color, label) : p.dim(label));
		} else {
			items.push(thinking > 0 ? p.fg("warning", thinkingText) : p.dim(thinkingText));
		}
	}
	let suffix = "";
	if (items.length > 0) {
		suffix = thinkingOnly ? items.join(p.dim(sep)) : `${p.dim("(")}${items.join(p.dim(sep))}${p.dim(")")}`;
	}
	const line = `${glyph} ${text} ${suffix}`.trimEnd();
	return ["", line];
}
