import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadSection } from "./app-shell-types.js";
import { TouchListBody } from "./touch-list.js";

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm? I have a conflict in the morning.",
				timeLabel: "8:15",
				isRead: false,
				messageCount: 3,
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Re: Q3 planning notes",
				snippet: "Sounds good — pushed the deck to the shared drive.",
				timeLabel: "9:42",
				isRead: true,
			},
			{
				id: "t3",
				accountId: "a1",
				fromName: "Dana Lopez",
				fromEmail: "dana@example.com",
				subject: "Invoice for May",
				snippet: "Please find the attached invoice, due end of month.",
				timeLabel: "Wed",
				isRead: true,
				hasAttachment: true,
			},
		],
	},
];

const meta: Meta<typeof TouchListBody> = {
	title: "Screens/Kit/TouchListBody",
	component: TouchListBody,
	parameters: { layout: "padded" },
	args: {
		sections,
		selectionMode: false,
		checkedIds: new Set<string>(),
		refreshing: false,
		onToggleCheck: () => undefined,
		onEnterSelection: () => undefined,
		onOpenThread: () => undefined,
		onRefresh: () => undefined,
	},
	render: (args) => (
		<div className="flex h-[700px] w-[390px] flex-col rounded-md border border-line">
			<TouchListBody {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof TouchListBody>;

export const Default: Story = {};

export const Refreshing: Story = { args: { refreshing: true } };

export const SelectionMode: Story = {
	args: { selectionMode: true, checkedIds: new Set(["t1", "t3"]) },
};

/** Every row checked — the ceiling a select-all control drives toward. */
export const SelectionModeAllChecked: Story = {
	args: {
		selectionMode: true,
		checkedIds: new Set(
			sections.flatMap((section) => section.threads.map((t) => t.id)),
		),
	},
};

/**
 * Selection mode with nothing checked. `TouchListBody` itself has no floor —
 * the auto-exit-at-zero contract belongs to the caller (`MessageListPane`,
 * production `MessageList.tsx`), which this component doesn't own.
 */
export const SelectionModeNoneChecked: Story = {
	args: { selectionMode: true, checkedIds: new Set<string>() },
};
