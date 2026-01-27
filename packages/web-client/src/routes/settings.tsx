import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import {
	ArrowLeft,
	Mail,
	Menu,
	Settings as SettingsIcon,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
	{ path: "/settings/accounts", label: "Accounts", icon: Users },
	{ path: "/settings/general", label: "General", icon: SettingsIcon },
];

export const Route = createFileRoute("/settings")({
	component: SettingsLayout,
});

function SettingsLayout() {
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
		<div className="h-screen flex flex-col bg-background">
			{/* Header with hamburger menu */}
			<header className="flex items-center gap-4 px-4 h-12 border-b border-border bg-background shrink-0">
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
									<SettingsIcon className="size-4" />
									Settings
								</Link>
							</nav>
						</div>
					)}
				</div>
			</header>

			<div className="flex flex-1 overflow-hidden">
				{/* Settings navigation sidebar */}
				<aside className="w-48 border-r border-border p-4">
					{/* Back to inbox link */}
					<Link
						to="/mail"
						className="flex items-center gap-2 px-3 py-2 mb-4 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
					>
						<ArrowLeft className="size-4" />
						Back to Inbox
					</Link>

					<h2 className="text-xs font-semibold text-muted-foreground uppercase mb-4">
						Settings
					</h2>
					<nav className="space-y-1">
						{navItems.map(({ path, label, icon: Icon }) => (
							<Link
								key={path}
								to={path}
								className={cn(
									"flex items-center gap-2 px-3 py-2 rounded-md text-sm",
									location.pathname === path
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-accent/50",
								)}
							>
								<Icon className="size-4" />
								{label}
							</Link>
						))}
					</nav>
				</aside>

				{/* Settings content area */}
				<main className="flex-1 overflow-auto p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
