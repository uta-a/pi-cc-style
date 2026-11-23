/**
 * Builds pi theme files from the Claude Code theme table, so pi's own UI (selectors, Markdown,
 * borders) uses Claude Code's colours. `node test/gen-themes.ts` writes them to theme/.
 */
import { CC_THEMES, type CCColor, type CCThemeId } from "./palette-data.ts";

export const THEME_IDS: CCThemeId[] = ["dark", "light", "dark-ansi", "light-ansi", "dark-daltonized", "light-daltonized"];

export const themeName = (id: CCThemeId) => `claude-code-${id}`;

/**
 * Syntax colours of Claude Code's highlighter (`ee`): "Monokai Extended" on dark themes, "GitHub"
 * on light themes, ANSI indices on the ANSI themes. The default foreground stays the terminal's.
 */
const SYNTAX = {
	dark: {
		syntaxComment: "#75715e",
		syntaxKeyword: "#f92672",
		syntaxFunction: "#a6e22e",
		syntaxVariable: "",
		syntaxString: "#e6db74",
		syntaxNumber: "#be84ff",
		syntaxType: "#a6e22e",
		syntaxOperator: "#f92672",
		syntaxPunctuation: "",
	},
	light: {
		syntaxComment: "#969896",
		syntaxKeyword: "#a71d5d",
		syntaxFunction: "#795da3",
		syntaxVariable: "#0086b3",
		syntaxString: "#183691",
		syntaxNumber: "#0086b3",
		syntaxType: "#0086b3",
		syntaxOperator: "#a71d5d",
		syntaxPunctuation: "",
	},
	ansi: {
		syntaxComment: 8,
		syntaxKeyword: 13,
		syntaxFunction: 11,
		syntaxVariable: "",
		syntaxString: 10,
		syntaxNumber: 12,
		syntaxType: 14,
		syntaxOperator: 13,
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
