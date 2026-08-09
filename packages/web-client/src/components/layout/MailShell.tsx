import { AppShellSlotted } from "@remit/ui";
import { createContext, type ReactNode, useContext } from "react";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";

/**
 * The chrome every list shares, published by the `/mail` layout and consumed by
 * the list route that mounts the shell.
 *
 * It lives in a module reached only through the `@/` alias for the same reason
 * `lib/mail-context.ts` does: the generated route tree imports route files
 * relatively, so a context declared inside one of them can resolve to a second
 * module instance and hand the consumer an empty default.
 */
export interface MailShellChrome {
	/**
	 * Below the reading boundary (phone AND tablet) the shell shows one pane, so
	 * the list route mounts its phone view instead of the slotted panes.
	 */
	isSinglePane: boolean;
	isLoading: boolean;
	intelligenceOpen: boolean;
	nav: ReactNode;
	topBar: ReactNode;
	overlay: ReactNode;
	navOpen: boolean;
	onOpenNav: () => void;
	onCloseNav: () => void;
}

const MailShellCtx = createContext<MailShellChrome | null>(null);

export const MailShellProvider = ({
	chrome,
	children,
}: {
	chrome: MailShellChrome;
	children: ReactNode;
}) => <MailShellCtx.Provider value={chrome}>{children}</MailShellCtx.Provider>;

export interface MailShellProps {
	/** The single pane, list and open thread both, below the reading boundary. */
	phone: ReactNode;
	list: ReactNode;
	reading: ReactNode;
	intelligence?: ReactNode;
	/** Whether the reading pane has a thread — the intelligence rail needs one. */
	hasThread?: boolean;
}

/**
 * The shell a list route mounts around its own panes.
 *
 * Below the reading boundary the shell is one pane and takes `phone`, which
 * swaps between the list and whatever is open in place. Above it the panes sit
 * side by side and the reading and intelligence slots are filled.
 */
export function MailShell({
	phone,
	list,
	reading,
	intelligence,
	hasThread = false,
}: MailShellProps) {
	const chrome = useContext(MailShellCtx);
	if (!chrome) return <AppShellSkeleton />;

	const shared = {
		nav: chrome.nav,
		overlay: chrome.overlay,
		skeleton: <AppShellSkeleton />,
		isLoading: chrome.isLoading,
		navOpen: chrome.navOpen,
		onOpenNav: chrome.onOpenNav,
		onCloseNav: chrome.onCloseNav,
	};

	if (chrome.isSinglePane) {
		return (
			<AppShellSlotted
				{...shared}
				list={phone}
				intelligenceOpen={chrome.intelligenceOpen}
			/>
		);
	}

	return (
		<AppShellSlotted
			{...shared}
			topBar={chrome.topBar}
			list={list}
			reading={reading}
			intelligence={intelligence}
			intelligenceOpen={chrome.intelligenceOpen}
			hasThread={hasThread}
		/>
	);
}
