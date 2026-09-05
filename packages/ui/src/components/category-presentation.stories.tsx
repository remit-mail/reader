import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { briefFilterConfig } from "../filter-presets.js";
import {
	categoryTone,
	type ThreadCategory,
	type ThreadRowData,
	type ThreadSection,
} from "./app-shell-types.js";
import { Badge } from "./badge.js";
import { BriefSection } from "./brief-section.js";
import {
	type CategoryTone,
	FilterSheet,
	type FilterSheetCategory,
} from "./filter-sheet.js";
import { ComfortableRow } from "./message-row.js";

interface CategoryPresentation {
	category: ThreadCategory;
	/** The one word every surface calls this category: chip, badge, section. */
	label: string;
	tone: CategoryTone;
	/** Place in the brief's section order, 1-based. */
	section: number;
	/** Mail of this category on the reference mailbox, for the section header. */
	total: number;
}

/**
 * The canonical presentation of every message category, in chip-row order.
 *
 * The labels are the ones the filter chips, the search tokens and the brief
 * sections already share, so a category reads the same word wherever it is
 * named — including on the row badge, which drops the separate "receipt" and
 * "notification" wording: a reader who picks the Transactional chip has to be
 * able to see that it was that chip which produced the badge.
 *
 * The tones are the row badge's, the surface the reader meets thousands of
 * times: Personal accents, Transactional reads positive, Social warns, and
 * everything else is neutral. Marketing is not a hazard and does not warn.
 *
 * The chip row leads with All and puts Unclassified straight after Personal —
 * pending classification is a named state, offered where the reader looks for
 * their own mail. The section order ends with it instead: a section for mail
 * the classifier has not reached belongs under the mail it has.
 */
const CANONICAL: readonly CategoryPresentation[] = [
	{
		category: "personal",
		label: "Personal",
		tone: "accent",
		section: 1,
		total: 4753,
	},
	{
		category: "uncategorized",
		label: "Unclassified",
		tone: "neutral",
		section: 7,
		total: 12,
	},
	{
		category: "transactional",
		label: "Transactional",
		tone: "positive",
		section: 2,
		total: 429,
	},
	{
		category: "newsletter",
		label: "Newsletter",
		tone: "neutral",
		section: 3,
		total: 2295,
	},
	{
		category: "marketing",
		label: "Marketing",
		tone: "neutral",
		section: 4,
		total: 3942,
	},
	{
		category: "social",
		label: "Social",
		tone: "warning",
		section: 5,
		total: 88,
	},
	{
		category: "automated",
		label: "Automated",
		tone: "neutral",
		section: 6,
		total: 2680,
	},
];

const SECTION_ORDER: readonly CategoryPresentation[] = [...CANONICAL].sort(
	(a, b) => a.section - b.section,
);

const emptySectionCopy = (label: string): string =>
	`No ${label} mail in this brief.`;

const chipCategories: FilterSheetCategory[] = [
	{ id: "all", label: "All", tone: "neutral" },
	...CANONICAL.map(({ category, label, tone }) => ({
		id: category,
		label,
		tone,
	})),
];

const sampleRow = (entry: CategoryPresentation): ThreadRowData => ({
	id: `row-${entry.category}`,
	accountId: "a1",
	fromName: `${entry.label} sender`,
	fromEmail: `${entry.category}@example.com`,
	subject: `A ${entry.label.toLowerCase()} message`,
	snippet: "A short preview of the message body.",
	timeLabel: "9:42",
	isRead: true,
	category: entry.category,
});

const orderedSections: ThreadSection[] = SECTION_ORDER.map((entry) => ({
	id: entry.category,
	label: entry.label,
	threads: [sampleRow(entry)],
}));

const emptiedSections: ThreadSection[] = SECTION_ORDER.map((entry) => ({
	id: entry.category,
	label: entry.label,
	threads: [],
	total: { kind: "exact", value: entry.total },
}));

const meta: Meta = {
	title: "Mail/Category presentation",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/**
 * The decision itself, in one place: per category, the label every surface
 * shows, the tone it carries, where it sits in the chip row and where it sits
 * in the brief's section order, and what the section says once a chip has left
 * it with no rows.
 */
export const CanonicalTable: Story = {
	render: () => (
		<table className="w-full text-left text-xs text-fg-muted">
			<thead>
				<tr className="text-2xs uppercase tracking-wider text-fg-subtle">
					<th className="py-1 pr-4 font-semibold">Category</th>
					<th className="py-1 pr-4 font-semibold">Label</th>
					<th className="py-1 pr-4 font-semibold">Tone</th>
					<th className="py-1 pr-4 font-semibold">Chip</th>
					<th className="py-1 pr-4 font-semibold">Section</th>
					<th className="py-1 font-semibold">Emptied by a chip</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-line">
				{CANONICAL.map((entry, index) => (
					<tr
						key={entry.category}
						data-category={entry.category}
						data-tone={entry.tone}
					>
						<td className="py-1.5 pr-4 font-mono text-fg-subtle">
							{entry.category}
						</td>
						<td className="py-1.5 pr-4">
							<Badge tone={entry.tone}>{entry.label}</Badge>
						</td>
						<td className="py-1.5 pr-4">{entry.tone}</td>
						<td className="py-1.5 pr-4 tabular-nums">{index + 2}</td>
						<td className="py-1.5 pr-4 tabular-nums">{entry.section}</td>
						<td className="py-1.5">{emptySectionCopy(entry.label)}</td>
					</tr>
				))}
			</tbody>
		</table>
	),
	play: async ({ canvasElement }) => {
		const rows = Array.from(
			canvasElement.querySelectorAll<HTMLTableRowElement>("tbody tr"),
		);
		await expect(rows).toHaveLength(CANONICAL.length);
		for (const [index, entry] of CANONICAL.entries()) {
			const row = rows[index];
			await expect(row).toHaveAttribute("data-category", entry.category);
			await expect(row).toHaveAttribute("data-tone", entry.tone);
			await expect(within(row).getByText(entry.label)).toBeVisible();
			await expect(within(row).getByText(entry.tone)).toBeVisible();
			await expect(categoryTone[entry.category]).toBe(entry.tone);
		}
		const labels = CANONICAL.map((entry) => entry.label);
		await expect(new Set(labels).size).toBe(labels.length);
	},
};

/**
 * The chip row: All, then the categories in the order the reader meets them.
 * Every chip carries its category's tone, so the chip and the badge the chip
 * filters for read alike.
 */
export const ChipRow: Story = {
	render: () => (
		<div className="h-96 w-96 border border-line">
			<FilterSheet
				categories={chipCategories}
				filters={briefFilterConfig().filters}
				selectedCategory="all"
				activeFilters={new Set<string>()}
				expanded
				onSelectCategory={() => undefined}
				onToggleFilter={() => undefined}
				onExpandedChange={() => undefined}
				onClear={() => undefined}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const chips = within(canvas.getByRole("group", { name: "Categories" }));
		await expect(
			chips.getAllByRole("button").map((chip) => chip.textContent),
		).toEqual(["All", ...CANONICAL.map((entry) => entry.label)]);
		await expect(
			briefFilterConfig().categories.map((category) => category.id),
		).toEqual(["all", ...CANONICAL.map((entry) => entry.category)]);
	},
};

/**
 * The brief's section order, which is not the chip order: Unclassified goes
 * last, under the mail the classifier did reach.
 */
export const SectionOrder: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<div className="flex h-screen w-96 flex-col overflow-y-auto border-r border-line">
			{orderedSections.map((section) => (
				<BriefSection
					key={section.id}
					section={section}
					Row={ComfortableRow}
					onSelectThread={() => undefined}
				/>
			))}
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas
				.getAllByRole("button", { expanded: true })
				.map((header) => header.textContent),
		).toEqual(SECTION_ORDER.map((entry) => entry.label));
	},
};

/**
 * Every section the chips emptied. The category holds mail — the totals here
 * are a real mailbox's — so the section stays rather than vanishing, and says
 * in its own words that the filter, not the mailbox, is why it is bare. The
 * number goes: a count above no rows reads as a broken list.
 */
export const EmptiedByAChip: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<div className="flex h-screen w-96 flex-col overflow-y-auto border-r border-line">
			{emptiedSections.map((section) => (
				<BriefSection
					key={section.id}
					section={section}
					Row={ComfortableRow}
					onSelectThread={() => undefined}
				/>
			))}
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const entry of SECTION_ORDER) {
			await expect(
				canvas.getByText(emptySectionCopy(entry.label)),
			).toBeVisible();
			await expect(canvas.queryByText(entry.total.toLocaleString())).toBeNull();
		}
	},
};
