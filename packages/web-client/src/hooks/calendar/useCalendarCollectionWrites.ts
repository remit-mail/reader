/**
 * Creating, renaming, rezoning and deleting a calendar collection.
 *
 * A refusal comes back as an outcome carrying the server's own words — a url
 * segment already taken, a zone it cannot resolve, the default calendar that
 * cannot be removed — so the settings card states it where the reader acted.
 * A lapsed session is not among the statuses owned here and escalates.
 *
 * Every write invalidates the listing, which is what the settings page, the
 * editor's picker and the address filter all read. A delete or a rezone also
 * moves or removes occurrences, so the event reads are invalidated with it.
 */
import {
	calendarDetailOperationsDeleteCalendarMutation,
	calendarDetailOperationsUpdateCalendarMutation,
	calendarOperationsCreateCalendarMutation,
	calendarOperationsListCalendarsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapCreateCalendarInput,
	RemitImapUpdateCalendarInput,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { softErrorStatuses } from "@/lib/error-classifier";
import { useInvalidateCalendarReads } from "./useCalendarWrites";

const COLLECTION_WRITE_META = softErrorStatuses(400, 404);

export type CalendarCollectionOutcome =
	| { kind: "written" }
	| { kind: "refused"; message: string };

const WRITTEN: CalendarCollectionOutcome = { kind: "written" };

const refused = (error: unknown): CalendarCollectionOutcome => ({
	kind: "refused",
	message: formatErrorMessage(error),
});

export interface CalendarCollectionWrites {
	createCalendar: (
		input: RemitImapCreateCalendarInput,
	) => Promise<CalendarCollectionOutcome>;
	updateCalendar: (
		calendarId: string,
		patch: RemitImapUpdateCalendarInput,
	) => Promise<CalendarCollectionOutcome>;
	deleteCalendar: (calendarId: string) => Promise<CalendarCollectionOutcome>;
	isWriting: boolean;
}

export function useCalendarCollectionWrites(): CalendarCollectionWrites {
	const queryClient = useQueryClient();
	const invalidateReads = useInvalidateCalendarReads();

	const invalidateListing = useCallback(
		() =>
			queryClient.invalidateQueries({
				queryKey: calendarOperationsListCalendarsQueryKey(),
			}),
		[queryClient],
	);

	const invalidateAll = useCallback(() => {
		invalidateReads();
		return invalidateListing();
	}, [invalidateReads, invalidateListing]);

	const create = useMutation({
		...calendarOperationsCreateCalendarMutation(),
		meta: COLLECTION_WRITE_META,
		onSuccess: invalidateListing,
	});
	const update = useMutation({
		...calendarDetailOperationsUpdateCalendarMutation(),
		meta: COLLECTION_WRITE_META,
		onSuccess: invalidateAll,
	});
	const remove = useMutation({
		...calendarDetailOperationsDeleteCalendarMutation(),
		meta: COLLECTION_WRITE_META,
		onSuccess: invalidateAll,
	});

	const createCalendar = useCallback(
		(input: RemitImapCreateCalendarInput) =>
			create
				.mutateAsync({ body: input })
				.then(() => WRITTEN)
				.catch(refused),
		[create],
	);

	const updateCalendar = useCallback(
		(calendarId: string, patch: RemitImapUpdateCalendarInput) =>
			update
				.mutateAsync({ path: { calendarId }, body: patch })
				.then(() => WRITTEN)
				.catch(refused),
		[update],
	);

	const deleteCalendar = useCallback(
		(calendarId: string) =>
			remove
				.mutateAsync({ path: { calendarId } })
				.then(() => WRITTEN)
				.catch(refused),
		[remove],
	);

	return useMemo(
		() => ({
			createCalendar,
			updateCalendar,
			deleteCalendar,
			isWriting: create.isPending || update.isPending || remove.isPending,
		}),
		[
			createCalendar,
			updateCalendar,
			deleteCalendar,
			create.isPending,
			update.isPending,
			remove.isPending,
		],
	);
}
