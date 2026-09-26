/**
 * The events mail offers, and the answers the reader gives them.
 *
 * Every card is drawn from what the server holds. An answer is a request, and
 * the card moves when the listing it came from is read again — never because
 * this side decided the press worked — so a refused answer leaves the card
 * where it was, with the refusal stated beside it.
 *
 * Answers come back as outcomes rather than throws, for the reason the event
 * writes do: a surface switching on a caught `unknown` cannot tell a refusal it
 * must state from a fault it must not swallow. A lapsed session is neither, and
 * escalates the way it does everywhere else.
 */
import {
	calendarSuggestionActionOperationsAcceptCalendarSuggestionMutation,
	calendarSuggestionActionOperationsDeclineCalendarSuggestionMutation,
	calendarSuggestionActionOperationsDismissCalendarSuggestionMutation,
	calendarSuggestionOperationsListCalendarSuggestionsOptions,
	messageCalendarSuggestionOperationsListMessageCalendarSuggestionsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapCalendarSuggestionResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { softErrorStatuses } from "@/lib/error-classifier";

const SUGGESTION_META = softErrorStatuses(400, 404);

/** Every read an answer can change: the cards, the calendar, the sender rules. */
const ANSWERED_QUERY_IDS = new Set([
	"calendarSuggestionOperationsListCalendarSuggestions",
	"messageCalendarSuggestionOperationsListMessageCalendarSuggestions",
	"calendarEventOperationsListCalendarEvents",
	"calendarEventDetailOperationsGetCalendarEvent",
	"calendarFreeBusyOperationsListCalendarFreeBusy",
	"filterOperationsListFilters",
]);

const invalidateAnswered = (queryClient: QueryClient): Promise<void> =>
	queryClient.invalidateQueries({
		predicate: (query) => {
			const head = query.queryKey[0];
			if (typeof head !== "object" || head === null) return false;
			const id = (head as { _id?: unknown })._id;
			return typeof id === "string" && ANSWERED_QUERY_IDS.has(id);
		},
	});

export interface CalendarSuggestionsResult {
	suggestions: RemitImapCalendarSuggestionResponse[];
	isLoading: boolean;
	error: unknown;
}

/** Every suggestion one message produced, whatever became of each. */
export function useMessageCalendarSuggestions(
	messageId: string,
): CalendarSuggestionsResult {
	const { data, isLoading, error } = useQuery({
		...messageCalendarSuggestionOperationsListMessageCalendarSuggestionsOptions(
			{ path: { messageId } },
		),
		meta: SUGGESTION_META,
	});
	return {
		suggestions: data?.items ?? [],
		isLoading,
		error: error ?? null,
	};
}

/** The suggestions still waiting on the reader, newest first. */
export function usePendingCalendarSuggestions(): CalendarSuggestionsResult {
	const { data, isLoading, error } = useQuery({
		...calendarSuggestionOperationsListCalendarSuggestionsOptions({
			query: { state: "Pending" },
		}),
		meta: SUGGESTION_META,
	});
	return {
		suggestions: data?.items ?? [],
		isLoading,
		error: error ?? null,
	};
}

export type SuggestionAnswer =
	| { kind: "answered" }
	| { kind: "refused"; message: string };

const ANSWERED: SuggestionAnswer = { kind: "answered" };

const refused = (error: unknown): SuggestionAnswer => ({
	kind: "refused",
	message: formatErrorMessage(error),
});

export interface CalendarSuggestionAnswers {
	accept: (
		suggestionId: string,
		calendarId: string,
	) => Promise<SuggestionAnswer>;
	decline: (suggestionId: string) => Promise<SuggestionAnswer>;
	dismiss: (
		suggestionId: string,
		muteSender: boolean,
	) => Promise<SuggestionAnswer>;
	isAnswering: boolean;
}

export function useCalendarSuggestionAnswers(): CalendarSuggestionAnswers {
	const queryClient = useQueryClient();
	const onSuccess = useCallback(
		() => invalidateAnswered(queryClient),
		[queryClient],
	);

	const accept = useMutation({
		...calendarSuggestionActionOperationsAcceptCalendarSuggestionMutation(),
		meta: SUGGESTION_META,
		onSuccess,
	});
	const decline = useMutation({
		...calendarSuggestionActionOperationsDeclineCalendarSuggestionMutation(),
		meta: SUGGESTION_META,
		onSuccess,
	});
	const dismiss = useMutation({
		...calendarSuggestionActionOperationsDismissCalendarSuggestionMutation(),
		meta: SUGGESTION_META,
		onSuccess,
	});

	const acceptSuggestion = useCallback(
		(suggestionId: string, calendarId: string) =>
			accept
				.mutateAsync({ path: { suggestionId }, body: { calendarId } })
				.then(() => ANSWERED)
				.catch(refused),
		[accept],
	);
	const declineSuggestion = useCallback(
		(suggestionId: string) =>
			decline
				.mutateAsync({ path: { suggestionId } })
				.then(() => ANSWERED)
				.catch(refused),
		[decline],
	);
	const dismissSuggestion = useCallback(
		(suggestionId: string, muteSender: boolean) =>
			dismiss
				.mutateAsync({ path: { suggestionId }, body: { muteSender } })
				.then(() => ANSWERED)
				.catch(refused),
		[dismiss],
	);

	return useMemo(
		() => ({
			accept: acceptSuggestion,
			decline: declineSuggestion,
			dismiss: dismissSuggestion,
			isAnswering: accept.isPending || decline.isPending || dismiss.isPending,
		}),
		[
			acceptSuggestion,
			declineSuggestion,
			dismissSuggestion,
			accept.isPending,
			decline.isPending,
			dismiss.isPending,
		],
	);
}
