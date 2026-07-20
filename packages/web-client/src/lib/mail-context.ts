import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { createContext, useContext } from "react";
import {
	EMPTY_RESULT_FOLDER_INDEX,
	type ResultFolderIndex,
} from "./result-folder.js";

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
	/**
	 * Name indexes `parseSearchTokens` resolves `in:`/`account:` chips against
	 * (#428 follow-up). Computed once here so every consumer — chip rendering,
	 * the brief/flagged token filters, `useSemanticSearch` — agrees on the same
	 * resolution. See `lib/search-token-index.ts`.
	 */
	mailboxNameIndex: ReadonlyMap<string, string>;
	accountNameIndex: ReadonlyMap<string, string>;
	/**
	 * mailboxId → the folder a search result read from that mailbox came from.
	 * Computed once here for the same reason as the name indexes: the row labels,
	 * the spam hold-out and the scope chip must agree on which folder is which.
	 * See `lib/result-folder.ts`.
	 */
	resultFolderIndex: ResultFolderIndex;
	searchQuery: string;
	/** Live (pre-debounce) search input — the search field binds this. */
	searchInput: string;
	/**
	 * Identity of the view the current search belongs to (`lib/mail-route.ts`).
	 * It changes when the user leaves that view, which is when search ends: the
	 * query re-seeds from the new URL and any search chrome collapses (#47).
	 */
	searchViewKey: string;
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
			mailboxNameIndex: new Map(),
			accountNameIndex: new Map(),
			resultFolderIndex: EMPTY_RESULT_FOLDER_INDEX,
			searchQuery: "",
			searchInput: "",
			searchViewKey: "",
			onSearchChange: () => {},
			onSearchClear: () => {},
			onSearchClearQuery: () => {},
			intelligenceOpen: false,
			onToggleIntelligence: () => {},
			onSetIntelligenceOpen: () => {},
		}
	);
};
