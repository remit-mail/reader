import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface AppTopBarProps {
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
 * The application top bar: one row over the list, reading and intelligence
 * panes, carrying search and the global actions.
 *
 * Search sits here rather than over the message list because it is not the
 * list's search — it reads across the whole app, and the bar's span is what
 * says so. It starts on the list's left edge: the nav column runs the full
 * height beside the bar rather than under it, so the field lines up with the
 * columns it searches. The search field takes the room it needs, then the
 * global actions.
 *
 * Presentational and slot-driven; the host supplies the wired field and
 * action controls.
 */
export function AppTopBar({ search, actions, className }: AppTopBarProps) {
	return (
		<header
			className={cn(
				// min-h, not a fixed height: the search field grows when its chips
				// wrap onto a second line.
				"flex min-h-16 w-full shrink-0 items-center gap-3 border-b border-line bg-canvas px-3 py-2",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 justify-start">
				<div className="w-full max-w-2xl">{search}</div>
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-1">{actions}</div>
			)}
		</header>
	);
}
