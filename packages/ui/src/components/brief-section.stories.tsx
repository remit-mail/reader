import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadRowData, ThreadSection } from "./app-shell-types.js";
import { BriefSection, SECTION_ROW_CAP } from "./brief-section.js";
import { ComfortableRow } from "./message-row.js";

function makeRow(i: number): ThreadRowData {
	return {
		id: `t${i}`,
		accountId: "a1",
		fromName: `Sender ${i}`,
		fromEmail: `sender${i}@example.com`,
		subject: `Subject line ${i}`,
		snippet: "A short preview of the message body.",
		timeLabel: `9:0${i % 10}`,
		isRead: i % 2 === 0,
		category: "personal",
	};
}

const rows = (n: number): ThreadRowData[] =>
	Array.from({ length: n }, (_, i) => makeRow(i + 1));

const shortSection: ThreadSection = {
	id: "transactional",
	label: "Transactional",
	threads: rows(3),
	total: { kind: "exact", value: 3 },
};

const longSection: ThreadSection = {
	id: "newsletter",
	label: "Newsletter",
	threads: rows(18),
};

/** Ten rows of a category holding thousands — the live shape of a brief section. */
const cappedSection: ThreadSection = {
	id: "marketing",
	label: "Marketing",
	threads: rows(SECTION_ROW_CAP),
	total: { kind: "exact", value: 3942 },
};

const meta: Meta<typeof BriefSection> = {
	title: "Screens/Kit/BriefSection",
	component: BriefSection,
	parameters: { layout: "fullscreen" },
	args: {
		Row: ComfortableRow,
		onSelectThread: () => undefined,
	},
	render: (args) => (
		<div className="flex h-screen w-96 flex-col border-r border-line">
			<BriefSection {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof BriefSection>;

/** Fewer than the cap — the total is the rows, and there is nowhere else to go. */
export const Short: Story = {
	args: { section: shortSection },
};

/**
 * The header total is the category's, counted by the server, and it stays put
 * however many rows the section holds. Ten rows under `Marketing 3,942`, with the
 * way to the rest beneath them.
 */
export const CategoryTotal: Story = {
	args: { section: cappedSection, onShowAll: () => undefined },
};

/**
 * A section nobody counted — an account pill or a `before:` term is narrowing the
 * rows after they arrive, so the server's number is of a wider set than the list.
 * It renders no number rather than one that is not the section's size.
 */
export const NoTotal: Story = {
	args: { section: { ...cappedSection, total: undefined } },
};

/**
 * The rows are still in flight. Distinct from a section that came back empty:
 * the total is already known, and the treatment says the rows are coming.
 */
export const Loading: Story = {
	args: {
		section: { ...cappedSection, threads: [], loading: true },
	},
};

/**
 * This section's own request failed. Each section is its own query, so the
 * failure states itself here and offers the way to ask again while the rest of
 * the brief stands.
 */
export const Failed: Story = {
	args: {
		section: { ...cappedSection, threads: [], error: true },
		onRetry: () => undefined,
	},
};

/**
 * A chip narrowed the section to nothing. The section says so in its own words,
 * and drops its number — a real total above zero rows reads as a broken list.
 */
export const EmptyUnderFilter: Story = {
	args: {
		section: { id: "personal", label: "Personal", threads: [] },
	},
};

/**
 * `uncategorized` is its own section with its own label, last in the order,
 * never folded into Personal (D6, issue #45).
 */
export const Unclassified: Story = {
	args: {
		section: {
			id: "uncategorized",
			label: "Unclassified",
			threads: rows(4).map((row) => ({ ...row, category: "uncategorized" })),
			total: { kind: "exact", value: 4 },
		},
	},
};

/** Over the cap with no total — the local expander, for a complete fixture set. */
export const CollapsedAtCap: Story = {
	args: { section: longSection },
};

/** The same section after expanding — every row visible, "Show less" to collapse. */
export const Expanded: Story = {
	args: { section: longSection, initialExpanded: true },
};

/** Section collapsed by its header — only the label + total show, every row hidden. */
export const SectionCollapsed: Story = {
	args: { section: cappedSection, initialCollapsed: true },
};
