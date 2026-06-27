import type { Meta, StoryObj } from "@storybook/react";
import { Mail, MailOpen, Tag } from "lucide-react";
import { PopoverMenu } from "./popover-menu.js";

const meta: Meta<typeof PopoverMenu> = {
	title: "Kit/PopoverMenu",
	component: PopoverMenu,
	parameters: { layout: "centered" },
	render: (args) => (
		<div className="flex h-64 w-72 items-start justify-end p-4">
			<PopoverMenu {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof PopoverMenu>;

export const Default: Story = {
	args: {
		triggerLabel: "More actions",
		items: [
			{
				key: "read",
				label: "Mark as read",
				icon: <MailOpen className="size-4" />,
				onSelect: () => undefined,
			},
			{
				key: "label",
				label: "Add label",
				icon: <Tag className="size-4" />,
				onSelect: () => undefined,
			},
		],
	},
};

export const SingleItem: Story = {
	args: {
		triggerLabel: "More actions",
		items: [
			{
				key: "unread",
				label: "Mark as unread",
				icon: <Mail className="size-4" />,
				onSelect: () => undefined,
			},
		],
	},
};

/** With no items the kebab is dead weight, so it renders nothing rather than a
 *  disabled control. */
export const Empty: Story = {
	args: { triggerLabel: "More actions", items: [] },
};
