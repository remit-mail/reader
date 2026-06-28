import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type { ThreadSection } from "./app-shell-types.js";
import type { BriefRowComponent } from "./message-row.js";

/** Rows shown before the "Show N more" expander kicks in. */
export const SECTION_ROW_CAP = 10;

export interface BriefSectionProps {
	section: ThreadSection;
	Row: BriefRowComponent;
	selectedThreadId?: string;
	/** Seed the in-section "Show N more" state — lets a story / SSR render the expanded view. */
	initialExpanded?: boolean;
	/** Seed the section-collapse state — lets a story / SSR render the header-only view. */
	initialCollapsed?: boolean;
	onSelectThread?: (id: string) => void;
}

/**
 * One brief section: a sticky category label, the first {@link SECTION_ROW_CAP}
 * rows, and a "Show N more" control that reveals the rest in place (toggling
 * back to "Show less"). The control is always tappable — it never disables.
 *
 * The header is itself a toggle: tapping it collapses the whole section to just
 * the label + count (hiding every row and the "Show N more" control) and
 * expands it again. Sections start expanded so the default brief render is
 * unchanged.
 *
 * Owns only its own expand/collapse state; the parent supplies the grouped
 * section and a `Row` renderer so the live brief and the Storybook prototype
 * stay in lockstep.
 */
export function BriefSection({
	section,
	Row,
	selectedThreadId,
	initialExpanded = false,
	initialCollapsed = false,
	onSelectThread,
}: BriefSectionProps) {
	const [expanded, setExpanded] = useState(initialExpanded);
	const [collapsed, setCollapsed] = useState(initialCollapsed);

	const overCap = section.threads.length > SECTION_ROW_CAP;
	const capped = !expanded && overCap;
	const visible = capped
		? section.threads.slice(0, SECTION_ROW_CAP)
		: section.threads;
	const hiddenCount = section.threads.length - visible.length;

	return (
		<div>
			{section.label && (
				<button
					type="button"
					aria-expanded={!collapsed}
					onClick={() => setCollapsed((v) => !v)}
					className="sticky top-0 z-10 flex h-section-row w-full items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left transition-colors hover:bg-surface"
				>
					<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						{section.label}
					</span>
					<span className="text-2xs text-fg-subtle tabular-nums">
						{section.threads.length}
					</span>
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
					{overCap && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							className="flex w-full items-center justify-center border-b border-line px-row-inset py-1.5 text-2xs font-medium text-accent transition-colors hover:bg-surface"
						>
							{expanded ? "Show less" : `Show ${hiddenCount} more`}
							{!expanded && <ChevronDown className="ml-1 size-3" />}
						</button>
					)}
				</>
			)}
		</div>
	);
}
