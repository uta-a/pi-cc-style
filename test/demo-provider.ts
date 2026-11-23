/**
 * A scripted "demo" model for looking at the extension without an API key:
 *
 *   pi -ne -e . -e test/demo-provider.ts --provider demo --model demo-1 --no-session
 *
 * Every prompt plays the same turn: thinking, a reply, reads and searches (collapsed into one
 * row), a Bash call, an edit with a diff, a write, and a final Markdown answer. Run it in a
 * scratch directory: the edit and write change `demo.ts` and `notes.md` there.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const demo = fauxProvider({ provider: "demo", models: [{ id: "demo-1", name: "Claude Opus 5.5", reasoning: true }], tokensPerSecond: 40 });
	const script = () => [
		fauxAssistantMessage(
			[
				fauxThinking("The user wants a tour of the project. Read the file, search for its symbols, then run a command."),
				fauxText("I'll look at the project first."),
				fauxToolCall("read", { path: "demo.ts" }),
				fauxToolCall("grep", { pattern: "value", path: "." }),
				fauxToolCall("find", { pattern: "*.ts" }),
				fauxToolCall("bash", { command: "ls -la && echo one && echo two && echo three && echo four" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[
				fauxToolCall("edit", { path: "demo.ts", edits: [{ oldText: "const value = 1;", newText: "const value = 2;" }] }),
				fauxToolCall("write", { path: "notes.md", content: "# Notes\n\n- value is now 2\n" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("Done. I changed **value** to `2` and wrote notes.\n\n- edited `demo.ts`\n- created `notes.md`"),
	];
	const reset = (cwd: string) => writeFileSync(join(cwd, "demo.ts"), "const value = 1;\nconsole.log(value);\n");
	pi.on("session_start", (_event, ctx) => reset(ctx.cwd));
	pi.on("before_agent_start", (_event, ctx) => {
		reset(ctx.cwd);
		demo.setResponses(script());
	});
	pi.registerProvider(demo.provider as never);
}
