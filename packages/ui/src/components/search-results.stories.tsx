import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { SearchResult } from "./search-result-row.js";
import { type SearchResultSection, SearchResults } from "./search-results.js";

/**
 * Frames the body the way the desktop/tablet list pane does: a narrow column
 * with its own scroll container, so the sticky section headers read correctly.
 */
const listPaneFrame: Decorator = (Story) => (
	<div
		className="overflow-y-auto rounded-lg border border-line bg-canvas"
		style={{ width: 360, height: 640 }}
	>
		<Story />
	</div>
);

const recentSearches = ["invoice march", "from: stripe", "flight confirmation"];

const topMatches: SearchResult[] = [
	{
		id: "r1",
		sender: "Stripe",
		subject: "Your invoice for March is ready",
		snippet: "Invoice #4821 — €149.00 paid on Visa ending 4242.",
		date: "9:42",
		unread: true,
		category: { label: "Receipt", tone: "positive" },
	},
	{
		id: "r2",
		sender: "Hetzner Online",
		subject: "Invoice 2026-03 available in your account",
		snippet: "Dear customer, your invoice for the period is attached.",
		date: "Mar 3",
		category: { label: "Finance", tone: "accent" },
	},
	{
		id: "r3",
		sender: "Anna de Vries",
		subject: "Re: Q1 invoice approval",
		snippet: "Approved — can you forward the PDF invoice to finance?",
		date: "Mar 1",
		flagged: true,
	},
];

const related: SearchResult[] = [
	{
		id: "r5",
		sender: "QuickBooks",
		subject: "Reminder: 2 invoices awaiting payment",
		snippet: "You have outstanding invoices totalling €430.00.",
		date: "Feb 20",
		matchedChunkLabel: "body",
		score: 0.92,
	},
	{
		id: "r6",
		sender: "noreply@vendor.io",
		subject: "Overdue invoice notice",
		snippet: "This invoice is now 14 days overdue. Please remit payment.",
		date: "Feb 12",
		matchedChunkLabel: "subject",
		score: 0.81,
	},
];

const resultSections: SearchResultSection[] = [
	{ id: "top", label: "Top matches", results: topMatches },
	{ id: "related", label: "Related", results: related },
];

const emptySections: SearchResultSection[] = [
	{ id: "top", label: "Top matches", results: [] },
];

function Harness(props: Parameters<typeof SearchResults>[0]) {
	const [value, setValue] = useState(props.value);
	return <SearchResults {...props} value={value} onPickRecent={setValue} />;
}

const meta: Meta<typeof SearchResults> = {
	title: "Kit/SearchResults",
	component: SearchResults,
	parameters: { layout: "centered" },
	decorators: [listPaneFrame],
};
export default meta;

type Story = StoryObj<typeof SearchResults>;

/** The sectioned results the desktop list pane swaps in while a query is active. */
export const Results: Story = {
	render: () => <Harness value="invoice" sections={resultSections} />,
};

/** A query that matches nothing. */
export const NoResults: Story = {
	render: () => <Harness value="asdfqwer" sections={emptySections} />,
};

/** Results still loading. */
export const Loading: Story = {
	render: () => <Harness value="invoice" loading />,
};

/** Empty query: recent searches (the list pane shows the normal list instead). */
export const Idle: Story = {
	render: () => <Harness value="" recentSearches={recentSearches} />,
};

/** Typed filter tokens (`from:`, `has:attachment`, …) render as removable chips above the sections. */
export const WithFilterTokens: Story = {
	render: () => (
		<Harness
			value="invoice from:stripe.com has:attachment"
			sections={resultSections}
			tokens={[
				{ label: "From: stripe.com", onRemove: () => {} },
				{ label: "Has attachment", onRemove: () => {} },
			]}
		/>
	),
};
