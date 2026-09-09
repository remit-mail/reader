import { AppShellSlotted } from "@remit/ui";
import { createContext, type ReactNode, useContext } from "react";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";

/**
 * The chrome the calendar shares with mail, published by the `/calendar` layout
 * and consumed by the view route that mounts the shell.
 *
 * It lives in a module reached only through the `@/` alias for the same reason
 * `lib/mail-context.ts` does: the generated route tree imports route files
 * relatively, so a context declared inside one would resolve to a second module
 * instance and hand the consumer an empty default.
 */
export interface CalendarShellChrome {
	/** Below the reading boundary the shell shows one pane, as mail's does. */
	isSinglePane: boolean;
	isLoading: boolean;
	nav: ReactNode;
	navOpen: boolean;
	onOpenNav: () => void;
	onCloseNav: () => void;
}

const CalendarShellCtx = createContext<CalendarShellChrome | null>(null);

export const CalendarShellProvider = ({
	chrome,
	children,
}: {
	chrome: CalendarShellChrome;
	children: ReactNode;
}) => (
	<CalendarShellCtx.Provider value={chrome}>
		{children}
	</CalendarShellCtx.Provider>
);

export interface CalendarShellProps {
	/** The grid, or whatever the current zoom draws. */
	workspace: ReactNode;
	/** The open event, from the route below this one. */
	reading: ReactNode;
	/** Whether the address has an event or the composer open. */
	hasOpenEvent: boolean;
}

/**
 * The shell the calendar mounts around its own panes.
 *
 * `listBias="list"` because the grid is the work rather than an index into it:
 * a week of columns costs width it cannot give back when a detail opens, which
 * is the opposite of the split a message list wants.
 *
 * Below the reading boundary there is one pane, so the open event replaces the
 * grid in it — the same swap mail makes, read off the address rather than
 * decided here.
 */
export function CalendarShell({
	workspace,
	reading,
	hasOpenEvent,
}: CalendarShellProps) {
	const chrome = useContext(CalendarShellCtx);
	if (!chrome) return <AppShellSkeleton />;

	const shared = {
		nav: chrome.nav,
		skeleton: <AppShellSkeleton />,
		isLoading: chrome.isLoading,
		navOpen: chrome.navOpen,
		onOpenNav: chrome.onOpenNav,
		onCloseNav: chrome.onCloseNav,
		listBias: "list" as const,
	};

	if (chrome.isSinglePane) {
		return (
			<AppShellSlotted {...shared} list={hasOpenEvent ? reading : workspace} />
		);
	}

	return <AppShellSlotted {...shared} list={workspace} reading={reading} />;
}
