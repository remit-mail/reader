import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Kbd } from "./kbd.js";

export interface ReadingPaneEmptyProps {
	/** Headline. */
	message?: string;
	/** Override the centered icon. */
	icon?: ReactNode;
	/** Hide the keyboard hint line (e.g. on touch surfaces). */
	showHints?: boolean;
	className?: string;
}

/**
 * The reading pane's zero-state: a centered Inbox icon, a prompt, and the
 * j/k/Enter navigation hints. One source of truth for both the brief and the
 * mailbox routes (they used to drift between a bare text EmptyState and the
 * designed treatment).
 */
export function ReadingPaneEmpty({
	message = "Select a thread to read",
	icon,
	showHints = true,
	className,
}: ReadingPaneEmptyProps) {
	return (
		<div
			className={cn(
				"flex flex-1 flex-col items-center justify-center text-center",
				className,
			)}
		>
			{icon ?? <Inbox className="size-10 text-fg-subtle" />}
			<p className="mt-3 text-sm text-fg-muted">{message}</p>
			{showHints && (
				<p className="text-2xs text-fg-subtle">
					<Kbd>j</Kbd> / <Kbd>k</Kbd> to move, <Kbd>Enter</Kbd> to open
				</p>
			)}
		</div>
	);
}
