import { AppShell } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	briefChips,
	briefSections,
	briefSectionsLong,
	briefUnseen,
	navAccounts,
	workId,
} from "../fixtures/workspace.js";

const meta: Meta<typeof AppShell> = {
	title: "Flows/DailyBrief",
	component: AppShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

/**
 * The unified brief across accounts, grouped by attention: VIP/known
 * unread first, then flagged, then everything else. Account chips
 * segment; the muted hobby account is excluded but keeps syncing
 * ("+1 muted").
 */
export const Default: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSections()}
		/>
	),
};

/**
 * Brief with collapsible sections and a composable filter chip bar (Unread ·
 * Has attachment · From contacts · Today). The padded "Everything else" section
 * starts collapsed; chips stack additively to narrow the visible threads.
 */
export const Filtered: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={briefSectionsLong()}
			briefFilters
		/>
	),
};

/** Account chip applied: every section filtered to the work account. */
export const WorkOnly: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta="Work only"
			chips={briefChips(workId)}
			mutedNote="+1 muted"
			sections={briefSections(workId)}
		/>
	),
};

/** Nothing needs attention — the brief says so and stays out of the way. */
export const CaughtUp: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={0}
			listTitle="Daily brief"
			listMeta="You're caught up"
			chips={briefChips()}
			mutedNote="+1 muted"
			sections={[]}
		/>
	),
};
