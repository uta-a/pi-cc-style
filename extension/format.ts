/**
 * Glyphs, number and time formats and word lists of Claude Code 2.1.330.
 * Each function names the minified function of the reference build it follows.
 */

/** `Fc`: the message dot. macOS draws ⏺, other platforms ●. */
export const DOT = process.platform === "darwin" ? "⏺" : "●";
/** `SD`: the turn-summary and retry glyph. */
export const TEARDROP = "✻";
/** `Lut`: the result elbow. */
export const ELBOW = "⎿";
/** `JKn`: the thinking glyph. */
export const THEREFORE = "∴";
/** `xe.pointer`. */
export const POINTER = "❯";
export const NBSP = " ";
export const ARROW_DOWN = "↓";
export const ARROW_UP = "↑";
export const ELLIPSIS = "…";
/** `HJe` / `Ngn`: the permission-mode symbols. */
export const PAUSE = "⏸";
export const FAST_FORWARD = "⏵⏵";
/** `eC`: tree glyphs. */
export const TREE = { branch: "├", last: "└", pipe: "│" } as const;
/** `xe.tick`, `xe.squareSmall`, `xe.squareSmallFilled`. */
export const TICK = "✔";
export const SQUARE = "◻";
export const SQUARE_FILLED = "◼";

/** `Wn`: the prefix of the first line of a tool result; continuation lines get the same width of spaces. */
export const RESULT_PREFIX = `  ${ELBOW} ${NBSP}`;
export const RESULT_INDENT = "     ";

/** `Cn`: 0s, 12s, 1m 5s, 1h 2m 3s, 1d 2h 3m. */
export function formatDuration(ms: number, options: { hideTrailingZeros?: boolean; mostSignificantOnly?: boolean } = {}): string {
	if (ms < 60000) {
		if (ms === 0) return "0s";
		if (ms < 1) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 1000)}s`;
	}
	let days = Math.floor(ms / 86400000);
	let hours = Math.floor((ms % 86400000) / 3600000);
	let minutes = Math.floor((ms % 3600000) / 60000);
	let seconds = Math.round((ms % 60000) / 1000);
	if (seconds === 60) {
		seconds = 0;
		minutes++;
	}
	if (minutes === 60) {
		minutes = 0;
		hours++;
	}
	if (hours === 24) {
		hours = 0;
		days++;
	}
	const hide = options.hideTrailingZeros;
	if (options.mostSignificantOnly) {
		if (days > 0) return `${days}d`;
		if (hours > 0) return `${hours}h`;
		if (minutes > 0) return `${minutes}m`;
		return `${seconds}s`;
	}
	if (days > 0) {
		if (hide && hours === 0 && minutes === 0) return `${days}d`;
		if (hide && minutes === 0) return `${days}d ${hours}h`;
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		if (hide && minutes === 0 && seconds === 0) return `${hours}h`;
		if (hide && seconds === 0) return `${hours}h ${minutes}m`;
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	if (minutes > 0) {
		if (hide && seconds === 0) return `${minutes}m`;
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

const compactOne = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 1 });
const compactAny = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** `Ec`: compact English notation in lower case; one decimal from 1000 up (1.0k, 12.3k). */
export function formatNumber(n: number): string {
	return (n >= 1000 ? compactOne : compactAny).format(n).toLowerCase();
}

/** `go`: `Ec` without a trailing `.0` (1k, 12.3k). */
export function formatTokens(n: number): string {
	return formatNumber(n).replace(".0", "");
}

/** `$y`: "… +N lines". */
export function moreLines(count: number, noun = "line"): string {
	if (count <= 0) return "";
	return `${ELLIPSIS} +${count} ${plural(count, noun)}`;
}

/** `O`: English plural by count. */
export function plural(count: number, noun: string): string {
	if (count === 1) return noun;
	if (noun.endsWith("y") && !/[aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
	if (/(s|sh|ch|x)$/.test(noun)) return `${noun}es`;
	return `${noun}s`;
}

/** `fse`: the 32-bit string hash used to pick a word per message. */
export function stringHash(text: string): number {
	let hash = 0;
	for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
	return hash;
}

/** `jy`: the past-tense verbs of the turn summary. */
export const TURN_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];

/** `Wy`: the turn-summary verb for a message id. */
export function turnVerb(id: string): string {
	return TURN_VERBS[(stringHash(id) >>> 0) % TURN_VERBS.length] ?? "Worked";
}

/** `b`: the spinner verbs. */
export const SPINNER_VERBS = [
	"Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming", "Beboppin'", "Befuddling",
	"Billowing", "Blanching", "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping", "Brewing",
	"Bunning", "Burrowing", "Calculating", "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
	"Choreographing", "Churning", "Clauding", "Coalescing", "Cogitating", "Combobulating", "Composing", "Computing",
	"Concocting", "Considering", "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
	"Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating", "Doing",
	"Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting", "Envisioning",
	"Fermenting", "Fiddle-faddling", "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing",
	"Fluttering", "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping", "Garnishing",
	"Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing", "Hashing",
	"Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising",
	"Incubating", "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kerfuffling", "Kneading",
	"Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing", "Misting",
	"Moonwalking", "Moseying", "Mulling", "Mustering", "Nebulizing", "Nesting", "Newspapering", "Noodling",
	"Nucleating", "Onioning", "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating", "Perusing",
	"Philosophizing", "Photosynthesizing", "Polishing", "Pollinating", "Pondering", "Pontificating", "Pouncing",
	"Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering", "Puzzling",
	"Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating", "Roosting", "Ruminating",
	"Sautéing", "Scampering", "Schlepping", "Scurrying", "Seasoning", "Shenaniganing", "Shimmying", "Simmering",
	"Skedaddling", "Sketching", "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning", "Sprouting",
	"Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing", "Tempering", "Thinking",
	"Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying", "Transfiguring", "Transmogrifying", "Transmuting",
	"Twisting", "Undulating", "Unfurling", "Unraveling", "Vibing", "Waddling", "Wandering", "Warping",
	"Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking", "Wibbling", "Working", "Wrangling", "Zesting",
	"Zigzagging",
];

/** `p` / `l`: spinner frames; Ghostty gets ✻ in place of ✽. */
export function spinnerFrames(term = process.env.TERM): string[] {
	if (term === "xterm-ghostty") return ["·", "✢", "✳", "✶", "✻", "✻"];
	return ["·", "✢", "✳", "✶", "✻", "✽"];
}

/** `zwa`: the empty-prompt examples. `<file>` is replaced by a file of the project when one is known. */
export const PROMPT_EXAMPLES = [
	"fix lint errors",
	"fix typecheck errors",
	"how does <file> work?",
	"refactor <file>",
	"how do I log an error?",
	"edit <file> to...",
	"write a test for <file>",
	"create a util logging.py that...",
];

/** Shortens a path below the home directory to ~/… like Claude Code's `FP`. */
export function tildify(path: string, home = process.env.HOME ?? ""): string {
	if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
	return path;
}
