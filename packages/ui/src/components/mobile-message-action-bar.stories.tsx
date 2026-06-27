import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { FolderInput } from "lucide-react";
import { Button } from "./button.js";
import { MobileMessageActionBar } from "./mobile-message-action-bar.js";

const moveSlot = (
	<Button
		variant="ghost"
		size="sm"
		icon={<FolderInput className="size-5" />}
		aria-label="Move to folder"
		title="Move to folder"
		className="min-h-11 min-w-11 px-0"
	/>
);

const meta: Meta<typeof MobileMessageActionBar> = {
	title: "Kit/MobileMessageActionBar",
	component: MobileMessageActionBar,
	parameters: { layout: "centered" },
	decorators: [
		((Story) => (
			<div
				className="overflow-hidden rounded-lg border border-line"
				style={{ width: 390 }}
			>
				<Story />
			</div>
		)) satisfies Decorator,
	],
	args: {
		hasThread: true,
		moveSlot,
		onReply: () => undefined,
		onReplyAll: () => undefined,
		onForward: () => undefined,
		onToggleStar: () => undefined,
		onDelete: () => undefined,
		onToggleRead: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof MobileMessageActionBar>;

export const Default: Story = {};

export const Starred: Story = { args: { isStarred: true } };

/** No message open: the verbs no-op and the bar surfaces a one-line reason
 *  instead of disabling. */
export const NoMessageOpen: Story = {
	args: {
		hasThread: false,
		unavailableHint: "Open a message first",
	},
};
