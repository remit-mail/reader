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

/**
 * A nested picker at the foot of the menu, for a list that belongs to the
 * account rather than to the bar — the selection bar's apply-label trigger.
 * Its own trigger is a worded row, so it reads as one of the menu's actions
 * rather than a stray glyph.
 */
/**
 * A list longer than the viewport. The panel scrolls within its own bounds, so
 * the last row is reachable on a phone instead of running off the bottom.
 */
export const ManyItems: Story = {
	args: {
		triggerLabel: "More actions",
		items: Array.from({ length: 24 }, (_, i) => ({
			key: `label-${i}`,
			label: `Label ${i + 1}`,
			icon: <Tag className="size-4" />,
			onSelect: () => undefined,
		})),
	},
};

export const WithNestedPicker: Story = {
	args: {
		triggerLabel: "More actions",
		items: [
			{
				key: "read",
				label: "Mark read",
				icon: <MailOpen className="size-4" />,
				onSelect: () => undefined,
			},
		],
		children: (
			<PopoverMenu
				triggerLabel="Apply label to selected messages"
				triggerIcon={<Tag className="size-4 text-fg-subtle" />}
				triggerText="Apply label"
				align="start"
				nested
				touch={false}
				triggerClassName="min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg"
				items={[
					{
						key: "work",
						label: "Work",
						onSelect: () => undefined,
					},
					{
						key: "receipts",
						label: "Receipts",
						onSelect: () => undefined,
					},
				]}
			/>
		),
	},
};
