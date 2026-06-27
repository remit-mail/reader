import { AppShell } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { flaggedThreads, navAccounts } from "../fixtures/workspace.js";

/**
 * Flagged — the virtual mailbox reintroduced in #982. A FLAT, cross-account
 * inbox of starred mail: no category sections, no account chip bar, just one
 * continuous list of every flagged thread. "Flagged" is the active nav item,
 * directly under "Daily brief".
 */
const meta: Meta<typeof AppShell> = {
	title: "Flows/Flagged",
	component: AppShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

const flaggedSection = [{ id: "flagged", threads: flaggedThreads }];
const flaggedUnread = flaggedThreads.filter((t) => !t.isRead).length;

/**
 * Starred mail across every account in one flat list. Rows span the personal
 * and work accounts — the star is the only thing they share. Flat, like a plain
 * inbox, never the sectioned brief.
 */
export const Default: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="flagged"
			listTitle="Flagged"
			listMeta={`${flaggedUnread} unread`}
			sections={flaggedSection}
			flatList
		/>
	),
};

/** Phone width (390 px): the same flat starred list, single-pane. */
export const Phone: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: () => (
		<AppShell
			accounts={navAccounts}
			initialWidth={390}
			selectedNavId="flagged"
			listTitle="Flagged"
			listMeta={`${flaggedUnread} unread`}
			sections={flaggedSection}
			flatList
		/>
	),
};

/** Nothing flagged yet — the empty state stands in for the rows. */
export const Empty: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="flagged"
			listTitle="Flagged"
			sections={[]}
			flatList
			listState="empty"
		/>
	),
};
