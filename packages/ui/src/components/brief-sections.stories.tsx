import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadRowData, ThreadSection } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { ComfortableRow } from "./message-row.js";

function newsletterRow(i: number): ThreadRowData {
	return {
		id: `n${i}`,
		accountId: "a1",
		fromName: `Digest ${i}`,
		fromEmail: `digest${i}@news.example`,
		subject: `This week, edition ${i}`,
		snippet: "Stories you might have missed.",
		timeLabel: "Thu",
		isRead: true,
		category: "newsletter",
	};
}

const sections: ThreadSection[] = [
	{
		id: "flagged",
		label: "Flagged",
		threads: [
			{
				id: "f1",
				accountId: "a1",
				fromName: "Dana Lopez",
				fromEmail: "dana@example.com",
				subject: "Offsite logistics",
				snippet: "Final headcount for the venue.",
				timeLabel: "Tue",
				isRead: false,
				starred: true,
				category: "personal",
			},
		],
	},
	{
		id: "personal",
		label: "Personal",
		threads: [
			{
				id: "p1",
				accountId: "a1",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm? I have a conflict.",
				timeLabel: "8:15",
				isRead: false,
				category: "personal",
			},
		],
	},
	{
		id: "transactional",
		label: "Transactional",
		threads: [
			{
				id: "x1",
				accountId: "a1",
				fromName: "Sam Okafor",
				fromEmail: "sam@example.com",
				subject: "Contract signed",
				snippet: "Attaching the countersigned PDF.",
				timeLabel: "9:01",
				isRead: false,
				hasAttachment: true,
				category: "transactional",
			},
		],
	},
	{
		id: "newsletter",
		label: "Newsletter",
		threads: Array.from({ length: 14 }, (_, i) => newsletterRow(i + 1)),
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
