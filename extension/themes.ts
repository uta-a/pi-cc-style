/**
 * Builds pi theme files from the Claude Code theme table, so pi's own UI (selectors, Markdown,
 * borders) uses Claude Code's colours. `node test/gen-themes.ts` writes them to theme/.
 */
import { CC_THEMES, type CCColor, type CCThemeId } from "./palette-data.ts";

export const THEME_IDS: CCThemeId[] = ["dark", "light", "dark-ansi", "light-ansi", "dark-daltonized", "light-daltonized"];

export const themeName = (id: CCThemeId) => `claude-code-${id}`;

/** Syntax colours: Claude Code highlights with its native diff/highlight module; these follow its VS Code-like defaults. */
const SYNTAX = {
	dark: {
		syntaxComment: "#6a9955",
		syntaxKeyword: "#569cd6",
		syntaxFunction: "#dcdcaa",
		syntaxVariable: "#9cdcfe",
		syntaxString: "#ce9178",
		syntaxNumber: "#b5cea8",
		syntaxType: "#4ec9b0",
		syntaxOperator: "#d4d4d4",
		syntaxPunctuation: "#d4d4d4",
	},
	light: {
		syntaxComment: "#008000",
		syntaxKeyword: "#0000ff",
		syntaxFunction: "#795e26",
		syntaxVariable: "#001080",
		syntaxString: "#a31515",
		syntaxNumber: "#098658",
		syntaxType: "#267f99",
		syntaxOperator: "#000000",
		syntaxPunctuation: "#000000",
	},
	ansi: {
		syntaxComment: 8,
		syntaxKeyword: 12,
		syntaxFunction: 11,
		syntaxVariable: 14,
		syntaxString: 9,
		syntaxNumber: 10,
		syntaxType: 6,
		syntaxOperator: "",
		syntaxPunctuation: "",
	},
} as const;

const EXPORT = {
	dark: { pageBg: "#1e1e1e", cardBg: "#373737", infoBg: "#413c41" },
	light: { pageBg: "#ffffff", cardBg: "#f0f0f0", infoBg: "#faf5fa" },
} as const;

export interface PiThemeFile {
	$schema: string;
	name: string;
	appearance: "dark" | "light";
	vars: Record<string, CCColor>;
	colors: Record<string, CCColor>;
	export: Record<string, string>;
}

export function buildTheme(id: CCThemeId): PiThemeFile {
	const cc = CC_THEMES[id];
	const appearance = id.startsWith("light") ? "light" : "dark";
	const ansi = id.endsWith("-ansi");
	const vars: Record<string, CCColor> = {};
	for (const key of [
		"claude",
		"claudeShimmer",
		"permission",
		"suggestion",
		"promptBorder",
		"bashBorder",
		"planMode",
		"autoAccept",
		"inactive",
		"subtle",
		"text",
		"success",
		"error",
		"warning",
		"diffAddedWord",
		"diffRemovedWord",
		"userMessageBackground",
		"bashMessageBackgroundColor",
		"selectionBg",
	]) {
		vars[key] = cc[key]!;
	}
	const colors: Record<string, CCColor> = {
		accent: "suggestion",
		border: "promptBorder",
		borderAccent: "claude",
		borderMuted: "subtle",
		success: "success",
		error: "error",
		warning: "warning",
		muted: "inactive",
		dim: "inactive",
		text: "",
		thinkingText: "inactive",
		selectedBg: "selectionBg",
		scrollbarTrack: "subtle",
		scrollbarThumb: "inactive",
		searchMatchBg: "selectionBg",
		searchMatchText: "",
		userMessageBg: "userMessageBackground",
		userMessageText: "",
		customMessageBg: "userMessageBackground",
		customMessageText: "",
		customMessageLabel: "claude",
		toolPendingBg: "bashMessageBackgroundColor",
		toolSuccessBg: "bashMessageBackgroundColor",
		toolErrorBg: "bashMessageBackgroundColor",
		toolTitle: "",
		toolOutput: "inactive",
		mdHeading: "",
		mdLink: "suggestion",
		mdLinkUrl: "inactive",
		mdCode: "permission",
		mdCodeBlock: "",
		mdCodeBlockBorder: "subtle",
		mdQuote: "inactive",
		mdQuoteBorder: "subtle",
		mdHr: "subtle",
		mdListBullet: "",
		toolDiffAdded: "diffAddedWord",
		toolDiffRemoved: "diffRemovedWord",
		toolDiffContext: "inactive",
		...(ansi ? SYNTAX.ansi : SYNTAX[appearance]),
		// Claude Code's prompt border does not change with the thinking level.
		thinkingOff: "promptBorder",
		thinkingMinimal: "promptBorder",
		thinkingLow: "promptBorder",
		thinkingMedium: "promptBorder",
		thinkingHigh: "promptBorder",
		thinkingXhigh: "promptBorder",
		thinkingMax: "promptBorder",
		bashMode: "bashBorder",
	};
	return {
		$schema: "https://pi.dev/schemas/theme.schema.json",
		name: themeName(id),
		appearance,
		vars,
		colors,
		export: { ...EXPORT[appearance] },
	};
}
