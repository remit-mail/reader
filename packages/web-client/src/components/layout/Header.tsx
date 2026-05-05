import { Link, useLocation } from "@tanstack/react-router";
import { Mail, Menu, Search, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SignOutMenuItem } from "../../auth/SignOutMenuItem";
import { cn } from "../../lib/utils";
import { SearchBar } from "./SearchBar";

interface HeaderProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	onSearchClear: () => void;
	/**
	 * Optional handler for the menu (hamburger) button. When provided, the
	 * button calls this instead of opening the in-Header dropdown — used on
	 * mobile to open a full-screen drawer hosted by the parent layout.
	 */
	onMenuClick?: () => void;
	/**
	 * Mobile-only label shown next to the hamburger in place of the static
	 * "Remit" branding. Pass the current inbox/folder name so the top bar
	 * acts as orientation. Falls back to "Remit" when omitted or null
	 * (e.g. mid-redirect with no selected mailbox). Desktop always shows
	 * "Remit".
	 */
	mobileTitle?: string | null;
}

export const Header = ({
	searchQuery,
	onSearchChange,
	onSearchClear,
	onMenuClick,
	mobileTitle,
}: HeaderProps) => {
	const [menuOpen, setMenuOpen] = useState(false);
	const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const location = useLocation();

	// Close dropdown on click outside (only used when no external onMenuClick)
	useEffect(() => {
		if (onMenuClick) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onMenuClick]);

	// Close menu / mobile search on navigation
	useEffect(() => {
		setMenuOpen(false);
		setMobileSearchOpen(false);
	}, [location.pathname]);

	const handleMenuButton = () => {
		if (onMenuClick) {
			onMenuClick();
			return;
		}
		setMenuOpen((prev) => !prev);
	};

	return (
		<header className="flex items-center gap-2 sm:gap-4 px-2 sm:px-4 h-12 border-b border-border bg-background shrink-0">
			{/* Left: Branding + hamburger */}
			<div className="relative" ref={menuRef}>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						onClick={handleMenuButton}
						className="p-2 rounded-md hover:bg-accent transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
						aria-label="Menu"
						aria-expanded={onMenuClick ? undefined : menuOpen}
					>
						<Menu className="size-5" />
					</button>
					{/* Mobile (<md): show the current inbox name when known so the
					    top bar reads as orientation. Falls back to "Remit" when
					    no inbox is resolved (e.g. /mail mid-redirect) and on
					    desktop, where branding is preferred. */}
					<span className="font-semibold text-foreground md:hidden truncate max-w-[55vw]">
						{mobileTitle ?? "Remit"}
					</span>
					<span className="font-semibold text-foreground hidden md:inline">
						Remit
					</span>
				</div>

				{/* Desktop dropdown menu (only when no external onMenuClick) */}
				{!onMenuClick && menuOpen && (
					<div className="absolute top-full left-0 mt-1 w-48 bg-background border border-border rounded-md shadow-lg z-50">
						<nav className="py-1">
							<Link
								to="/mail"
								className={cn(
									"flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent",
									location.pathname.startsWith("/mail") && "bg-accent",
								)}
							>
								<Mail className="size-4" />
								Mail
							</Link>
							<div className="border-t border-border my-1" />
							<Link
								to="/settings/accounts"
								className={cn(
									"flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent",
									location.pathname.startsWith("/settings") && "bg-accent",
								)}
							>
								<Settings className="size-4" />
								Settings
							</Link>
							<SignOutMenuItem variant="dropdown" showEmail />
						</nav>
					</div>
				)}
			</div>

			{/* Center: Search bar (inline ≥ sm, expanding overlay < sm) */}
			<div className="flex-1 max-w-xl mx-auto hidden sm:block">
				<SearchBar
					value={searchQuery}
					onChange={onSearchChange}
					onClear={onSearchClear}
				/>
			</div>

			{/* Mobile: search-icon toggle */}
			<div className="flex-1 sm:hidden">
				{mobileSearchOpen ? (
					<div className="flex items-center gap-1">
						<div className="flex-1">
							<SearchBar
								value={searchQuery}
								onChange={onSearchChange}
								onClear={onSearchClear}
							/>
						</div>
						<button
							type="button"
							onClick={() => setMobileSearchOpen(false)}
							className="p-2 rounded-md hover:bg-accent transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
							aria-label="Close search"
						>
							<X className="size-5" />
						</button>
					</div>
				) : (
					<div className="flex justify-end">
						<button
							type="button"
							onClick={() => setMobileSearchOpen(true)}
							className="p-2 rounded-md hover:bg-accent transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
							aria-label="Search"
						>
							<Search className="size-5" />
						</button>
					</div>
				)}
			</div>

			{/* Right: Settings (visible on every viewport now that the
			    mobile bottom nav has been removed). */}
			<div className="flex items-center gap-2 shrink-0">
				<Link
					to="/settings/accounts"
					className="p-2 rounded-md hover:bg-accent transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
					aria-label="Settings"
				>
					<Settings className="size-5" />
				</Link>
			</div>
		</header>
	);
};
