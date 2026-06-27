import { Menu, Search, X } from "lucide-react";
import { Button } from "./button.js";
import { SearchBar } from "./search-bar.js";

export interface MailHeaderProps {
	/** Top-row title — the view name, e.g. "Daily brief" or "Inbox". */
	title: string;
	/** Unread count shown beside the title, e.g. 15338 → "15,338 unread". */
	unreadCount: number;
	/**
	 * Container-derived ≥1024 desktop tier. Desktop renders the search bar
	 * inline; below it search collapses to a magnifier that expands over the
	 * title (mirrors the live mobile header).
	 */
	isDesktop: boolean;
	/** Opens the app navigation drawer (hamburger). */
	onMenuClick?: () => void;
	searchValue: string;
	onSearchChange: (value: string) => void;
	/** Full clear (X). Falls back to clearing the value. */
	onSearchClear?: () => void;
	/** Mobile only: whether the inline search is expanded over the title. */
	searchOpen: boolean;
	onSearchOpenChange: (open: boolean) => void;
}

/**
 * The shared mail header used across views — the daily brief and each inbox.
 * Just the top row: hamburger + title + unread count + search. The view's
 * filter (categories, attributes, and — for the aggregate brief — accounts)
 * lives in the FilterSheet bar the consumer renders directly below this header;
 * fast account switching is the nav sidebar, so there is no account chip row
 * here. Search adapts to the tier — inline on desktop, a magnifier that expands
 * the bar over the title on mobile. Open state is controlled so stories and the
 * route can drive it.
 */
export function MailHeader({
	title,
	unreadCount,
	isDesktop,
	onMenuClick,
	searchValue,
	onSearchChange,
	onSearchClear,
	searchOpen,
	onSearchOpenChange,
}: MailHeaderProps) {
	const unreadLabel = `${unreadCount.toLocaleString()} unread`;
	const clearSearch = onSearchClear ?? (() => onSearchChange(""));

	const searchBar = (
		<SearchBar
			value={searchValue}
			onChange={onSearchChange}
			onClear={clearSearch}
			globalFocusKey={false}
		/>
	);

	const menuButton = (
		<Button
			variant="ghost"
			icon={<Menu className="size-5" />}
			onClick={onMenuClick}
			aria-label="Menu"
			className="min-h-11 min-w-11 shrink-0 px-0"
		/>
	);

	return (
		<header className="flex shrink-0 flex-col bg-canvas">
			<div className="flex h-12 items-center gap-2 px-row-inset">
				{isDesktop ? (
					<>
						{menuButton}
						<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
							{title}
						</h1>
						<span className="shrink-0 text-2xs text-fg-subtle">
							{unreadLabel}
						</span>
						<div className="w-64 max-w-[40%] shrink-0">{searchBar}</div>
					</>
				) : searchOpen ? (
					<div className="flex flex-1 items-center gap-1">
						<div className="flex-1">{searchBar}</div>
						<Button
							variant="ghost"
							icon={<X className="size-5" />}
							onClick={() => onSearchOpenChange(false)}
							aria-label="Close search"
							className="min-h-11 min-w-11 shrink-0 px-0"
						/>
					</div>
				) : (
					<>
						{menuButton}
						<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
							{title}
						</h1>
						<span className="shrink-0 text-2xs text-fg-subtle">
							{unreadLabel}
						</span>
						<Button
							variant="ghost"
							icon={<Search className="size-5" />}
							onClick={() => onSearchOpenChange(true)}
							aria-label="Search"
							className="min-h-11 min-w-11 shrink-0 px-0"
						/>
					</>
				)}
			</div>
		</header>
	);
}
