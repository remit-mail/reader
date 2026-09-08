import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
	AccountServiceOffBadge,
	AccountServiceOffNotice,
} from "./account-service-status.js";

/**
 * How a switched-off service reads on the surfaces that hold what it left
 * behind (#1179): a label wherever the account is listed, and a notice over the
 * stored rows themselves.
 */
const meta: Meta = {
	title: "Components/AccountServiceStatus",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** The label an account carries in a list, a picker or the sidebar. */
export const Badges: Story = {
	render: () => (
		<div className="flex flex-col items-start gap-2">
			<AccountServiceOffBadge service="Mail" />
			<AccountServiceOffBadge service="Calendar" />
		</div>
	),
};

/**
 * Over a mail-disabled account's stored mailboxes. It says what is there before
 * it says what stopped — an empty-looking mailbox is the failure this exists to
 * prevent.
 */
export const MailNotice: Story = {
	render: () => (
		<AccountServiceOffNotice service="Mail" onEnable={() => undefined} />
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("status")).toHaveTextContent(
			"Everything already synced is here to read",
		);
		await expect(
			canvas.getByRole("button", { name: "Turn mail back on" }),
		).toBeVisible();
	},
};

/** Over a paused provider calendar. Its events stay drawn on the grid. */
export const CalendarNotice: Story = {
	render: () => (
		<AccountServiceOffNotice service="Calendar" onEnable={() => undefined} />
	),
};

/** No way back on from here — the notice is a statement, never a dead button. */
export const NoticeWithoutAction: Story = {
	render: () => <AccountServiceOffNotice service="Mail" />,
};
