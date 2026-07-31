import { useRef, useState } from "react";
import { LIST_ROW_SELECTOR, useRovingFocus } from "../lib/roving-focus.js";
import type {
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
	type FilterSheetSource,
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

/**
 * The brief's attribute chips as plain `{ id, label }` (no predicates) — the
 * single source the `briefFilterConfig` preset reuses so the live filter row and
 * the preset can never diverge.
 */
export const briefFilterChips: FilterSheetFilter[] = briefFilterDefs.map(
	({ id, label }) => ({ id, label }),
);

/**
 * Whether a thread survives a set of attribute chips, as the brief's own list
 * applies them. Exported so a consumer narrowing the same rows on another
 * surface — the phone search takeover — reads one definition of what "Unread" or
 * "Today" means.
 */
export function matchesBriefFilters(
	thread: ThreadRowData,
	activeFilters: ReadonlySet<string>,
): boolean {
	return briefFilterDefs.every(
		(f) => !activeFilters.has(f.id) || f.match(thread),
	);
}

export interface BriefSectionsProps {
	sections: ThreadSection[];
	briefCategory?: BriefCategoryFilter;
	selectedThreadId?: string;
	Row: BriefRowComponent;
	onSelectThread?: (id: string) => void;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
	/**
	 * Account/source pills, passed straight through to the FilterSheet. Selection
	 * is encoded per source via `active`; the row only renders when more than one
	 * source is supplied (the cross-account brief). Single-account views omit it.
	 */
	sources?: FilterSheetSource[];
	/** Note rendered alongside the source pills (e.g. "+1 muted"). */
	sourcesNote?: string;
	/** Called when the user selects a source/account pill. */
	onSelectSource?: (id: string) => void;
	/**
	 * The active attribute chips, when the consumer owns them. A consumer that
	 * narrows the same rows on a second surface (the phone search takeover) holds
	 * the set itself so both surfaces answer to one selection; leave it unset and
	 * this component keeps its own.
	 */
	activeFilters?: ReadonlySet<string>;
	/** Required alongside `activeFilters`. */
	onToggleFilter?: (id: string) => void;
	/** Required alongside `activeFilters`. Clears the chips; the category axis is cleared through `onSelectBriefCategory`. */
	onClearFilters?: () => void;
	/** Seeds the filter panel open on first render (stories / deep links). */
	defaultExpanded?: boolean;
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
	Row,
	onSelectThread,
	onSelectBriefCategory,
	sources,
	sourcesNote,
	onSelectSource,
	activeFilters,
	onToggleFilter,
	onClearFilters,
	defaultExpanded = false,
}: BriefSectionsProps) {
	const [ownFilters, setOwnFilters] = useState<ReadonlySet<string>>(new Set());
	const [sheetExpanded, setSheetExpanded] = useState(defaultExpanded);
	const listRef = useRef<HTMLDivElement>(null);
	useRovingFocus({
		containerRef: listRef,
		itemSelector: LIST_ROW_SELECTOR,
	});

	const active = activeFilters ?? ownFilters;

	const toggleFilter = (id: string) => {
		if (onToggleFilter) {
			onToggleFilter(id);
			return;
		}
		setOwnFilters((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const matches = (t: ThreadRowData) =>
		(briefCategory === "all" || t.category === briefCategory) &&
		matchesBriefFilters(t, active);

	// One section per category only earns its keep at the "all" scope. Narrow to
	// a single category and the headers are redundant: render a plain flat list.
	const showSections = briefCategory === "all";

	const filtered = sections
		.map((section) => ({
			...section,
			threads: section.threads.filter(matches),
		}))
		.filter((section) => section.threads.length > 0);

	const flatRows = sections.flatMap((s) => s.threads).filter(matches);

	const sheetCategories: FilterSheetCategory[] = briefCategories.map((cat) => ({
		id: cat.id,
		label: cat.label,
		tone: cat.id === "all" ? "neutral" : categoryTone[cat.id],
	}));

	const sheetFilters = briefFilterChips;

	const clearFilters = () => {
		onSelectBriefCategory?.("all");
		if (onClearFilters) {
			onClearFilters();
			return;
		}
		setOwnFilters(new Set());
	};

	const empty = showSections ? filtered.length === 0 : flatRows.length === 0;

	const listBody = (
		<div ref={listRef}>
			{showSections ? (
				filtered.map((section) => (
					<BriefSection
						key={section.id}
						section={section}
						Row={Row}
						selectedThreadId={selectedThreadId}
						onSelectThread={onSelectThread}
					/>
				))
			) : (
				<div className="divide-y divide-line">
					{flatRows.map((t) => (
						<Row
							key={t.id}
							thread={t}
							active={t.id === selectedThreadId}
							onClick={() => onSelectThread?.(t.id)}
						/>
					))}
				</div>
			)}
			{empty && (
				<div className="px-row-inset py-6 text-center text-2xs text-fg-subtle">
					No threads match these filters.
				</div>
			)}
		</div>
	);

	// One source of truth for both breakpoints: a click-to-expand Filters bar
	// that pushes the list down. The desktop brief used to render three
	// permanently-expanded pill rows above the list with two redundant "All"
	// pills (#783); the FilterSheet renders a single Filters control and one
	// category scope.
	return (
		<FilterSheet
			categories={sheetCategories}
			filters={sheetFilters}
			sources={sources}
			sourcesNote={sourcesNote}
			selectedCategory={briefCategory}
			activeFilters={active}
			expanded={sheetExpanded}
			onExpandedChange={setSheetExpanded}
			onSelectCategory={(id) =>
				onSelectBriefCategory?.(id as BriefCategoryFilter)
			}
			onSelectSource={onSelectSource}
			onToggleFilter={toggleFilter}
			onClear={clearFilters}
		>
			{listBody}
		</FilterSheet>
	);
}
