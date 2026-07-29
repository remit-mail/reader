import { createContext, type ReactNode, useContext } from "react";

/**
 * The list header's own chrome, as rendered nodes.
 *
 * The list header and the selection bar are one surface (#480), so the nav
 * button, the unread count and the search affordance belong on the same row as
 * the count and the verbs. That row is rendered by the body — the list owns the
 * selection — while the search state it needs belongs to `MailListHeader`.
 * Handing the built nodes down keeps one definition of the chrome and keeps the
 * bar's two states in the same commit: nothing here is derived from a state
 * update that lands after paint.
 */
export interface ListHeaderChrome {
	/** The view's name, carried while nothing is ticked. */
	title: string;
	/** Hamburger for the nav slide-over; absent where the nav is a pane. */
	navSlot: ReactNode;
	/** Unread count, beside the title. */
	titleMeta: ReactNode;
	/** Magnifier that opens search, on the tiers whose header owns a field. */
	searchSlot: ReactNode;
	/** The expanded field, which takes the title's place for as long as it is up. */
	searchField: ReactNode;
}

const NO_CHROME: ListHeaderChrome = {
	title: "",
	navSlot: null,
	titleMeta: null,
	searchSlot: null,
	searchField: null,
};

export const ListHeaderChromeContext =
	createContext<ListHeaderChrome>(NO_CHROME);

export const useListHeaderChrome = (): ListHeaderChrome =>
	useContext(ListHeaderChromeContext);
