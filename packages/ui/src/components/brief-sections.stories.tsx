import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type {
	BriefCategoryFilter,
	ThreadRowData,
	ThreadSection,
} from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import type { FilterSheetSource } from "./filter-sheet.js";
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
	},
};
export default meta;

type Story = StoryObj<typeof BriefSections>;

export const Desktop: Story = {
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSections {...args} />
		</div>
	),
};

export const Mobile: Story = {
	render: (args) => (
		<div className="flex h-[844px] w-[390px] flex-col border border-line">
			<BriefSections {...args} />
		</div>
	),
};

/**
 * (a) "All" scope: one capped section per category, each with its header. This
 * is the cross-account aggregate where the section headers earn their keep.
 */
export const AllScopeWithHeaders: Story = {
	args: { briefCategory: "all" },
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSections {...args} />
		</div>
	),
};

/**
 * (b) Single-category filter: narrowed to Newsletter, the list renders FLAT with
 * NO section header — the header would be redundant once a single category is
 * selected. This is the behavior the live brief now inherits from the kit.
 */
export const SingleCategoryFlat: Story = {
	args: { briefCategory: "newsletter" },
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSections {...args} />
		</div>
	),
};

const accountSources: FilterSheetSource[] = [
	{ id: "all", label: "All", active: true },
	{ id: "a1", label: "work", count: 3 },
	{ id: "a2", label: "personal", count: 8 },
];

/**
 * (c) Account-source filtering (n>1): the cross-account brief exposes an account
 * pill row above the categories. The row only appears with more than one source.
 * Selecting a source is single-select (encoded via each source's `active` flag).
 */
export const AccountSources: Story = {
	render: (args) => {
		const [source, setSource] = useState("all");
		const [category, setCategory] = useState<BriefCategoryFilter>("all");
		return (
			<div className="flex h-screen w-96 flex-col border-r border-line">
				<BriefSections
					{...args}
					briefCategory={category}
					onSelectBriefCategory={setCategory}
					sources={accountSources.map((s) => ({
						...s,
						active: s.id === source,
					}))}
					sourcesNote="+1 muted"
					onSelectSource={setSource}
					defaultExpanded
				/>
			</div>
		);
	},
};

/**
 * (d) Multi-select and the keyboard cursor in the brief. The rows are the same
 * `Row` the mailbox list renders, so a checked row carries the checkbox and the
 * selected tint, and the keyboard cursor shows its left accent rail on the row
 * it sits on — one row implementation across the brief, Flagged and the inbox.
 */
export const Selection: Story = {
	render: (args) => {
		const [checked, setChecked] = useState<ReadonlySet<string>>(
			new Set(["p1", "f1"]),
		);
		const toggle = (id: string) =>
			setChecked((prev) => {
				const next = new Set(prev);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
		return (
			<div className="flex h-screen w-96 flex-col border-r border-line">
				<BriefSections
					{...args}
					Row={({ thread, active, onClick }) => (
						<ComfortableRow
							thread={thread}
							active={active}
							focused={thread.id === "p1"}
							selection={{
								checked: checked.has(thread.id),
								onToggle: () => toggle(thread.id),
							}}
							onClick={onClick}
						/>
					)}
				/>
			</div>
		);
	},
};
