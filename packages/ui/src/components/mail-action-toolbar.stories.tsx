import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { MailActionToolbar } from "./mail-action-toolbar.js";

const meta: Meta<typeof MailActionToolbar> = {
	title: "Kit/MailActionToolbar",
	component: MailActionToolbar,
	parameters: { layout: "centered" },
	decorators: [
		((Story) => (
			<div
				className="overflow-hidden rounded-lg border border-line"
				style={{ width: 720 }}
			>
				<Story />
			</div>
		)) satisfies Decorator,
	],
	args: {
		hasThread: true,
		onReply: () => undefined,
		onReplyAll: () => undefined,
		onForward: () => undefined,
		onDelete: () => undefined,
		onMove: () => undefined,
		onToggleStar: () => undefined,
		onUnavailable: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof MailActionToolbar>;

/** The conversation has answered and the open message is not starred. */
export const Default: Story = { args: { isStarred: false } };

/** The open message is starred: the star is lit and reads as pressed. It
 *  follows the conversation, not the list row that opened it (#602). */
export const Starred: Story = { args: { isStarred: true } };

/** The conversation has not answered yet, so the star state is unknown. The
 *  button omits `aria-pressed` rather than announcing "not pressed" for a
 *  message that may well be starred. */
export const StarUnknown: Story = { args: { isStarred: undefined } };

/** The mobile pane's management bar already owns triage, so the toolbar drops
 *  the cluster instead of offering a second set of the same accessible names. */
export const WithoutTriage: Story = { args: { showTriage: false } };

/** No message open: the verbs no-op and the bar surfaces a one-line reason
 *  instead of disabling. */
export const NoMessageOpen: Story = {
	args: {
		hasThread: false,
		unavailableHint: "Open a message first",
	},
};
