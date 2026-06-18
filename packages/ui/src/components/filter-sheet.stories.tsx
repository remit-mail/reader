import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
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
}: {
	initialCategory?: string;
	initialFilters?: Set<string>;
	initialExpanded?: boolean;
}) {
	const [category, setCategory] = useState(initialCategory);
	const [activeFilters, setActiveFilters] =
		useState<Set<string>>(initialFilters);
	const [expanded, setExpanded] = useState(initialExpanded);

	return (
		<div className="h-[600px] w-[390px]">
			<FilterSheet
				categories={CATEGORIES}
				filters={FILTERS}
				selectedCategory={category}
				activeFilters={activeFilters}
				expanded={expanded}
				onSelectCategory={setCategory}
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
