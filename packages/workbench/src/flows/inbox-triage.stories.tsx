import { inboxId, messages } from "@remit/ui/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { InboxTriage } from "./inbox-triage.js";

const meta: Meta<typeof InboxTriage> = {
	title: "Flows/Inbox triage",
	component: InboxTriage,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof InboxTriage>;

/** Land in the inbox with nothing open — click a message to read it. */
export const Start: Story = {
	render: () => <InboxTriage startUrl={`/mailbox/${inboxId}`} />,
};

/** Deep-linked into the first message — full three-pane read state. */
export const ReadingFirst: Story = {
	render: () => (
		<InboxTriage
			startUrl={`/mailbox/${inboxId}/message/${messages[0].message.messageId}`}
		/>
	),
};
