import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
	type FilterSheetSource,
} from "./filter-sheet.js";

const CATEGORIES: FilterSheetCategory[] = [
	{ id: "all", label: "All", tone: "neutral" },
	{ id: "personal", label: "Personal", tone: "positive" },
	{ id: "newsletters", label: "Newsletters", tone: "accent" },
	{ id: "marketing", label: "Marketing", tone: "warning" },
	{ id: "automated", label: "Automated", tone: "neutral" },
	{ id: "transactional", label: "Transactional", tone: "danger" },
];

const FILTERS: FilterSheetFilter[] = [
	{ id: "unread", label: "Unread" },
	{ id: "attachment", label: "Has attachment" },
	{ id: "contacts", label: "From contacts" },
	{ id: "today", label: "Today" },
];

const SOURCES: FilterSheetSource[] = [
	{ id: "all", label: "All", active: true },
	{ id: "work", label: "work@acme.com", count: 12 },
	{ id: "personal", label: "me@home.net", count: 3 },
];

const meta: Meta<typeof FilterSheet> = {
	title: "FilterSheet",
	component: FilterSheet,
	parameters: {
		layout: "fullscreen",
	},
};
export default meta;

type Story = StoryObj<typeof FilterSheet>;

function SampleList() {
	return (
		<ul className="divide-y divide-line">
			{Array.from({ length: 12 }, (_, i) => (
				<li key={i} className="px-row-inset py-3 text-sm text-fg-muted">
					Message {i + 1}
				</li>
			))}
		</ul>
	);
}

function ControlledShell({
	initialCategory = "all",
	initialFilters = new Set<string>(),
	initialExpanded = true,
	initialSource = "all",
	withSources = true,
	singleAccount = false,
	sourcesNote,
}: {
	initialCategory?: string;
	initialFilters?: Set<string>;
	initialExpanded?: boolean;
	initialSource?: string;
	withSources?: boolean;
	singleAccount?: boolean;
	sourcesNote?: string;
}) {
	const [category, setCategory] = useState(initialCategory);
	const [activeFilters, setActiveFilters] =
		useState<Set<string>>(initialFilters);
	const [expanded, setExpanded] = useState(initialExpanded);
	const [source, setSource] = useState(initialSource);

	const sourcePool = singleAccount ? SOURCES.slice(0, 1) : SOURCES;
	const sources = withSources
		? sourcePool.map((s) => ({ ...s, active: s.id === source }))
		: undefined;

	return (
		<div className="h-[600px] w-[390px]">
			<FilterSheet
				categories={CATEGORIES}
				filters={FILTERS}
				sources={sources}
				sourcesNote={sourcesNote}
				selectedCategory={category}
				activeFilters={activeFilters}
				expanded={expanded}
				onSelectCategory={setCategory}
				onSelectSource={setSource}
				onToggleFilter={(id) =>
					setActiveFilters((prev) => {
						const next = new Set(prev);
						if (next.has(id)) next.delete(id);
						else next.add(id);
						return next;
					})
				}
				onClear={() => {
					setCategory("all");
					setActiveFilters(new Set());
				}}
				onExpandedChange={setExpanded}
			>
				<SampleList />
			</FilterSheet>
		</div>
	);
}

export const Expanded: Story = {
	render: () => <ControlledShell initialExpanded={true} />,
};

export const CollapsedWithActiveFilters: Story = {
	render: () => (
		<ControlledShell
			initialExpanded={false}
			initialCategory="personal"
			initialFilters={new Set(["unread", "today"])}
		/>
	),
};

export const CollapsedEmpty: Story = {
	render: () => <ControlledShell initialExpanded={false} />,
};

export const ExpandedSourceSelected: Story = {
	render: () => <ControlledShell initialSource="work" sourcesNote="+2 muted" />,
};

export const CollapsedWithSourceSelected: Story = {
	render: () => (
		<ControlledShell initialExpanded={false} initialSource="work" />
	),
};

export const SingleAccount: Story = {
	render: () => <ControlledShell singleAccount />,
};
