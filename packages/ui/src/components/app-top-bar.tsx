import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface AppTopBarProps {
	/**
	 * Controls at the bar's left edge, over the nav column — the nav toggle.
	 * Anything that acts on the shell itself rather than on the mail in it.
	 */
	leading?: ReactNode;
	/**
	 * The search field. Spans the bar's middle and is the only thing that
	 * grows, so the bar reads as one search surface for the whole app.
	 */
	search: ReactNode;
	/**
	 * Global actions — compose, feedback, avatar. Actions that belong to the
	 * app rather than to whatever is currently listed or open; message-context
	 * verbs live in the message pane's own toolbar, under this bar.
	 */
	actions?: ReactNode;
	className?: string;
}

/**
 * The application top bar: one row across the top of the shell, over the nav,
 * list, reading and intelligence panes, carrying search and the global actions.
 *
 * Search sits here rather than over the message list because it is not the
 * list's search — it reads across the whole app, and the bar's span is what
 * says so. The search field takes the room it needs, then the global actions.
 *
 * Presentational and slot-driven; the host supplies the wired field and
 * action controls.
 */
export function AppTopBar({
	leading,
	search,
	actions,
	className,
}: AppTopBarProps) {
	return (
		<header
			className={cn(
				// min-h, not a fixed height: the search field grows when its chips
				// wrap onto a second line.
				"flex min-h-pane-header w-full shrink-0 items-center gap-2 border-b border-line bg-canvas px-row-inset py-1",
				className,
			)}
		>
			{leading && (
				<div className="flex shrink-0 items-center gap-1">{leading}</div>
			)}
			<div className="flex min-w-0 flex-1 justify-start">
				{/* Resting width is enough to read a query back, not enough to make an
				    empty field the loudest thing in the bar; focus widens it to where
				    a long query and its chips still fit on one line. */}
				<div className="w-full max-w-xs transition-[max-width] duration-150 ease-out focus-within:max-w-lg">
					{search}
				</div>
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-1">{actions}</div>
			)}
		</header>
	);
}
