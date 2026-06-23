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
		summary: "DKIM signature aligns with the sending domain.",
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
