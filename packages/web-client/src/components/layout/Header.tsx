import { Link, useLocation } from "@tanstack/react-router";
import { Mail, Menu, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { SearchBar } from "./SearchBar";

interface HeaderProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	onSearchClear: () => void;
}

export const Header = ({
	searchQuery,
	onSearchChange,
	onSearchClear,
}: HeaderProps) => {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const location = useLocation();

	// Close menu on click outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Close menu on navigation
	useEffect(() => {
		setMenuOpen(false);
	}, [location.pathname]);

	return (
		<header className="flex items-center gap-4 px-4 h-12 border-b border-border bg-background shrink-0">
			{/* Left: App branding with menu */}
			<div className="relative" ref={menuRef}>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						onClick={() => setMenuOpen(!menuOpen)}
						className="p-1.5 rounded-md hover:bg-accent transition-colors"
						aria-label="Menu"
						aria-expanded={menuOpen}
					>
						<Menu className="size-5" />
					</button>
					<span className="font-semibold text-foreground">Remit</span>
				</div>

				{/* Dropdown menu */}
				{menuOpen && (
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
						</nav>
					</div>
				)}
			</div>

			{/* Center: Search bar */}
			<div className="flex-1 max-w-xl mx-auto">
				<SearchBar
					value={searchQuery}
					onChange={onSearchChange}
					onClear={onSearchClear}
				/>
			</div>

			{/* Right: Settings */}
			<div className="flex items-center gap-2 shrink-0">
				<Link
					to="/settings/accounts"
					className="p-1.5 rounded-md hover:bg-accent transition-colors"
					aria-label="Settings"
				>
					<Settings className="size-5" />
				</Link>
			</div>
		</header>
	);
};
