import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type { ThreadSection } from "./app-shell-types.js";
import type { ResultCount } from "./list-result-header.js";
import type { BriefRowComponent } from "./message-row.js";

/** Rows a section renders before the reader is sent to the filtered list. */
export const SECTION_ROW_CAP = 10;

const UNKNOWN_TOTAL: ResultCount = { kind: "unknown" };

const formatTotal = (n: number): string => n.toLocaleString();

export interface BriefSectionProps {
	section: ThreadSection;
	Row: BriefRowComponent;
	selectedThreadId?: string;
	/** Seed the in-section "Show N more" state — lets a story / SSR render the expanded view. */
	initialExpanded?: boolean;
	/** Seed the section-collapse state — lets a story / SSR render the header-only view. */
	initialCollapsed?: boolean;
	/**
	 * Opens the filtered list for this section's category. Given, the rows beyond
	 * the ones loaded are the server's rather than this component's, so the
	 * control below the rows hands the reader over instead of revealing more.
	 */
	onShowAll?: () => void;
	/** Ask this section's own request again, after it failed. */
	onRetry?: () => void;
	onSelectThread?: (id: string) => void;
}

/**
 * One brief section: a sticky category label, the server's total for that
 * category, the newest rows of it, and a way to the rest.
 *
 * The header number is `section.total` — how much mail the category holds,
 * counted over the whole scope. It does not move when more rows arrive, because
 * it was never derived from them. A section with no total renders no number:
 * the length of what happens to be loaded, presented as a category size, is the
 * reading this replaces (#312).
 *
 * The control below the rows is the way to the rest of the category, whether or
 * not the header carries a number: a section that came back full holds more than
 * it shows, and says so even where the count was withheld.
 *
 * A total is never rendered above zero rows. Nothing loaded and the section
 * still fetching is the loading treatment; nothing loaded because the request
 * failed says so and offers the retry; nothing loaded and the fetch done is a
 * filter that matched nothing, and says so.
 *
 * The header is itself a toggle: tapping it collapses the whole section to just
 * the label + total and expands it again. Sections start expanded so the default
 * brief render is unchanged.
 *
 * Owns only its own expand/collapse state; the parent supplies the section and a
 * `Row` renderer so the live brief and the Storybook prototype stay in lockstep.
 */
export function BriefSection({
	section,
	Row,
	selectedThreadId,
	initialExpanded = false,
	initialCollapsed = false,
	onShowAll,
	onRetry,
	onSelectThread,
}: BriefSectionProps) {
	const [expanded, setExpanded] = useState(initialExpanded);
	const [collapsed, setCollapsed] = useState(initialCollapsed);

	const loaded = section.threads;
	const loading = section.loading === true;
	const failed = section.error === true;
	const overCap = loaded.length > SECTION_ROW_CAP;
	const capped = !expanded && overCap;
	const visible = capped ? loaded.slice(0, SECTION_ROW_CAP) : loaded;

	const total = section.total ?? UNKNOWN_TOTAL;
	// Nothing fetched and nothing coming: the section has no size to state, only
	// a filter that matched nothing.
	const headerTotal =
		total.kind === "exact" && (loaded.length > 0 || loading) && !failed
			? formatTotal(total.value)
			: undefined;
	// Nothing to show more of: a section a chip emptied offers a way out of the
	// chip, not a number the reader cannot see any of.
	// The way out of the section, and the number on it where there is one. A total
	// the caller withheld — a muted sender, an account pill, a term the request
	// could not carry — must not take the control with it: the rows beyond this
	// page are still there, and a section with no number and no control is a dead
	// end (#312).
	const holdsMore =
		total.kind === "exact"
			? total.value > visible.length
			: section.atCap === true;
	const showAllLabel =
		onShowAll !== undefined && visible.length > 0 && holdsMore
			? total.kind === "exact"
				? `Show all ${formatTotal(total.value)}`
				: "Show all"
			: undefined;
	const hiddenHere = loaded.length - visible.length;

	return (
		<div>
			{section.label && (
				<button
					type="button"
					aria-expanded={!collapsed}
					onClick={() => setCollapsed((v) => !v)}
					className="sticky top-0 z-10 flex h-section-row w-full items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
				>
					<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						{section.label}
					</span>
					{headerTotal !== undefined && (
						<span className="text-2xs text-fg-subtle tabular-nums">
							{headerTotal}
						</span>
					)}
					<ChevronDown
						className={cn(
							"size-3 shrink-0 text-fg-subtle transition-transform duration-200",
							collapsed ? "rotate-0" : "rotate-180",
						)}
					/>
				</button>
			)}
			{!collapsed && (
				<>
					{loaded.length === 0 ? (
						failed ? (
							<div className="flex flex-col items-center gap-1 border-b border-line px-row-inset py-4 text-center text-2xs text-danger">
								<span>{`Couldn't load ${section.label ?? "these messages"}`}</span>
								{onRetry && (
									<button
										type="button"
										onClick={onRetry}
										className="font-medium text-accent underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										Try again
									</button>
								)}
							</div>
						) : loading ? (
							<div className="animate-pulse divide-y divide-line">
								{[0, 1, 2].map((row) => (
									<div key={row} className="px-row-inset py-3">
										<div className="h-3 w-2/3 rounded bg-surface-sunken" />
									</div>
								))}
							</div>
						) : (
							<p className="border-b border-line px-row-inset py-4 text-center text-2xs text-fg-subtle">
								{section.label
									? `No ${section.label} mail in this brief.`
									: "No mail in this brief."}
							</p>
						)
					) : (
						<div className="divide-y divide-line">
							{visible.map((thread) => (
								<Row
									key={thread.id}
									thread={thread}
									active={thread.id === selectedThreadId}
									onClick={() => onSelectThread?.(thread.id)}
								/>
							))}
						</div>
					)}
					{showAllLabel !== undefined ? (
						<button
							type="button"
							onClick={onShowAll}
							className="flex w-full items-center justify-center border-b border-line px-row-inset py-1.5 text-2xs font-medium text-accent outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						>
							{showAllLabel}
							<ChevronRight className="ml-1 size-3" />
						</button>
					) : (
						overCap && (
							<button
								type="button"
								onClick={() => setExpanded((v) => !v)}
								className="flex w-full items-center justify-center border-b border-line px-row-inset py-1.5 text-2xs font-medium text-accent outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
							>
								{expanded
									? "Show less"
									: `Show ${formatTotal(hiddenHere)} more`}
								{!expanded && <ChevronDown className="ml-1 size-3" />}
							</button>
						)
					)}
				</>
			)}
		</div>
	);
}
