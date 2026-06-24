import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import type { PaneLayout } from "@remit/ui";
import { createContext, useContext } from "react";

/**
 * Shared mail-layout context. Lives in `lib/` — NOT in `routes/mail.tsx` — on
 * purpose: the generated route tree imports the mail route via a relative
 * specifier (`./routes/mail`) while feature code imports via the `@/` alias.
 * Vite can resolve those to two distinct module instances, which would give the
 * `MailLayout` provider and a child-route consumer two different `MailContext`
 * objects — the consumer then silently falls back to the defaults below (this
 * bit the intelligence toggle: clicks reached a no-op handler). Keeping the
 * context in a module that is only ever imported through the `@/` alias
 * guarantees a single instance shared by provider and consumers.
 */
export interface MailContextValue {
	accounts: RemitImapAccountResponse[];
	searchQuery: string;
	/** Live (pre-debounce) search input — the toolbar's search field binds this. */
	searchInput: string;
	onSearchChange: (query: string) => void;
	/** Full clear (X button): drops the query and any selected thread (#538). */
	onSearchClear: () => void;
	/** Query-only clear (Esc): drops the query, keeps the thread open (#489). */
	onSearchClearQuery: () => void;
	/** Pane 4 (intelligence) visibility. The shared toggle starts closed; the
	 *  desktop route opens it by default with the thread, honouring the stored
	 *  preference (#782). */
	intelligenceOpen: boolean;
	onToggleIntelligence: () => void;
	/** Set the pane open/closed and persist the choice (desktop default-open). */
	onSetIntelligenceOpen: (open: boolean) => void;
	/**
	 * Container-width pane layout derived from the kit's `resolvePaneLayout`.
	 * The shell measures its own width once and propagates the result here, so
	 * child routes share one breakpoint decision instead of each re-measuring.
	 *   paneLayout.reading  → container ≥ 1024px (reading pane visible)
	 *   paneLayout.intelligence → container ≥ 1280px (intelligence rail fits)
	 *   paneLayout.nav      → same as `reading` (nav is a persistent pane at ≥1024)
	 */
	paneLayout: PaneLayout;
}

export const MailContext = createContext<MailContextValue | null>(null);

export const useMailContext = (): MailContextValue => {
	const context = useContext(MailContext);
	// Return default values if context not yet available (e.g., during loading)
	// This can happen when TanStack Router renders child routes before parent
	// finishes.
	return (
		context ?? {
			accounts: [],
			searchQuery: "",
			searchInput: "",
			onSearchChange: () => {},
			onSearchClear: () => {},
			onSearchClearQuery: () => {},
			intelligenceOpen: false,
			onToggleIntelligence: () => {},
			onSetIntelligenceOpen: () => {},
			paneLayout: { nav: false, reading: false, intelligence: false },
		}
	);
};
