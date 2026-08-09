import type { ReactNode } from "react";

export interface SectionHeaderProps {
	/** Optional glyph shown before the label. */
	icon?: ReactNode;
	label: string;
	count: number;
}

/**
 * Sticky label + count bar above a group of rows — the drafts pane's two
 * segments ("Not yet sent", "On the server") and any similar labeled
 * sub-list that isn't the collapsible `BriefSection`.
 */
export function SectionHeader({ icon, label, count }: SectionHeaderProps) {
	return (
		<div className="sticky top-0 z-10 flex h-section-row items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset">
			{icon && <span className="text-fg-subtle">{icon}</span>}
			<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</span>
			<span className="text-2xs tabular-nums text-fg-subtle">{count}</span>
		</div>
	);
}
