import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ThreadSection } from "./app-shell-types.js";
import type { BriefRowComponent } from "./message-row.js";

/** Rows shown before the "Show N more" expander kicks in. */
export const SECTION_ROW_CAP = 10;

export interface BriefSectionProps {
	section: ThreadSection;
	Row: BriefRowComponent;
	selectedThreadId?: string;
	/** Seed the expanded state — lets a story / SSR render the expanded view. */
	initialExpanded?: boolean;
	onSelectThread?: (id: string) => void;
}

/**
 * One brief section: a sticky category label, the first {@link SECTION_ROW_CAP}
 * rows, and a "Show N more" control that reveals the rest in place (toggling
 * back to "Show less"). The control is always tappable — it never disables.
 *
 * Owns only its own expand state; the parent supplies the grouped section and a
 * `Row` renderer so the live brief and the Storybook prototype stay in lockstep.
 */
export function BriefSection({
	section,
	Row,
	selectedThreadId,
	initialExpanded = false,
	onSelectThread,
}: BriefSectionProps) {
	const [expanded, setExpanded] = useState(initialExpanded);

	const overCap = section.threads.length > SECTION_ROW_CAP;
	const capped = !expanded && overCap;
	const visible = capped
		? section.threads.slice(0, SECTION_ROW_CAP)
		: section.threads;
	const hiddenCount = section.threads.length - visible.length;

	return (
		<div>
			{section.label && (
				<div className="sticky top-0 flex h-section-row w-full items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left">
					<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						{section.label}
					</span>
					<span className="text-2xs text-fg-subtle tabular-nums">
						{section.threads.length}
					</span>
				</div>
			)}
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
		</div>
	);
}
