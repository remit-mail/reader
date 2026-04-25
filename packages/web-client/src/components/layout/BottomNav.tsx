import { Link, useLocation } from "@tanstack/react-router";
import { Inbox, Send, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
	hidden?: boolean;
}

const items = [
	{ to: "/mail", label: "Mail", icon: Inbox, match: /^\/mail(?!\/outbox)/ },
	{ to: "/mail/outbox", label: "Outbox", icon: Send, match: /^\/mail\/outbox/ },
	{
		to: "/settings/accounts",
		label: "Settings",
		icon: Settings,
		match: /^\/settings/,
	},
] as const;

/**
 * Bottom navigation bar shown only on mobile (`< md`). Three primary
 * destinations matching the Material 3 navigation-bar pattern.
 *
 * Auto-hides when reading a thread (`?selectedMessageId=…` in the URL),
 * so the conversation's sticky action bar (Reply / Reply all / Forward)
 * doesn't fight for the bottom of the screen. Pass `hidden={true}` to
 * force-hide for callers that have other reasons to suppress it.
 */
export const BottomNav = ({ hidden = false }: BottomNavProps) => {
	const location = useLocation();
	const search = location.search as Record<string, unknown> | undefined;
	const isReadingThread =
		typeof search?.selectedMessageId === "string" &&
		search.selectedMessageId.length > 0;

	if (hidden || isReadingThread) return null;

	return (
		<nav
			aria-label="Primary"
			className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border h-14 flex items-stretch"
			style={{ paddingBottom: "env(safe-area-inset-bottom, 0)" }}
		>
			{items.map(({ to, label, icon: Icon, match }) => {
				const active = match.test(location.pathname);
				return (
					<Link
						key={to}
						to={to}
						className={cn(
							"flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors",
							"text-xs font-medium min-h-11",
							active
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						aria-current={active ? "page" : undefined}
					>
						<Icon className={cn("size-5", active && "text-primary")} />
						<span>{label}</span>
					</Link>
				);
			})}
		</nav>
	);
};
