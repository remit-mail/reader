import type { ReactNode } from "react";

export interface PaneHeaderProps {
	/** The pane's title, e.g. "Drafts" or "Outbox". */
	title: string;
	/** Rendered before the title — a nav-menu button, back arrow, etc. */
	leading?: ReactNode;
	/** Rendered after the title — an unread count, item count, etc. */
	trailing?: ReactNode;
}

/**
 * The plain datum-bar header a list pane uses when it isn't the shared
 * `MailHeader` (no search, no filter) — drafts, outbox, and similar
 * single-purpose panes that render their own header row.
 */
export function PaneHeader({ title, leading, trailing }: PaneHeaderProps) {
	return (
		<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
			{leading}
			<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
				{title}
			</h1>
			{trailing}
		</header>
	);
}
