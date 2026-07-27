import { addressOperationsSearchAddressesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { ClauseField, Suggestion } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	buildClauseSuggestions,
	CLAUSE_SUGGESTION_LIMIT,
	fieldTakesAddressSuggestions,
	type KnownAddress,
} from "@/lib/organize/clause-suggestions";
import { useDebouncedValue } from "./useDebouncedValue";

/** How long typing settles before the address lookup fires. */
export const CLAUSE_SUGGESTION_DEBOUNCE_MS = 250;

/** The shortest query worth a round-trip. */
const MIN_QUERY_LENGTH = 2;

/**
 * Values to offer for the clause being edited: the senders of the messages the
 * user selected first — already in hand, and the likeliest answer — then the
 * known addresses a lookup turns up for what has been typed.
 *
 * The lookup is the address search the compose recipient field already uses, on
 * a debounce so a request does not fire per keystroke. The list narrows against
 * the live value while a request is still out, so it never lags what is on
 * screen; nothing it returns can change what the user typed.
 */
export const useClauseSuggestions = (
	field: ClauseField | undefined,
	value: string,
	selectionSenders: readonly string[],
): Suggestion[] => {
	const query = value.trim();
	const debouncedQuery = useDebouncedValue(
		query,
		CLAUSE_SUGGESTION_DEBOUNCE_MS,
	);
	const offersAddresses =
		field !== undefined && fieldTakesAddressSuggestions(field);

	const { data } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: debouncedQuery, limit: CLAUSE_SUGGESTION_LIMIT },
		}),
		enabled: offersAddresses && debouncedQuery.length >= MIN_QUERY_LENGTH,
	});

	if (!offersAddresses || field === undefined) return [];
	const addresses: KnownAddress[] = [
		...selectionSenders.map((email) => ({ email, fromSelection: true })),
		...(data?.items ?? []).map((address) => ({
			email: address.normalizedEmail,
			...(address.displayName ? { displayName: address.displayName } : {}),
		})),
	];
	return buildClauseSuggestions(field, query, addresses);
};
