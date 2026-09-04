import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	type BriefFilterId,
	narrowBriefSections,
} from "../lib/brief-filters.js";
import type {
	BriefCategoryFilter,
	ThreadRowData,
	ThreadSection,
} from "./app-shell-types.js";
import {
	type BriefFilterControl,
	BriefSections,
	type BriefSectionsProps,
} from "./brief-sections.js";
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

const newsletterSection: ThreadSection = {
	id: "newsletter",
	label: "Newsletter",
	threads: Array.from({ length: 14 }, (_, i) => newsletterRow(i + 1)),
};

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
	newsletterSection,
];

const countedNewsletter: ThreadSection = {
	id: "newsletter",
	label: "Newsletter",
	threads: Array.from({ length: 10 }, (_, i) => newsletterRow(i + 1)),
	total: { kind: "exact", value: 2295 },
};

/**
 * The live shape: each section is its own category-scoped query, so its header
 * carries that category's real size and its rows are the newest page of it.
 */
const countedSections: ThreadSection[] = [
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
		total: { kind: "exact", value: 4753 },
	},
	countedNewsletter,
	{
		id: "social",
		label: "Social",
		threads: [],
		total: { kind: "exact", value: 88 },
		loading: true,
	},
	{
		id: "marketing",
		label: "Marketing",
		threads: [],
		error: true,
	},
	{
		id: "uncategorized",
		label: "Unclassified",
		threads: [],
		total: { kind: "exact", value: 12 },
	},
];

type BriefHostProps = Omit<
	BriefSectionsProps,
	keyof BriefFilterControl | "onSelectBriefCategory"
>;

/**
 * The host these stories need, because `BriefSections` has stopped being one.
 * The list draws the chips and the category pills and applies neither; the
 * answer comes from whoever holds the rows — the server in the app, this
 * component over its fixtures here (#314). Without it a chip would tick and the
 * list would not move.
 */
function BriefHost({
	sections,
	briefCategory: scope = "all",
	...rest
}: BriefHostProps) {
	const [filters, setFilters] = useState<ReadonlySet<BriefFilterId>>(new Set());
	const [category, setCategory] = useState<BriefCategoryFilter>(scope);
	return (
		<BriefSections
			{...rest}
			sections={narrowBriefSections(sections, category, filters)}
			briefCategory={category}
			onSelectBriefCategory={setCategory}
			activeFilters={filters}
			onToggleFilter={(id) =>
				setFilters((prev) => {
					const next = new Set(prev);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				})
			}
			onClearFilters={() => {
				setCategory("all");
				setFilters(new Set());
			}}
		/>
	);
}

const meta: Meta<typeof BriefHost> = {
	title: "Screens/Kit/BriefSections",
	component: BriefHost,
	parameters: { layout: "fullscreen" },
	args: {
		sections,
		Row: ComfortableRow,
		briefCategory: "all",
		onSelectThread: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof BriefHost>;

export const Desktop: Story = {
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefHost {...args} />
		</div>
	),
};

export const Mobile: Story = {
	render: (args) => (
		<div className="flex h-[844px] w-[390px] flex-col border border-line">
			<BriefHost {...args} />
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
			<BriefHost {...args} />
		</div>
	),
};

/**
 * (b) Single-category scope over uncounted sections: narrowed to Newsletter, the
 * list renders FLAT with NO section header — with nothing but the label to state,
 * the header only repeats the chip. The scope is one category-scoped request, so
 * the section handed in is the only one there is.
 */
export const SingleCategoryFlat: Story = {
	args: { sections: [newsletterSection], briefCategory: "newsletter" },
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefHost {...args} />
		</div>
	),
};

/**
 * (b2) The live brief: each header carries its category's real size, a section
 * whose rows have not arrived shows the loading treatment under its total, a
 * section whose own request failed says so and offers its own retry, and a
 * section a chip emptied says so too. "Show all" hands the reader to that
 * category's own list rather than fetching more rows here.
 */
export const ServerTotals: Story = {
	args: {
		sections: countedSections,
		briefCategory: "all",
		onShowAllSection: () => undefined,
		onRetrySection: () => undefined,
	},
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefHost {...args} />
		</div>
	),
};

/**
 * (b3) The "show all" destination: narrowed to one counted category, the header
 * stays, because the total is the one thing the chip cannot state.
 */
export const SingleCategoryCounted: Story = {
	args: { sections: [countedNewsletter], briefCategory: "newsletter" },
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefHost {...args} />
		</div>
	),
};

/**
 * (b4) The brief answering a search: no sections at all, one list in the order
 * the server returned it. A newsletter from last spring under a header would
 * outrank a mail from this morning, which is the reading a search must not give.
 */
export const Searching: Story = {
	args: {
		sections: [
			{
				id: "matches",
				threads: [
					{
						id: "m1",
						accountId: "a1",
						fromName: "CI",
						fromEmail: "ci@build.example",
						subject: "Your build passed",
						snippet: "All checks green on main.",
						timeLabel: "8:02",
						isRead: false,
						category: "automated",
					},
					{
						id: "m2",
						accountId: "a1",
						fromName: "Digest",
						fromEmail: "digest@news.example",
						subject: "Weekly digest for you",
						snippet: "Stories you might have missed.",
						timeLabel: "Mar 4",
						isRead: true,
						category: "newsletter",
					},
				],
			},
		],
		briefCategory: "all",
		flat: true,
	},
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefHost {...args} />
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
		return (
			<div className="flex h-screen w-96 flex-col border-r border-line">
				<BriefHost
					{...args}
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
				<BriefHost
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
