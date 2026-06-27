/**
 * MailViewChrome — the shared list-pane chrome for the daily brief and inboxes.
 *
 * Composes the kit `MailHeader` (hamburger + title + unread + search) with the
 * `FilterSheet` expando directly beneath it, exactly as the kit story does. The
 * caller supplies the filter preset (`briefFilterConfig` / `inboxFilterConfig`)
 * and owns the category / attribute / source selection state; this component
 * only wires the header, search, nav drawer, and the expand/search-open UI.
 *
 * Search comes from `MailContext` (one source of truth, mirrored to the URL).
 * The hamburger opens the nav drawer via the enclosing `AppShellSlotted`.
 */
import {
	type FilterPreset,
	FilterSheet,
	MailHeader,
	useAppShellLayout,
} from "@remit/ui";
import { type ReactNode, useState } from "react";
import { useMailContext } from "@/lib/mail-context";

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
	const { searchInput, onSearchChange, onSearchClear } = useMailContext();
	const layout = useAppShellLayout();
	const [searchOpen, setSearchOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			<MailHeader
				title={title}
				unreadCount={unreadCount}
				// The list pane is narrow even on desktop, and the reading-pane
				// toolbar owns the wide search; keep the header's search compact (a
				// magnifier that expands over the title) at every width.
				isDesktop={false}
				onMenuClick={() => layout?.openNav()}
				searchValue={searchInput}
				onSearchChange={onSearchChange}
				onSearchClear={onSearchClear}
				searchOpen={searchOpen}
				onSearchOpenChange={setSearchOpen}
			/>
			<div className="min-h-0 flex-1">
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
			</div>
			{footer}
		</section>
	);
}
