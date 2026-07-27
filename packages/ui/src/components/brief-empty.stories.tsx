import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { BriefEmpty } from "./brief-empty.js";

/** A list pane's width, so the copy wraps the way it does in the app. */
const paneFrame: Decorator = (Story) => (
	<div className="h-screen w-full bg-surface">
		<div className="mx-auto h-full max-w-md border-x border-line">
			<Story />
		</div>
	</div>
);

const meta: Meta<typeof BriefEmpty> = {
	title: "Screens/Kit/BriefEmpty",
	component: BriefEmpty,
	parameters: { layout: "fullscreen" },
	decorators: [paneFrame],
};
export default meta;

type Story = StoryObj<typeof BriefEmpty>;

/**
 * Nothing needs attention, and the app has everything it is going to get.
 * The only state allowed to make that claim.
 */
export const CaughtUp: Story = { args: {} };

/**
 * The first sync is still running (#452). The list is empty because the mail
 * has not arrived yet, so the brief says that instead of congratulating the
 * user on an inbox it has never seen.
 */
export const Syncing: Story = {
	args: { sync: { synced: 812, total: 4210 } },
};

/**
 * The first seconds of a sync: the server has not counted the mailbox yet, so
 * there is no fraction to show. The state still reads as in-progress rather
 * than falling back to "caught up".
 */
export const SyncingCountUnknown: Story = {
	args: { sync: { synced: 0, total: 0 } },
};

/** Phone width (411 px) — the copy is the whole state, so it must not clip. */
export const SyncingPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	args: { sync: { synced: 1204, total: 18960 } },
};
