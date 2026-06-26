import type { Meta, StoryObj } from "@storybook/react";
import { QuotedText } from "./quoted-text.js";

const meta: Meta<typeof QuotedText> = {
	title: "Mail/QuotedText",
	component: QuotedText,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof QuotedText>;

const quotedHtml = `
	<p>Thanks for the quick turnaround on the proposal.</p>
	<p>A couple of follow-ups before Friday:</p>
	<ul>
		<li>Can we confirm the <strong>delivery window</strong>?</li>
		<li>See the earlier thread for the pricing notes:</li>
	</ul>
	<blockquote><p>The original quote stands through end of quarter.</p></blockquote>
	<p>More context on the <a href="https://example.com/brief">shared brief</a>.</p>
`;

const quotedPlainText = [
	"Thanks for the quick turnaround on the proposal.",
	"",
	"A couple of follow-ups before Friday:",
	"- Can we confirm the delivery window?",
	"- See the earlier thread for the pricing notes.",
].join("\n");

export const Collapsed: Story = {
	args: {
		text: quotedPlainText,
		html: quotedHtml,
		senderName: "Dana Whitfield",
		date: "Jun 24, 2026, 9:14 AM",
	},
};

export const ExpandedHtml: Story = {
	args: {
		text: quotedPlainText,
		html: quotedHtml,
		senderName: "Dana Whitfield",
		date: "Jun 24, 2026, 9:14 AM",
	},
	play: async ({ canvasElement }) => {
		canvasElement.querySelector("button")?.click();
	},
};

export const PlainTextOnly: Story = {
	args: {
		text: quotedPlainText,
		senderName: "Dana Whitfield",
	},
	play: async ({ canvasElement }) => {
		canvasElement.querySelector("button")?.click();
	},
};

export const NoAttribution: Story = {
	args: {
		text: quotedPlainText,
	},
};
