import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface AppTopBarProps {
	/**
	 * Leading slot — the brand mark, and on narrow widths the nav trigger.
	 * Sits over the nav column, so keep it to the nav pane's width budget.
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
 * The application top bar: one full-width row above every pane, carrying
 * search and the global actions.
 *
 * Search sits here rather than over the message list because it is not the
 * list's search — it reads across the whole app, and the bar's width is what
 * says so. The layout follows Gmail's: leading brand/nav, a wide centred
 * search field, global actions trailing.
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
				"flex h-16 w-full shrink-0 items-center gap-3 border-b border-line bg-canvas px-3",
				className,
			)}
		>
			{leading && (
				<div className="flex shrink-0 items-center gap-2">{leading}</div>
			)}
			<div className="flex min-w-0 flex-1 justify-start">
				<div className="w-full max-w-2xl">{search}</div>
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-1">{actions}</div>
			)}
		</header>
	);
}
