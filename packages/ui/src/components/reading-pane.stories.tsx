import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadData } from "./app-shell-types.js";
import { ReadingPane } from "./reading-pane.js";

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "msg-1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "Yesterday, 14:02",
			snippet: "Here's where we landed after the call…",
			bodyHtml:
				"<p>Here's where we landed after the call. The roadmap stands.</p>",
		},
		{
			id: "msg-2",
			fromName: "Jamie Chen",
			fromEmail: "jamie@example.com",
			toLabel: "Alex Rivera, you",
			dateLabel: "Today, 09:11",
			snippet: "Thanks — I'll circulate the deck this afternoon.",
			bodyHtml:
				"<p>Thanks for the summary. I'll circulate the deck this afternoon and follow up with finance.</p><ul><li>Confirm headcount</li><li>Lock the budget</li></ul>",
			expanded: true,
		},
	],
};

// A designed (framed) newsletter so the Screens story exercises the REAL
// renderer — sanitized + sandboxed iframe, flush layout, #727 scale-to-fit —
// rather than a plain inline paragraph (#940). The fixed 600px table is the
// kind of markup that overflowed a phone before #727.
const newsletterThread: ThreadData = {
	subject: "Node Weekly — Issue 540",
	messages: [
		{
			id: "nl-1",
			fromName: "Node Weekly",
			fromEmail: "news@nodeweekly.example",
			toLabel: "you",
			dateLabel: "Today, 08:00",
			snippet: "Node.js 24 hits LTS, and more…",
			framed: true,
			expanded: true,
			bodyHtml: `<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
	<tr><td width="600" style="width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
		<h1 style="margin:0;font-size:26px;">Node Weekly</h1>
		<p style="margin:4px 0 0;font-size:14px;">Issue 540</p>
	</td></tr>
	<tr><td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
		<h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
		<p>The permission model graduated from experimental and the test runner picked up snapshot testing.</p>
		<p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
	</td></tr>
</table>`,
		},
	],
};

const meta: Meta<typeof ReadingPane> = {
	title: "Screens/Kit/ReadingPane",
	component: ReadingPane,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<div className="h-screen border border-line">
			<ReadingPane {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof ReadingPane>;

export const WithThread: Story = { args: { thread } };

/** A designed newsletter rendered through the real sanitize → sandboxed-iframe
 *  pipeline — the same rendering the live app shows (#940). */
export const Newsletter: Story = { args: { thread: newsletterThread } };

export const Empty: Story = { args: { thread: undefined } };

export const WithIntelligenceToggle: Story = {
	args: { thread, showIntelligenceToggle: true, intelligenceOpen: false },
};
