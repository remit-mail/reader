import { useRef, useState } from "react";
import { useListKeyboardAbove } from "../lib/list-keyboard-above.js";
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
export type BriefFilterId = "unread" | "attachment" | "contacts" | "today";

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
 * Whether an id names one of the brief's attribute chips. A consumer holding
 * one filter set across several views — the workbench shell, whose mailbox
 * sheet offers chips of its own — narrows that set to the brief's own with
 * this rather than asserting it.
 */
export function isBriefFilterId(id: string): id is BriefFilterId {
	return briefFilterDefs.some((f) => f.id === id);
}

/**
 * Whether a thread survives a set of attribute chips, as the brief's own list
 * applies them. Exported so a consumer narrowing the same rows on another
 * surface — the phone search takeover — reads one definition of what "Unread" or
 * "Today" means.
 */
export function matchesBriefFilters(
	thread: ThreadRowData,
	activeFilters: ReadonlySet<BriefFilterId>,
): boolean {
	return briefFilterDefs.every(
		(f) => !activeFilters.has(f.id) || f.match(thread),
	);
}

/**
 * The attribute chips are either this component's own or entirely the
 * consumer's. A consumer narrowing the same rows on a second surface (the phone
 * search takeover) holds the set so both surfaces answer to one selection, and
 * takes every control over it with the set.
 */
export type BriefFilterControl =
	| {
			activeFilters: ReadonlySet<BriefFilterId>;
			onToggleFilter: (id: BriefFilterId) => void;
			onClearFilters: () => void;
	  }
	| {
			activeFilters?: never;
			onToggleFilter?: never;
			onClearFilters?: never;
	  };

/** The accounts the aggregate is segmented by, as the FilterSheet draws them. */
export interface BriefSourceControl {
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
}

/** The single category the sections are scoped to. */
export interface BriefCategoryControl {
	briefCategory?: BriefCategoryFilter;
	onSelectBriefCategory?: (category: BriefCategoryFilter) => void;
}

/**
 * The brief's whole filter surface as a host holds it: the category scope, the
 * account pills and the attribute chips. A host with a second surface over the
 * same rows — the phone search takeover — holds this one set and hands it to
 * both, so a filter set on either is set on both.
 */
export type BriefFilterSurface = BriefCategoryControl &
	BriefSourceControl &
	BriefFilterControl;

interface BriefSectionsBaseProps
	extends BriefCategoryControl,
		BriefSourceControl {
	sections: ThreadSection[];
	selectedThreadId?: string;
	Row: BriefRowComponent;
	onSelectThread?: (id: string) => void;
	/**
	 * Drop the filter row and its panel, keeping the rows where they are. See
	 * `FilterSheetProps`.
	 */
	hideChrome?: boolean;
	/** Seeds the filter panel open on first render (stories / deep links). */
	defaultExpanded?: boolean;
}

export type BriefSectionsProps = BriefSectionsBaseProps & BriefFilterControl;

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
	hideChrome,
	defaultExpanded = false,
}: BriefSectionsProps) {
	const [ownFilters, setOwnFilters] = useState<ReadonlySet<BriefFilterId>>(
		new Set(),
	);
	const [sheetExpanded, setSheetExpanded] = useState(defaultExpanded);
	const listRef = useRef<HTMLDivElement>(null);
	// A keyboard layer above the rows owns ↑/↓/Home/End, and Shift+↑/↓ with them.
	// The group here reads only `event.key`, so leaving it on takes the shifted
	// pair as plain arrows and stops them before the layer can extend a range.
	const keyboardAbove = useListKeyboardAbove();
	useRovingFocus({
		containerRef: listRef,
		itemSelector: LIST_ROW_SELECTOR,
		enabled: !keyboardAbove,
	});

	const active = activeFilters ?? ownFilters;

	const toggleFilter = (id: BriefFilterId) => {
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
			onToggleFilter={(id) => toggleFilter(id as BriefFilterId)}
			onClear={clearFilters}
			hideChrome={hideChrome}
		>
			{listBody}
		</FilterSheet>
	);
}
