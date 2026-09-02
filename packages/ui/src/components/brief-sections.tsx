import { useRef, useState } from "react";
import { type BriefFilterId, briefFilterChips } from "../lib/brief-filters.js";
import { LIST_ROW_SELECTOR, useRovingFocus } from "../lib/roving-focus.js";
import type {
	BriefCategoryFilter,
	MessageListKeyboard,
	ThreadSection,
} from "./app-shell-types.js";
import {
	briefCategories,
	categoryTone,
	keyboardWalksRows,
} from "./app-shell-types.js";
import { BriefSection } from "./brief-section.js";
import {
	FilterSheet,
	type FilterSheetCategory,
	type FilterSheetSource,
} from "./filter-sheet.js";
import type { BriefRowComponent } from "./message-row.js";

/**
 * The attribute chips are either this component's own or entirely the
 * consumer's. A consumer narrowing the same rows on a second surface (the phone
 * search takeover) holds the set so both surfaces answer to one selection, and
 * takes every control over it with the set. `onClearFilters` is then the whole
 * of Clear, category scope included — one handler reading one state, rather
 * than two reading the same one and racing to write it.
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
	/**
	 * The keyboard layer walking the rows, when the caller mounts one. The rows
	 * hand it the cursor keys rather than traversing with a roving group of their
	 * own, so the ring and the cursor name one row and a Shift+arrow range
	 * reaches the layer that extends it.
	 */
	keyboard?: MessageListKeyboard;
	onSelectThread?: (id: string) => void;
	/**
	 * Sends the reader to the filtered list for one section's category. Given, a
	 * section holding fewer rows than its total offers the way to the rest — the
	 * brief itself never grows past its per-section page.
	 */
	onShowAllSection?: (sectionId: string) => void;
	/** Ask one section's own request again, after it failed. */
	onRetrySection?: (sectionId: string) => void;
	/**
	 * Render one list rather than one section per category. A search is answered
	 * this way: the rows come back in one global order, and a header between them
	 * would put an old match from an earlier category above a newer one (#312).
	 */
	flat?: boolean;
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
 * (additive) + one capped section per category (see {@link BriefSection}), or —
 * under `flat` — one plain list in the order the rows arrived.
 *
 * Every row it is handed is rendered. The chips and the category are controls it
 * draws and reports, never a pass over the rows: in the app both are query
 * parameters answered over the whole scope, and a second pass here would narrow
 * a page by a criterion the server already applied to everything (#312, #314).
 * The host narrows `sections` — by its request, and for the two chips no request
 * carries, with `matchesBriefFilters` — and passes a `Row` renderer; the web
 * client reuses this so the real brief and the Storybook prototype stay in
 * lockstep.
 */
export function BriefSections({
	sections,
	briefCategory = "all",
	selectedThreadId,
	Row,
	keyboard,
	onSelectThread,
	onShowAllSection,
	onRetrySection,
	flat = false,
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
	useRovingFocus({
		containerRef: listRef,
		itemSelector: LIST_ROW_SELECTOR,
		enabled: !keyboardWalksRows(keyboard),
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

	// One section per category earns its keep at the "all" scope, and wherever a
	// header carries the server's total for its category: narrowed to one
	// category the label restates the chip, but the total does not — it is the
	// only statement of how much mail that category holds. A search overrules
	// both: its answer is one list in one order.
	const showSections =
		!flat &&
		(briefCategory === "all" ||
			sections.some((section) => section.total !== undefined));

	// A section the server answered for stays on screen with no rows: nothing
	// matching a chip is a state the section states, and is not the same as a
	// category the brief never asked about.
	const shown = sections.filter(
		(section) =>
			section.threads.length > 0 ||
			section.total !== undefined ||
			section.loading === true ||
			section.error === true,
	);

	const flatRows = sections.flatMap((s) => s.threads);

	const sheetCategories: FilterSheetCategory[] = briefCategories.map((cat) => ({
		id: cat.id,
		label: cat.label,
		tone: cat.id === "all" ? "neutral" : categoryTone[cat.id],
	}));

	const sheetFilters = briefFilterChips;

	const clearFilters = () => {
		if (onClearFilters) {
			onClearFilters();
			return;
		}
		onSelectBriefCategory?.("all");
		setOwnFilters(new Set());
	};

	const empty = showSections ? shown.length === 0 : flatRows.length === 0;

	const listBody = (
		<div ref={listRef}>
			{showSections ? (
				shown.map((section) => (
					<BriefSection
						key={section.id}
						section={section}
						Row={Row}
						selectedThreadId={selectedThreadId}
						onSelectThread={onSelectThread}
						onShowAll={
							onShowAllSection ? () => onShowAllSection(section.id) : undefined
						}
						onRetry={
							onRetrySection ? () => onRetrySection(section.id) : undefined
						}
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
