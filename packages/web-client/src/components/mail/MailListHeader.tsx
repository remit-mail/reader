/**
 * MailListHeader — the header-only list-pane shell shared by every list view.
 *
 * Composes the kit `MailHeader` (hamburger + title + unread + search) and the
 * `<section>` column shell with an optional pinned footer. It owns no filter
 * surface: the daily brief lets the kit `BriefSections` own the filter row,
 * while `MailViewChrome` slots a `FilterSheet` into the body for the inbox /
 * flagged views.
 *
 * Search comes from `MailContext` (one source of truth, mirrored to the URL).
 * The hamburger opens the nav drawer via the enclosing `AppShellSlotted`.
 */
import { MailHeader, useAppShellLayout } from "@remit/ui";
import { type ReactNode, useState } from "react";
import { useMailContext } from "@/lib/mail-context";

interface MailListHeaderProps {
	title: string;
	unreadCount: number;
	/** The list body (filter sheet / sections / virtualized rows). */
	children: ReactNode;
	/** Pinned below the scrollable list (e.g. the keyboard hint bar). */
	footer?: ReactNode;
}

export function MailListHeader({
	title,
	unreadCount,
	children,
	footer,
}: MailListHeaderProps) {
	const { searchInput, onSearchChange, onSearchClear } = useMailContext();
	const layout = useAppShellLayout();
	const [searchOpen, setSearchOpen] = useState(false);

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
			<div className="min-h-0 flex-1">{children}</div>
			{footer}
		</section>
	);
}
