import { useState } from "react";
import type {
	AccountChip,
	BriefCategoryFilter,
	ThreadRowData,
	ThreadSection,
} from "./app-shell-types.js";
import { briefCategories, categoryTone } from "./app-shell-types.js";
import { BriefSection } from "./brief-section.js";
import {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetFilter,
} from "./filter-sheet.js";
import type { BriefRowComponent } from "./message-row.js";

/* Composable brief filters — each is an additive predicate over a thread row. */
type BriefFilterId = "unread" | "attachment" | "contacts" | "today";

/* "Today" prefers the real `sentDate` timestamp; it falls back to the fixture
   convention that same-day rows render a HH:MM timeLabel (fixtures carry no
   sentDate). */
function isTodayRow(t: ThreadRowData): boolean {
	if (t.sentDate != null) {
		return new Date(t.sentDate).toDateString() === new Date().toDateString();
	}
	return /^\d{1,2}:\d{2}$/.test(t.timeLabel);
}

const briefFilterDefs: ReadonlyArray<{
	id: BriefFilterId;
	label: string;
	match: (t: ThreadRowData) => boolean;
}> = [
	{ id: "unread", label: "Unread", match: (t) => !t.isRead },
	{
		id: "attachment",
		label: "Has attachment",
		match: (t) => !!t.hasAttachment,
	},
	{
		id: "contacts",
		label: "From contacts",
		match: (t) => t.trust === "vip" || t.trust === "wellknown",
	},
	{ id: "today", label: "Today", match: isTodayRow },
];

export interface BriefSectionsProps {
	sections: ThreadSection[];
	briefCategory?: BriefCategoryFilter;
	selectedThreadId?: string;
	/** Source/account pills, scoping the brief to one account (single-select). */
	accountChips?: AccountChip[];
	/** Note rendered alongside the source pills (e.g. "+2 muted"). */
	mutedNote?: string;
	Row: BriefRowComponent;
	/** Optional with a desktop default so the live web-client consumer keeps
	 *  working untouched until it threads this from its own width. */
	isDesktop?: boolean;
	onSelectThread?: (id: string) => void;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
	onSelectAccountChip?: (id: string) => void;
}

/**
 * The daily-brief list body: category pills (single-select) + attribute chips
 * (additive) + one capped section per category (see {@link BriefSection}). Owns
 * its own filter state; the category axis is controlled via
 * `briefCategory`/`onSelectBriefCategory`. Consumers pre-filter `sections`
 * (e.g. by search) and pass a `Row` renderer; the web client reuses this so the
 * real brief and the Storybook prototype stay in lockstep.
 */
export function BriefSections({
	sections,
	briefCategory = "all",
	selectedThreadId,
	accountChips,
	mutedNote,
	Row,
	isDesktop = true,
	onSelectThread,
	onSelectBriefCategory,
	onSelectAccountChip,
}: BriefSectionsProps) {
	const [active, setActive] = useState<ReadonlySet<BriefFilterId>>(new Set());
	const [sheetExpanded, setSheetExpanded] = useState(false);

	const toggleFilter = (id: BriefFilterId) => {
		setActive((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const predicates = briefFilterDefs.filter((f) => active.has(f.id));
	const filtered = sections
		.map((section) => ({
			...section,
			threads: section.threads.filter(
				(t) =>
					(briefCategory === "all" || t.category === briefCategory) &&
					predicates.every((f) => f.match(t)),
			),
		}))
		.filter((section) => section.threads.length > 0);

	const sheetCategories: FilterSheetCategory[] = briefCategories.map((cat) => ({
		id: cat.id,
		label: cat.label,
		tone: cat.id === "all" ? "neutral" : categoryTone[cat.id],
	}));

	const sheetFilters: FilterSheetFilter[] = briefFilterDefs.map((f) => ({
		id: f.id,
		label: f.label,
	}));

	const sheetSources = accountChips?.map((chip) => ({
		id: chip.id,
		label: chip.label,
		count: chip.count,
		active: chip.active,
	}));

	const clearFilters = () => {
		onSelectBriefCategory?.("all");
		setActive(new Set());
	};

	const listBody = (
		<>
			{filtered.map((section) => (
				<BriefSection
					key={section.id}
					section={section}
					Row={Row}
					selectedThreadId={selectedThreadId}
					onSelectThread={onSelectThread}
				/>
			))}
			{filtered.length === 0 && (
				<div className="px-row-inset py-6 text-center text-2xs text-fg-subtle">
					No threads match these filters.
				</div>
			)}
		</>
	);

	// One source of truth for both breakpoints: the touch drag-snap sheet on
	// mobile, the click-to-expand popover on desktop. The desktop brief used to
	// render three permanently-expanded pill rows above the list with two
	// redundant "All" pills (#783); the FilterSheet renders a single Filters
	// control and one category scope.
	return (
		<FilterSheet
			variant={isDesktop ? "popover" : "sheet"}
			categories={sheetCategories}
			filters={sheetFilters}
			sources={sheetSources}
			sourcesNote={mutedNote}
			selectedCategory={briefCategory}
			activeFilters={active}
			expanded={isDesktop ? undefined : sheetExpanded}
			onExpandedChange={isDesktop ? undefined : setSheetExpanded}
			onSelectCategory={(id) =>
				onSelectBriefCategory?.(id as BriefCategoryFilter)
			}
			onSelectSource={(id) => onSelectAccountChip?.(id)}
			onToggleFilter={(id) => toggleFilter(id as BriefFilterId)}
			onClear={clearFilters}
		>
			{listBody}
		</FilterSheet>
	);
}
