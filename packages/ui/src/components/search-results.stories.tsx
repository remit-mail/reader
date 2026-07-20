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

/**
 * Matches from outside the inbox — Archive, Sent and a custom folder — each
 * carrying the folder it was read from. These are the rows a search reaching
 * every folder returns that an INBOX-only one could not.
 */
const crossFolderMatches: SearchResult[] = [
	{
		id: "x1",
		sender: "Mollie",
		subject: "Invoice 2026-02 — archived",
		snippet: "Filed last month; payment already settled.",
		date: "Feb 24",
		folder: { role: "archive" },
		category: { label: "Receipt", tone: "positive" },
	},
	{
		id: "x2",
		sender: "me",
		subject: "Re: invoice query",
		snippet: "Attaching the invoice you asked for.",
		date: "Feb 18",
		folder: { role: "sent" },
	},
	{
		id: "x4",
		sender: "Accountant",
		subject: "Invoices for the quarter",
		snippet: "The quarterly set, filed with the rest of the bookkeeping.",
		date: "Jan 30",
		folder: { providerPath: "Projects/Bookkeeping" },
	},
];

/**
 * Matches that live in the account's `\Junk` folder. A global search holds
 * these out of the sections entirely and offers them as a count instead.
 */
const spamMatches: SearchResult[] = [
	{
		id: "s1",
		sender: "billing@unknown-vendor.test",
		subject: "URGENT invoice attached",
		snippet: "Wire the amount below within 24 hours to avoid suspension.",
		date: "Feb 11",
		folder: { role: "junk" },
	},
	{
		id: "s2",
		sender: "invoices@pay-now.test",
		subject: "Outstanding invoice — final notice",
		snippet: "Your account is overdue. Settle immediately.",
		date: "Feb 4",
		folder: { role: "junk" },
	},
];

/** The literal section a global search returns: inbox rows plus everywhere else. */
const globalTopMatches: SearchResult[] = [
	...topMatches.map((result) => ({
		...result,
		folder: { role: "inbox" as const },
	})),
	...crossFolderMatches,
	...spamMatches,
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

/**
 * The daily brief's unscoped search: no scope chip in the bar, and the literal
 * section carries matches from every folder — Archive, Sent and custom folders
 * alongside the inbox. Each row says which folder it came from, because with
 * nothing scoping the search the folder is the only thing placing the result.
 *
 * The two spam matches in the same data are not in this list. They are held out
 * and offered above it as a count.
 */
export const GlobalAcrossFolders: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "global" }}
			onScopeToSpam={() => {}}
			sections={[
				{ id: "top", label: "Top matches", results: globalTopMatches },
				{ id: "related", label: "Related", results: related },
			]}
		/>
	),
};

/**
 * The same global search over an account whose Spam folder holds nothing
 * matching. No spam rows to hold out, so no offer — the offer only ever appears
 * because there is something behind it.
 */
export const GlobalWithoutSpamMatches: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "global" }}
			onScopeToSpam={() => {}}
			sections={[
				{
					id: "top",
					label: "Top matches",
					results: globalTopMatches.filter(
						(result) => result.folder?.role !== "junk",
					),
				},
				{ id: "related", label: "Related", results: related },
			]}
		/>
	),
};

/**
 * An account with no junk folder at all. Nothing is appointed `\Junk`, so no
 * row can be spam and the component behaves exactly as it does when Spam is
 * simply empty — there is no separate case to handle.
 */
export const GlobalAccountWithoutSpamFolder: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "global" }}
			onScopeToSpam={() => {}}
			sections={[
				{ id: "top", label: "Top matches", results: crossFolderMatches },
			]}
		/>
	),
};

/**
 * A global search whose only matches are in Spam. The sections are empty, so
 * the empty state stands — with the offer above it, which is the whole reason
 * the user is not left thinking the search found nothing.
 */
export const GlobalOnlySpamMatches: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "global" }}
			onScopeToSpam={() => {}}
			sections={[{ id: "top", label: "Top matches", results: spamMatches }]}
		/>
	),
};

/**
 * Scoped to the inbox (its `in:inbox` chip in the bar), given the very same
 * rows as the global story — spam matches included. Nothing about Spam appears:
 * no rows, no count, no offer. A scoped search shows its own scope and no more,
 * and that asymmetry with the global view is deliberate.
 *
 * The rows also drop their folder labels here. Every row is in the scoped
 * folder, so naming it on each one repeats the chip.
 */
export const ScopedToInbox: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "folder", role: "inbox" }}
			onScopeToSpam={() => {}}
			sections={[
				{ id: "top", label: "Top matches", results: globalTopMatches },
				{ id: "related", label: "Related", results: related },
			]}
		/>
	),
};

/**
 * Scoped to Spam — where taking the offer lands. Ordinary rows, rendered
 * normally, and no offer, because the user is already here. This is the same
 * scoped search reached by navigating to Spam with the query carried over; the
 * offer is a shortcut into it, not a mode of its own.
 */
export const ScopedToSpam: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "folder", role: "junk" }}
			onScopeToSpam={() => {}}
			sections={[{ id: "top", label: "Top matches", results: spamMatches }]}
		/>
	),
};

/**
 * A folder a search result can be in but never labelled with. All Mail and
 * Starred are views over mail filed elsewhere, and Gmail exposes them as
 * ordinary folders, so a row read from one carries no provenance label rather
 * than a misleading one. The other rows keep theirs.
 */
export const VirtualFoldersGoUnlabelled: Story = {
	render: () => (
		<Harness
			value="invoice"
			scope={{ kind: "global" }}
			sections={[
				{
					id: "top",
					label: "Top matches",
					results: [
						{ ...topMatches[0], id: "v1", folder: { role: "all" } },
						{ ...topMatches[1], id: "v2", folder: { role: "flagged" } },
						{
							...topMatches[2],
							id: "v3",
							folder: { providerPath: "[Gmail]/Important" },
						},
						...crossFolderMatches.slice(0, 1),
					],
				},
			]}
		/>
	),
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
