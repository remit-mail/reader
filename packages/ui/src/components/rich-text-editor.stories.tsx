import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, userEvent } from "storybook/test";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
import { ComposeLanguageChip } from "./compose-language-chip.js";
import {
	type ComposeBodyMode,
	ComposeModeToggle,
} from "./compose-mode-toggle.js";
import { RichTextEditor } from "./rich-text-editor.js";

/**
 * The frame is the compose body region at its real geometry — a column with a
 * height of its own — so the editor is shown claiming the space a composer
 * gives it rather than only the space its own text needs.
 */
const meta: Meta<typeof RichTextEditor> = {
	title: "Mail/RichTextEditor",
	component: RichTextEditor,
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

type Story = StoryObj<typeof RichTextEditor>;

const RICH_DOCUMENT = [
	"<h2>Quarterly numbers</h2>",
	"<p>Highlights <strong>this quarter</strong>, with the detail below.</p>",
	"<ul><li>Revenue up 14%</li><li>Costs flat</li></ul>",
	"<table><thead><tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr>",
	"<tr><td>Americas</td><td>388</td></tr></tbody></table>",
	'<p>Source: <a href="https://example.com/report">the full report</a>.</p>',
].join("");

/**
 * What a web page actually puts on the clipboard: presentation on every
 * element, a tracking pixel, a script, and Word's conditional markup.
 */
const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	"<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->",
	"<style>.hdr{color:#c00}</style>",
	'<h3 class="hdr" style="color:#c00;font-family:Verdana">Release checklist</h3>',
	'<ol><li style="margin:0">Cut the tag</li><li>Publish the images</li></ol>',
	'<table style="border:2px dashed #c00"><tbody>',
	"<tr><th>Step</th><th>Owner</th></tr>",
	"<tr><td>Tag</td><td>Ada</td></tr></tbody></table>",
	'<img src="http://tracker.example/px.gif" width="1" height="1">',
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

export const Empty: Story = {
	name: "Empty",
	args: {},
};

export const RichContent: Story = {
	name: "Rich content with a table",
	args: { initialHtml: RICH_DOCUMENT },
};

/**
 * The document after that clipboard has gone through the paste profile: the
 * heading, the list and the table survive; the styling, the pixel and the
 * script do not.
 */
export const PasteResult: Story = {
	name: "After pasting a web page",
	args: { initialHtml: sanitizeAdoptedHtml(CLIPBOARD_HTML) },
};

/**
 * A short message leaves most of the body region empty. That region belongs to
 * the document: the point far below the last line is the editable, and a click
 * there lands in it.
 */
export const ClickBelowTheText: Story = {
	name: "Clicking below the last line",
	args: { initialHtml: "<p>Sounds good. See you at 12:30.</p>" },
	play: async ({ canvasElement }) => {
		const area = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const editable = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!area || !editable) throw new Error("the editor is not mounted");

		const box = area.getBoundingClientRect();
		const underTheText = document.elementFromPoint(
			box.left + box.width / 2,
			Math.min(box.bottom - 12, window.innerHeight - 2),
		);
		await expect(editable.contains(underTheText)).toBe(true);

		await userEvent.click(editable);
		await expect(editable).toHaveFocus();
	},
};

/**
 * The two pinned controls, in the order compose ships them: the chip first, so
 * one Shift+Tab out of the body still reaches the mode toggle and two reach the
 * chip. Both hold their own state here — the editor knows nothing about either,
 * and a pinned control that did not answer a press would read as a broken
 * toolbar rather than a layout story.
 */
const PinnedControls = () => {
	const [language, setLanguage] = useState("nl");
	const [mode, setMode] = useState<ComposeBodyMode>("rich");
	return (
		<>
			<ComposeLanguageChip
				language={language}
				languages={["nl", "en", "de"]}
				onSelect={setLanguage}
			/>
			<ComposeModeToggle
				mode={mode}
				onToggle={() => setMode(mode === "plain" ? "rich" : "plain")}
			/>
		</>
	);
};

const pinnedControls = <PinnedControls />;

/** The toolbar as compose ships it: the formatting cluster, then the two pinned controls. */
export const ToolbarInRich: Story = {
	name: "Toolbar with the language chip and the mode toggle",
	args: { initialHtml: RICH_DOCUMENT, lang: "nl", trailing: pinnedControls },
};

/**
 * At 390 the formatting cluster runs out of room. It scrolls inside its own
 * strip and both pinned controls stay at the right edge, rather than the
 * cluster pushing them off the screen — which is what a flex child without
 * `min-w-0` does. Two letters is what makes room for a second pinned item here.
 */
export const NarrowToolbar: Story = {
	name: "Toolbar at 390",
	args: { initialHtml: RICH_DOCUMENT, lang: "nl", trailing: pinnedControls },
	decorators: [
		(Story) => (
			<div
				data-testid="body-area"
				className="flex h-[420px] w-[390px] flex-col overflow-auto rounded-md border border-line bg-canvas"
			>
				<Story />
			</div>
		),
	],
	play: async ({ canvasElement }) => {
		const frame = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const cluster = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-format-cluster]",
		);
		const toggle = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-mode-toggle]",
		);
		const chip = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-language-chip]",
		);
		if (!frame || !cluster || !toggle || !chip)
			throw new Error("the toolbar is not mounted");

		await expect(cluster.scrollWidth).toBeGreaterThan(cluster.clientWidth);
		const edge = frame.getBoundingClientRect().right + 1;
		await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(
			edge,
		);
		await expect(chip.getBoundingClientRect().left).toBeGreaterThanOrEqual(
			frame.getBoundingClientRect().left,
		);
		await expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
	},
};

/**
 * The toolbar and the body share one scroller, so twenty lines of typing would
 * carry the toolbar off the top with them. It stays at the top of the body
 * while the text moves under it.
 */
export const StickyToolbar: Story = {
	name: "Toolbar over a scrolled body",
	args: {
		initialHtml: `${RICH_DOCUMENT}${"<p>Another line of the message.</p>".repeat(30)}`,
		lang: "nl",
		trailing: pinnedControls,
	},
	play: async ({ canvasElement }) => {
		const frame = canvasElement.querySelector<HTMLElement>(
			"[data-testid=body-area]",
		);
		const toggle = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-mode-toggle]",
		);
		if (!frame || !toggle) throw new Error("the toolbar is not mounted");

		frame.scrollTop = 400;
		await expect(frame.scrollTop).toBeGreaterThan(0);
		await expect(
			toggle.getBoundingClientRect().top - frame.getBoundingClientRect().top,
		).toBeLessThan(60);
	},
};
