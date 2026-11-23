/**
 * Claude Code colours as ANSI escapes.
 *
 * Claude Code paints every element with a key of its own theme table (claude, inactive,
 * promptBorder, diffAdded, ...). pi's theme tokens cannot carry those keys, so the extension
 * keeps the table itself and picks the variant that matches the active pi theme.
 */
import { CC_THEMES, type CCColor, type CCThemeId } from "./palette-data.ts";

export { CC_THEMES, type CCColor, type CCThemeId };

export type ColorMode = "truecolor" | "256color";

export interface RGB {
	r: number;
	g: number;
	b: number;
}

/** The subset of pi's Theme the palette reads. */
export interface ThemeInfo {
	readonly name?: string;
	readonly appearance?: "dark" | "light";
	getColorMode?(): ColorMode;
}

/** Picks the Claude Code variant for a pi theme: by its name when it is one of ours, else by appearance. */
export function themeIdFor(theme: ThemeInfo | undefined): CCThemeId {
	const name = theme?.name ?? "";
	const match = /^claude-code-(dark|light)(-ansi|-daltonized)?$/.exec(name);
	if (match) return `${match[1]}${match[2] ?? ""}` as CCThemeId;
	return theme?.appearance === "light" ? "light" : "dark";
}

export function parseHex(hex: string): RGB | undefined {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return undefined;
	return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) };
}

export function toHex({ r, g, b }: RGB): string {
	return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Claude Code's `$D`: linear interpolation per channel, rounded. */
export function mixRGB(a: RGB, b: RGB, t: number): RGB {
	return {
		r: Math.round(a.r + (b.r - a.r) * t),
		g: Math.round(a.g + (b.g - a.g) * t),
		b: Math.round(a.b + (b.b - a.b) * t),
	};
}

/** Claude Code's `Wse`: quantises an intensity to eighths so colours change in visible steps. */
export function quantize(t: number): number {
	return Math.round(t * 8) / 8;
}

/** Claude Code's `PIt`: a cosine ease that goes 0 → 1 → 0 over one period. */
export function cosineEase(time: number, period: number): number {
	return (1 - Math.cos((2 * Math.PI * time) / period)) / 2;
}

const CUBE = [0, 95, 135, 175, 215, 255];

function nearestCube(v: number): number {
	let best = 0;
	for (let i = 1; i < CUBE.length; i++) if (Math.abs(CUBE[i]! - v) < Math.abs(CUBE[best]! - v)) best = i;
	return best;
}

/** Nearest xterm-256 index for a colour (cube or grey ramp). */
export function rgbTo256({ r, g, b }: RGB): number {
	const ri = nearestCube(r);
	const gi = nearestCube(g);
	const bi = nearestCube(b);
	const cube = 16 + 36 * ri + 6 * gi + bi;
	const cubeErr = (CUBE[ri]! - r) ** 2 + (CUBE[gi]! - g) ** 2 + (CUBE[bi]! - b) ** 2;
	const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
	const gv = 8 + grey * 10;
	const greyErr = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
	return greyErr < cubeErr ? 232 + grey : cube;
}

function ansiIndexCode(index: number, background: boolean): string {
	if (index < 8) return String((background ? 40 : 30) + index);
	return String((background ? 100 : 90) + index - 8);
}

/** SGR parameters for a colour, foreground or background. */
export function colorCode(color: CCColor | RGB, background: boolean, mode: ColorMode): string {
	if (typeof color === "number") return ansiIndexCode(color, background);
	const rgb = typeof color === "string" ? parseHex(color) : color;
	if (!rgb) return background ? "49" : "39";
	if (mode === "truecolor") return `${background ? 48 : 38};2;${rgb.r};${rgb.g};${rgb.b}`;
	return `${background ? 48 : 38};5;${rgbTo256(rgb)}`;
}

export interface StyleOptions {
	color?: string | RGB;
	backgroundColor?: string | RGB;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	strikethrough?: boolean;
	inverse?: boolean;
}

/**
 * The Claude Code palette for one theme variant. `color` names are keys of the Claude Code table
 * (claude, inactive, subtle, ...); a raw `{r,g,b}` is also accepted for interpolated colours.
 */
export class Palette {
	readonly id: CCThemeId;
	readonly mode: ColorMode;
	readonly colors: Record<string, CCColor>;

	constructor(id: CCThemeId = "dark", mode: ColorMode = "truecolor") {
		this.id = id;
		this.mode = mode;
		this.colors = CC_THEMES[id];
	}

	static for(theme: ThemeInfo | undefined): Palette {
		let mode: ColorMode = "truecolor";
		try {
			mode = theme?.getColorMode?.() ?? "truecolor";
		} catch {
			// Theme without colour mode: assume truecolor.
		}
		return new Palette(themeIdFor(theme), mode);
	}

	/** The colour's RGB value, when it has one (the ANSI themes use palette indices instead). */
	rgb(key: string): RGB | undefined {
		const value = this.colors[key];
		return typeof value === "string" ? parseHex(value) : undefined;
	}

	private resolve(color: string | RGB): CCColor | RGB | undefined {
		if (typeof color !== "string") return color;
		if (color in this.colors) return this.colors[color];
		if (color.startsWith("#")) return color;
		return undefined;
	}

	style(text: string, options: StyleOptions): string {
		if (text.length === 0) return text;
		const open: string[] = [];
		const close: string[] = [];
		if (options.bold) {
			open.push("1");
			close.push("22");
		}
		if (options.dim) {
			open.push("2");
			if (!options.bold) close.push("22");
		}
		if (options.italic) {
			open.push("3");
			close.push("23");
		}
		if (options.strikethrough) {
			open.push("9");
			close.push("29");
		}
		if (options.inverse) {
			open.push("7");
			close.push("27");
		}
		if (options.color !== undefined) {
			const c = this.resolve(options.color);
			if (c !== undefined) {
				open.push(colorCode(c, false, this.mode));
				close.push("39");
			}
		}
		if (options.backgroundColor !== undefined) {
			const c = this.resolve(options.backgroundColor);
			if (c !== undefined) {
				open.push(colorCode(c, true, this.mode));
				close.push("49");
			}
		}
		if (open.length === 0) return text;
		return `\x1b[${open.join(";")}m${text}\x1b[${close.join(";")}m`;
	}

	fg(color: string | RGB, text: string): string {
		return this.style(text, { color });
	}

	bg(color: string | RGB, text: string): string {
		return this.style(text, { backgroundColor: color });
	}

	/** Ink's `dimColor`: the faint attribute, in the text's own colour. */
	dim(text: string): string {
		return this.style(text, { dim: true });
	}

	bold(text: string): string {
		return this.style(text, { bold: true });
	}

	/**
	 * Claude Code's `tt`: a colour between two theme keys at a quantised intensity; for the ANSI
	 * themes, which have no RGB, it switches over at one half.
	 */
	blend(from: string, to: string, intensity: number): string | RGB {
		const a = this.rgb(from);
		const b = this.rgb(to);
		if (a && b) return mixRGB(a, b, quantize(intensity));
		return intensity > 0.5 ? to : from;
	}
}
