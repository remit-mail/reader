import type { Decorator, Meta, StoryObj } from "@storybook/react";
import type { ThreadData } from "./app-shell-types.js";
import type { IntelligenceData } from "./intelligence-panel.js";
import { MobileMessagePane } from "./mobile-message-pane.js";

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "m1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "9:42",
			snippet: "Here are the notes from today's planning session.",
			bodyHtml:
				"<p>Here are the notes from today's planning session. Let me know if anything is off.</p>",
			expanded: true,
		},
	],
};

const intelligence: IntelligenceData = {
	sender: {
		name: "Alex Rivera",
		email: "alex@example.com",
		trust: "wellknown",
		firstSeenLabel: "Jan 2025",
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "example.com",
		summary: "We verified this message was really sent by example.com.",
	},
	category: { value: "Personal" },
	similar: [],
};

const meta: Meta<typeof MobileMessagePane> = {
	title: "Screens/Kit/MobileMessagePane",
	component: MobileMessagePane,
	parameters: { layout: "centered" },
	decorators: [
		((Story) => (
			<div
				className="overflow-hidden rounded-lg border border-line"
				style={{ width: 390, height: 844 }}
			>
				<Story />
			</div>
		)) satisfies Decorator,
	],
};
export default meta;

type Story = StoryObj<typeof MobileMessagePane>;

export const Default: Story = {
	args: { thread, onBack: () => undefined },
};

export const WithIntelligence: Story = {
	args: { thread, intelligence, onBack: () => undefined },
};

// A fixed-width (600px) newsletter on the phone pane: the REAL renderer
// sandboxes it and scales it to fit (#727) instead of overflowing — the same
// rendering the live app shows (#940).
const newsletterThread: ThreadData = {
	subject: "Node Weekly — Issue 540",
	messages: [
		{
			id: "nl-1",
			fromName: "Node Weekly",
			fromEmail: "news@nodeweekly.example",
			toLabel: "you",
			dateLabel: "08:00",
			snippet: "Node.js 24 hits LTS, and more…",
			framed: true,
			expanded: true,
			bodyHtml: `<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
	<tr><td width="600" style="width:600px;min-width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
		<h1 style="margin:0;font-size:26px;">Node Weekly</h1>
		<p style="margin:4px 0 0;font-size:14px;">Issue 540</p>
	</td></tr>
	<tr><td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
		<h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
		<p>The permission model graduated from experimental and the test runner picked up snapshot testing.</p>
	</td></tr>
</table>`,
		},
	],
};

export const Newsletter: Story = {
	args: { thread: newsletterThread, onBack: () => undefined },
};
