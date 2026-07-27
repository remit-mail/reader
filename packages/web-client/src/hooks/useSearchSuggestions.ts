/**
 * What the search box offers for the term under the caret (#428 follow-up).
 *
 * The decisions are all in `lib/search-suggestions.ts`; this is the wiring that
 * gets them their data. A caret position names exactly one lookup — token names
 * for a bare word, one token's values once its name is committed — so only that
 * lookup runs, and the address search behind `from:` runs on a debounce rather
 * than per keystroke.
 *
 * Folders and accounts are already loaded: the mailbox lists come from the same
 * per-account query `useMailboxNameIndex` and `useResultFolderIndex` take, on
 * the same key with the same infinite stale time, so react-query serves them
 * from cache and nothing is fetched a second time.
 *
 * `in:` is offered only where the route resolves it. On a scoped view the parser
 * leaves the token as free text (see `useSearchTokenContext`), so offering
 * folders there would advertise a filter that does nothing.
 */
import {
	addressOperationsSearchAddressesOptions,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { Suggestion } from "@remit/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { useMailContext } from "@/lib/mail-context";
import {
	buildSearchSuggestions,
	contactSuggestionValue,
	SEARCH_SUGGESTION_LIMIT,
	searchSuggestionRequest,
} from "@/lib/search-suggestions";
import {
	buildAccountSuggestionValues,
	buildMailboxSuggestionValues,
} from "@/lib/search-token-index";
import { useDebouncedValue } from "./useDebouncedValue";

/** How long typing settles before the address lookup fires. */
export const SEARCH_CONTACT_DEBOUNCE_MS = 250;

/** The shortest contact query worth a round-trip. */
const MIN_CONTACT_QUERY_LENGTH = 2;

export interface SearchSuggestionsInput {
	/** The query exactly as typed. */
	query: string;
	/** Where the caret sits in it. */
	cursor: number;
	/** Offer nothing while the field is not being typed in. */
	enabled: boolean;
}

export function useSearchSuggestions({
	query,
	cursor,
	enabled,
}: SearchSuggestionsInput): Suggestion[] {
	const { accounts } = useMailContext();
	const { mailboxesByName } = useSearchTokenContext();
	const offersFolders = mailboxesByName !== undefined;

	const request = enabled ? searchSuggestionRequest(query, cursor) : undefined;
	const contactQuery =
		request?.source === "contact" ? request.query.trim() : "";
	const debouncedContactQuery = useDebouncedValue(
		contactQuery,
		SEARCH_CONTACT_DEBOUNCE_MS,
	);
	const { data: addresses } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: debouncedContactQuery, limit: SEARCH_SUGGESTION_LIMIT },
		}),
		enabled: debouncedContactQuery.length >= MIN_CONTACT_QUERY_LENGTH,
	});

	const mailboxQueries = useQueries({
		queries: accounts.map((account) => ({
			...mailboxOperationsListMailboxesOptions({
				path: { accountId: account.accountId },
			}),
			staleTime: Infinity,
		})),
	});

	const mailboxes = useMemo(
		() =>
			offersFolders
				? buildMailboxSuggestionValues(
						mailboxQueries.map(
							(mailboxQuery) => mailboxQuery.data?.items ?? [],
						),
						accounts,
					)
				: [],
		[offersFolders, mailboxQueries, accounts],
	);
	const accountValues = useMemo(
		() => buildAccountSuggestionValues(accounts),
		[accounts],
	);
	const contacts = useMemo(
		() => (addresses?.items ?? []).map(contactSuggestionValue),
		[addresses],
	);

	return useMemo(() => {
		if (!enabled) return [];
		const suggestions = buildSearchSuggestions(query, cursor, {
			mailboxes,
			accounts: accountValues,
			contacts,
		});
		if (offersFolders) return suggestions;
		return suggestions.filter((suggestion) => suggestion.value !== "in:");
	}, [
		enabled,
		query,
		cursor,
		mailboxes,
		accountValues,
		contacts,
		offersFolders,
	]);
}
