import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	briefFilterConfig,
	type FilterAccount,
	inboxFilterConfig,
} from "../filter-presets.js";
import { MobileSearchView } from "./mobile-search-view.js";
import type { SearchResult } from "./search-result-row.js";
import type { SearchResultSection } from "./search-results.js";

const phoneFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden rounded-lg border border-line"
		style={{ width: 390, height: 720 }}
	>
		<Story />
	</div>
);

const accounts: FilterAccount[] = [
	{ id: "personal", label: "matthijs@", count: 42, active: true },
	{ id: "work", label: "work@acme", count: 17 },
];

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
	{
		id: "r4",
		sender: "AWS Billing",
		subject: "Your invoice is now available",
		snippet: "Your total for February was $312.55 across 6 services.",
		date: "Feb 28",
		category: { label: "Finance", tone: "accent" },
	},
];

// Semantic "Related" hits carry their own thread + mailbox so they open directly
// — the matching message often lives outside the loaded list.
const related: SearchResult[] = [
	{
		id: "r5",
		sender: "QuickBooks",
		subject: "Reminder: 2 invoices awaiting payment",
		snippet: "You have outstanding invoices totalling €430.00.",
		date: "Feb 20",
		category: { label: "Reminder", tone: "warning" },
		threadId: "thread-quickbooks",
		mailboxId: "mailbox-personal",
	},
	{
		id: "r6",
		sender: "noreply@vendor.io",
		subject: "Overdue invoice notice",
		snippet: "This invoice is now 14 days overdue. Please remit payment.",
		date: "Feb 12",
		category: { label: "Overdue", tone: "danger" },
		threadId: "thread-vendor",
		mailboxId: "mailbox-personal",
	},
];

const resultSections: SearchResultSection[] = [
	{ id: "top", label: "Top matches", results: topMatches },
	{ id: "related", label: "Related", results: related },
];

const emptySections: SearchResultSection[] = [
	{ id: "top", label: "Top matches", results: [] },
	{ id: "related", label: "Related", results: [] },
];

type Preset = "brief" | "inbox";

function Harness({
	initialValue = "",
	loading,
	sections,
	preset,
}: {
	initialValue?: string;
	loading?: boolean;
	sections?: SearchResultSection[];
	preset: Preset;
}) {
	const [value, setValue] = useState(initialValue);
	const [selectedCategory, setSelectedCategory] = useState("all");
	const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
	const [activeSource, setActiveSource] = useState("personal");
	const [expanded, setExpanded] = useState(false);
	const [opened, setOpened] = useState<SearchResult | null>(null);

	const base =
		preset === "brief"
			? briefFilterConfig(
					accounts.map((account) => ({
						...account,
						active: account.id === activeSource,
					})),
				)
			: inboxFilterConfig();

	if (opened) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center text-sm">
				<p className="font-semibold text-fg">Opened conversation</p>
				<p className="text-fg-muted">{opened.subject}</p>
				<p className="text-2xs text-fg-subtle">
					thread {opened.threadId ?? "(none)"} · mailbox{" "}
					{opened.mailboxId ?? "(none)"}
				</p>
				<button
					type="button"
					className="mt-2 text-2xs text-accent underline"
					onClick={() => setOpened(null)}
				>
					Back to search
				</button>
			</div>
		);
	}

	return (
		<MobileSearchView
			value={value}
			onChange={setValue}
			onClear={() => setValue("")}
			onCancel={() => undefined}
			filter={{
				...base,
				selectedCategory,
				activeFilters,
				expanded,
				onExpandedChange: setExpanded,
				onSelectCategory: setSelectedCategory,
				onSelectSource: setActiveSource,
				onToggleFilter: (id) =>
					setActiveFilters((current) => {
						const next = new Set(current);
						if (next.has(id)) next.delete(id);
						else next.add(id);
						return next;
					}),
				onClear: () => {
					setSelectedCategory("all");
					setActiveFilters(new Set());
				},
			}}
			recentSearches={recentSearches}
			onPickRecent={setValue}
			sections={sections}
			loading={loading}
			onSelectResult={setOpened}
		/>
	);
}

const meta: Meta<typeof MobileSearchView> = {
	title: "Kit/MobileSearchView",
	component: MobileSearchView,
	parameters: { layout: "centered" },
	decorators: [phoneFrame],
};
export default meta;

type Story = StoryObj<typeof MobileSearchView>;

/**
 * Global search — the daily-brief preset, so the FilterSheet carries the account
 * source row (matthijs@ / work@acme) on top of the shared categories + filters.
 * The header carries a single X that clears the query AND dismisses the takeover.
 */
export const GlobalSearch: Story = {
	render: () => (
		<Harness initialValue="invoice" sections={resultSections} preset="brief" />
	),
};

/**
 * Scoped search — a single inbox, so the inbox preset drops the account row
 * entirely (the view is already scoped); same categories and filters otherwise.
 */
export const ScopedSearch: Story = {
	render: () => (
		<Harness initialValue="invoice" sections={resultSections} preset="inbox" />
	),
};

/** Empty query: recent searches under the brief filter chrome. */
export const Idle: Story = {
	render: () => <Harness preset="brief" />,
};

/** A query that matches nothing. */
export const NoResults: Story = {
	render: () => (
		<Harness initialValue="asdfqwer" sections={emptySections} preset="brief" />
	),
};

/** Results still loading. */
export const Loading: Story = {
	render: () => <Harness initialValue="invoice" loading preset="brief" />,
};

/**
 * Selecting a "Related" (semantic) hit. These rows carry their own thread +
 * mailbox, so tapping one opens the conversation directly — even though the
 * matching message lives outside the loaded list. Tap a row under "Related" to
 * see the thread + mailbox the result hands the app to open. Regression cover for
 * the brief bug where a tapped related result selected nothing.
 */
export const RelatedSelectable: Story = {
	render: () => (
		<Harness
			initialValue="invoice"
			sections={[{ id: "related", label: "Related", results: related }]}
			preset="brief"
		/>
	),
};
