/**
 * MailViewChrome — the shared list-pane chrome for the inbox and flagged views.
 *
 * Wraps the header-only `MailListHeader` and slots the `FilterSheet` expando
 * directly into its body, exactly as the kit story does. The caller supplies the
 * filter preset (`inboxFilterConfig` / `flaggedFilterConfig`) and owns the
 * category / attribute / source selection state.
 *
 * The daily brief no longer uses this: it composes `MailListHeader` with the kit
 * `BriefSections`, which owns its own filter row (so there is exactly one filter
 * surface and the section headers flatten correctly when filtered).
 */
import { type FilterPreset, FilterSheet } from "@remit/ui";
import { type ReactNode, useState } from "react";
import { MailListHeader } from "./MailListHeader";

interface MailViewChromeProps {
	title: string;
	unreadCount: number;
	preset: FilterPreset;
	selectedCategory: string;
	activeFilters: ReadonlySet<string>;
	onSelectCategory: (id: string) => void;
	onToggleFilter: (id: string) => void;
	onSelectSource?: (id: string) => void;
	onClearFilters: () => void;
	/** The list body (sections / virtualized rows) rendered inside the expando. */
	children: ReactNode;
	/** Pinned below the scrollable list (e.g. the keyboard hint bar). */
	footer?: ReactNode;
}

export function MailViewChrome({
	title,
	unreadCount,
	preset,
	selectedCategory,
	activeFilters,
	onSelectCategory,
	onToggleFilter,
	onSelectSource,
	onClearFilters,
	children,
	footer,
}: MailViewChromeProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<MailListHeader title={title} unreadCount={unreadCount} footer={footer}>
			<FilterSheet
				categories={preset.categories}
				filters={preset.filters}
				sources={preset.sources}
				selectedCategory={selectedCategory}
				activeFilters={activeFilters}
				expanded={expanded}
				onExpandedChange={setExpanded}
				onSelectCategory={onSelectCategory}
				onSelectSource={onSelectSource}
				onToggleFilter={onToggleFilter}
				onClear={onClearFilters}
			>
				{children}
			</FilterSheet>
		</MailListHeader>
	);
}
