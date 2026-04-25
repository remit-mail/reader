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
import { BottomNav } from "@/components/layout/BottomNav";
import { Drawer } from "@/components/layout/Drawer";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const navItems = [
	{ path: "/settings/accounts", label: "Accounts", icon: Users },
];

export const Route = createFileRoute("/settings")({
	component: SettingsLayout,
});

const SettingsNav = ({ pathname }: { pathname: string }) => (
	<nav className="space-y-1 p-4">
		<Link
			to="/mail"
			className="flex items-center gap-2 px-3 py-2 mb-4 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground min-h-11"
		>
			<ArrowLeft className="size-4" />
			Back to Inbox
		</Link>

		<h2 className="text-xs font-semibold text-muted-foreground uppercase mb-4 px-3">
			Settings
		</h2>
		<div className="space-y-1">
			{navItems.map(({ path, label, icon: Icon }) => (
				<Link
					key={path}
					to={path}
					className={cn(
						"flex items-center gap-2 px-3 py-2 rounded-md text-sm min-h-11",
						pathname === path
							? "bg-accent text-accent-foreground"
							: "text-muted-foreground hover:bg-accent/50",
					)}
				>
					<Icon className="size-4" />
					{label}
				</Link>
			))}
		</div>
	</nav>
);

function SettingsLayout() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const location = useLocation();
	const isDesktop = useIsDesktop();

	// Close desktop dropdown on click outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Close menu / drawer on navigation
	useEffect(() => {
		setMenuOpen(false);
		setDrawerOpen(false);
	}, [location.pathname]);

	const handleHamburger = () => {
		if (isDesktop) {
			setMenuOpen((prev) => !prev);
			return;
		}
		setDrawerOpen(true);
	};

	return (
		<div className="h-screen flex flex-col bg-background">
			{/* Header with hamburger */}
			<header className="flex items-center gap-2 sm:gap-4 px-2 sm:px-4 h-12 border-b border-border bg-background shrink-0">
				<div className="relative" ref={menuRef}>
					<div className="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onClick={handleHamburger}
							className="p-2 rounded-md hover:bg-accent transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
							aria-label="Menu"
							aria-expanded={isDesktop ? menuOpen : undefined}
						>
							<Menu className="size-5" />
						</button>
						<span className="font-semibold text-foreground">Remit</span>
					</div>

					{/* Desktop dropdown menu */}
					{isDesktop && menuOpen && (
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
				{/* Desktop: persistent settings nav aside */}
				{isDesktop ? (
					<aside className="w-48 border-r border-border shrink-0">
						<SettingsNav pathname={location.pathname} />
					</aside>
				) : null}

				{/* Settings content area */}
				<main
					className="flex-1 overflow-auto p-4 sm:p-6"
					style={{
						paddingBottom: isDesktop
							? undefined
							: "calc(3.5rem + env(safe-area-inset-bottom, 0))",
					}}
				>
					<Outlet />
				</main>
			</div>

			{/* Mobile drawer hosts the settings sub-nav */}
			<Drawer
				isOpen={drawerOpen}
				onClose={() => setDrawerOpen(false)}
				ariaLabel="Settings navigation"
			>
				<SettingsNav pathname={location.pathname} />
			</Drawer>

			{/* Bottom nav (mobile only) */}
			<BottomNav />
		</div>
	);
}
