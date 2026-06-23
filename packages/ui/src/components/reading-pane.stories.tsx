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

export const Empty: Story = { args: { thread: undefined } };

export const WithIntelligenceToggle: Story = {
	args: { thread, showIntelligenceToggle: true, intelligenceOpen: false },
};
