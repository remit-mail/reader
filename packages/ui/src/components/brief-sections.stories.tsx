import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadSection } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { ComfortableRow } from "./message-row.js";

const sections: ThreadSection[] = [
	{
		id: "attention",
		label: "Needs attention",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm? I have a conflict.",
				timeLabel: "8:15",
				isRead: false,
				trust: "vip",
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Sam Okafor",
				fromEmail: "sam@example.com",
				subject: "Contract signed",
				snippet: "Attaching the countersigned PDF.",
				timeLabel: "9:01",
				isRead: false,
				category: "transactional",
			},
		],
	},
	{
		id: "rest",
		label: "Everything else",
		threads: [
			{
				id: "t3",
				accountId: "a1",
				fromName: "The Weekly Brief",
				fromEmail: "hello@weekly.example",
				subject: "This week in product",
				snippet: "Five stories you might have missed.",
				timeLabel: "Thu",
				isRead: true,
				category: "newsletter",
			},
			{
				id: "t4",
				accountId: "a1",
				fromName: "Dana Lopez",
				fromEmail: "dana@example.com",
				subject: "Invoice for May",
				snippet: "Please find the attached invoice.",
				timeLabel: "Wed",
				isRead: true,
				hasAttachment: true,
				category: "transactional",
			},
		],
	},
];

const meta: Meta<typeof BriefSections> = {
	title: "Screens/Kit/BriefSections",
	component: BriefSections,
	parameters: { layout: "fullscreen" },
	args: {
		sections,
		Row: ComfortableRow,
		briefCategory: "all",
		onSelectThread: () => undefined,
		onSelectBriefCategory: () => undefined,
		onSelectAccountChip: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof BriefSections>;

export const Desktop: Story = {
	args: { isDesktop: true },
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSections {...args} />
		</div>
	),
};

export const Mobile: Story = {
	args: { isDesktop: false },
	render: (args) => (
		<div className="flex h-[844px] w-[390px] flex-col border border-line">
			<BriefSections {...args} />
		</div>
	),
};
