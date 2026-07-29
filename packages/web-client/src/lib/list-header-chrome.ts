import type { SearchConversion } from "@remit/ui";
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
	/**
	 * The read-only two-engine results panel, when a query is being typed and
	 * this view answers it with the panel rather than its own rows. The body
	 * renders it in place of its list; `MailListHeader` cannot swap the body
	 * out from above, because the header is inside it.
	 */
	searchResults: ReactNode;
	/** The search's make-this-a-filter row, up only while nothing is ticked. */
	makeFilterSlot: ReactNode;
	/**
	 * The active query as clauses, which is what the wizard's search entry opens
	 * on (#484). It travels with the chrome for the same reason the rest does:
	 * the query belongs to `MailListHeader` and the wizard is mounted by the body
	 * below it, and one conversion computed in one place is what keeps the reason
	 * the affordance gives and the clauses the wizard seeds from disagreeing.
	 * Absent when no query is up.
	 */
	searchConversion?: SearchConversion;
}

const NO_CHROME: ListHeaderChrome = {
	title: "",
	navSlot: null,
	titleMeta: null,
	searchSlot: null,
	searchField: null,
	searchResults: null,
	makeFilterSlot: null,
};

export const ListHeaderChromeContext =
	createContext<ListHeaderChrome>(NO_CHROME);

export const useListHeaderChrome = (): ListHeaderChrome =>
	useContext(ListHeaderChromeContext);
