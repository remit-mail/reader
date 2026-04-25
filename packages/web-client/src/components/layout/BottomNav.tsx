import { Link, useLocation } from "@tanstack/react-router";
import {
	ArrowLeft,
	Forward,
	Inbox,
	Reply,
	ReplyAll,
	Send,
	Settings,
} from "lucide-react";
import { useThreadActions } from "@/components/mail/ThreadActionsContext";
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

const navBarClass =
	"md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t border-border h-14 flex items-stretch";
const navBarStyle = { paddingBottom: "env(safe-area-inset-bottom, 0)" };

interface ThreadActionBarProps {
	onBack: () => void;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	disabled?: boolean;
}

const navButtonClass =
	"flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors text-xs font-medium min-h-11 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground";

const ThreadActionBar = ({
	onBack,
	onReply,
	onReplyAll,
	onForward,
	disabled,
}: ThreadActionBarProps) => (
	<nav aria-label="Thread actions" className={navBarClass} style={navBarStyle}>
		<button
			type="button"
			onClick={onBack}
			className={cn(navButtonClass, "text-foreground")}
			aria-label="Back to messages"
		>
			<ArrowLeft className="size-5" />
			<span>Back</span>
		</button>
		{onReply && (
			<button
				type="button"
				onClick={onReply}
				disabled={disabled}
				className={navButtonClass}
				aria-label="Reply"
			>
				<Reply className="size-5" />
				<span>Reply</span>
			</button>
		)}
		{onReplyAll && (
			<button
				type="button"
				onClick={onReplyAll}
				disabled={disabled}
				className={navButtonClass}
				aria-label="Reply all"
			>
				<ReplyAll className="size-5" />
				<span>Reply all</span>
			</button>
		)}
		{onForward && (
			<button
				type="button"
				onClick={onForward}
				disabled={disabled}
				className={navButtonClass}
				aria-label="Forward"
			>
				<Forward className="size-5" />
				<span>Forward</span>
			</button>
		)}
	</nav>
);

/**
 * Bottom navigation bar shown only on mobile (`< md`). Context-aware:
 *   - Default: three primary destinations (Mail / Outbox / Settings),
 *     matching Material 3's navigation-bar pattern.
 *   - While reading a thread (a `ThreadActions` is published into
 *     `ThreadActionsContext`): swaps to thread-level actions (Back,
 *     Reply, Reply all, Forward).
 *
 * Pass `hidden={true}` to force-hide for callers that have other
 * reasons to suppress it.
 */
export const BottomNav = ({ hidden = false }: BottomNavProps) => {
	const location = useLocation();
	const threadActions = useThreadActions();

	if (hidden) return null;

	if (threadActions) {
		return (
			<ThreadActionBar
				onBack={threadActions.onBack}
				onReply={threadActions.onReply}
				onReplyAll={threadActions.onReplyAll}
				onForward={threadActions.onForward}
				disabled={threadActions.disabled}
			/>
		);
	}

	return (
		<nav aria-label="Primary" className={navBarClass} style={navBarStyle}>
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
