import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { account, inboxId, mailboxes, messages } from "../fixtures/index.js";
import { MailboxScreen } from "./mailbox-screen.js";

const meta: Meta<typeof MailboxScreen> = {
	title: "Screens/Mailbox (three-pane)",
	component: MailboxScreen,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof MailboxScreen>;

function StatefulMailbox() {
	const [mailbox, setMailbox] = useState(inboxId);
	const [message, setMessage] = useState<string | undefined>(
		messages[0]?.message.messageId,
	);
	return (
		<MailboxScreen
			accountEmail={account.email}
			mailboxes={mailboxes}
			messages={messages}
			selectedMailboxId={mailbox}
			selectedMessageId={message}
			onSelectMailbox={setMailbox}
			onSelectMessage={(id) => setMessage(id || undefined)}
		/>
	);
}

/** Default: message pre-selected so the reading pane is populated. */
export const Default: Story = {
	render: () => <StatefulMailbox />,
};

/** Empty reading pane — nothing selected yet. */
export const NothingSelected: Story = {
	render: () => (
		<MailboxScreen
			accountEmail={account.email}
			mailboxes={mailboxes}
			messages={messages}
			selectedMailboxId={inboxId}
		/>
	),
};
