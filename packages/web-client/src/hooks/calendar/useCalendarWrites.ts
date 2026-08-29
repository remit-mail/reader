/**
 * Creating, editing and deleting an event.
 *
 * Every write is conditional on the version the reader was looking at. A 412
 * means somebody replaced the resource in between — over CalDAV, in another
 * tab, from an accepted invitation — and applying the edit would discard their
 * change with nobody seeing it happen. That comes back as an outcome the
 * surface states, never as a write that quietly wins.
 *
 * Outcomes are returned rather than thrown: a caught value is `unknown`, and a
 * surface that has to switch on one cannot tell a refusal it must render from a
 * fault it must not swallow. Faults still escalate — these carry only the
 * statuses this surface owns, so a lapsed session takes the screen the way it
 * does everywhere else.
 */
import {
	calendarEventDetailOperationsDeleteCalendarEventMutation,
	calendarEventDetailOperationsUpdateCalendarEventMutation,
	calendarEventOperationsCreateCalendarEventMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapCreateCalendarEventInput,
	RemitImapRecurrenceScope,
	RemitImapUpdateCalendarEventInput,
} from "@remit/api-http-client/types.gen.ts";
import type { RecurrenceScope } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { getErrorStatus, softErrorStatuses } from "@/lib/error-classifier";

/** The refusals a calendar surface renders itself. A 401 is not among them. */
const CALENDAR_WRITE_META = softErrorStatuses(400, 404, 412);

/** Every read whose answer a write can change. */
const CALENDAR_QUERY_IDS = new Set([
	"calendarEventOperationsListCalendarEvents",
	"calendarEventDetailOperationsGetCalendarEvent",
	"calendarFreeBusyOperationsListCalendarFreeBusy",
]);

export type CalendarWriteOutcome =
	| { kind: "written" }
	| { kind: "conflict" }
	| { kind: "refused"; message: string };

const WRITTEN: CalendarWriteOutcome = { kind: "written" };

const outcomeFor = (error: unknown): CalendarWriteOutcome =>
	getErrorStatus(error) === 412
		? { kind: "conflict" }
		: { kind: "refused", message: formatErrorMessage(error) };

const SCOPES: Record<RecurrenceScope, RemitImapRecurrenceScope> = {
	this: "This",
	following: "Following",
	all: "All",
};

export interface ScopedWrite {
	calendarObjectId: string;
	calendarId: string;
	/** The occurrence the reader clicked. `""` on a resource that does not recur. */
	recurrenceId: string;
	/** Absent on a resource that does not recur — the server defaults to `All`. */
	scope?: RecurrenceScope;
	/** The version the edit was built on. */
	etag: string;
}

export interface CalendarWrites {
	createEvent: (
		input: RemitImapCreateCalendarEventInput,
	) => Promise<CalendarWriteOutcome>;
	updateEvent: (
		write: ScopedWrite,
		patch: RemitImapUpdateCalendarEventInput,
	) => Promise<CalendarWriteOutcome>;
	deleteEvent: (write: ScopedWrite) => Promise<CalendarWriteOutcome>;
	isWriting: boolean;
}

/** Everything a write invalidates: the windows, the resource, the busy spans. */
export function useInvalidateCalendarReads(): () => void {
	const queryClient = useQueryClient();
	return useCallback(() => {
		void queryClient.invalidateQueries({
			predicate: (query) => {
				const head = query.queryKey[0];
				if (typeof head !== "object" || head === null) return false;
				const id = (head as { _id?: unknown })._id;
				return typeof id === "string" && CALENDAR_QUERY_IDS.has(id);
			},
		});
	}, [queryClient]);
}

const scopeQuery = ({ scope, recurrenceId }: ScopedWrite) =>
	scope === undefined || scope === "all"
		? {}
		: { scope: SCOPES[scope], recurrenceId };

export function useCalendarWrites(): CalendarWrites {
	const invalidate = useInvalidateCalendarReads();

	const create = useMutation({
		...calendarEventOperationsCreateCalendarEventMutation(),
		meta: CALENDAR_WRITE_META,
		onSuccess: invalidate,
	});
	const update = useMutation({
		...calendarEventDetailOperationsUpdateCalendarEventMutation(),
		meta: CALENDAR_WRITE_META,
		onSuccess: invalidate,
	});
	const remove = useMutation({
		...calendarEventDetailOperationsDeleteCalendarEventMutation(),
		meta: CALENDAR_WRITE_META,
		onSuccess: invalidate,
	});

	const createEvent = useCallback(
		(input: RemitImapCreateCalendarEventInput) =>
			create
				.mutateAsync({ body: input })
				.then(() => WRITTEN)
				.catch(outcomeFor),
		[create],
	);

	const updateEvent = useCallback(
		(write: ScopedWrite, patch: RemitImapUpdateCalendarEventInput) =>
			update
				.mutateAsync({
					path: { calendarObjectId: write.calendarObjectId },
					query: { calendarId: write.calendarId, ...scopeQuery(write) },
					headers: { "If-Match": write.etag },
					body: patch,
				})
				.then(() => WRITTEN)
				.catch(outcomeFor),
		[update],
	);

	const deleteEvent = useCallback(
		(write: ScopedWrite) =>
			remove
				.mutateAsync({
					path: { calendarObjectId: write.calendarObjectId },
					query: { calendarId: write.calendarId, ...scopeQuery(write) },
					headers: { "If-Match": write.etag },
				})
				.then(() => WRITTEN)
				.catch(outcomeFor),
		[remove],
	);

	return useMemo(
		() => ({
			createEvent,
			updateEvent,
			deleteEvent,
			isWriting: create.isPending || update.isPending || remove.isPending,
		}),
		[
			createEvent,
			updateEvent,
			deleteEvent,
			create.isPending,
			update.isPending,
			remove.isPending,
		],
	);
}
