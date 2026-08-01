import type { Meta, StoryObj } from "@storybook/react-vite";
import { flaggedThreads } from "../fixtures/workspace.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * Flagged — the virtual mailbox reintroduced in #982. A FLAT, cross-account
 * inbox of starred mail: no category sections, no account chip bar, just one
 * continuous list of every flagged thread. "Flagged" is the active nav item,
 * directly under "Daily brief".
 */
const meta: Meta = {
	title: "Flows/Flagged",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const flaggedSection = [{ id: "flagged", threads: flaggedThreads }];
const flaggedUnread = flaggedThreads.filter((t) => !t.isRead).length;

/**
 * Starred mail across every account in one flat list. Rows span the personal
 * and work accounts — the star is the only thing they share. Flat, like a plain
 * inbox, never the sectioned brief.
 */
export const Default: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={flaggedUnread}
			sections={flaggedSection}
		/>
	),
};

/** Phone width (390 px): the same flat starred list, single-pane. */
export const Phone: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			width={PHONE_WIDTH}
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={flaggedUnread}
			sections={flaggedSection}
		/>
	),
};

/** Nothing flagged yet — the empty state stands in for the rows. */
export const Empty: Story = {
	render: () => (
		<MailShell
			selectedNavId="flagged"
			listTitle="Starred"
			unreadCount={0}
			sections={[]}
			listState="empty"
		/>
	),
};
