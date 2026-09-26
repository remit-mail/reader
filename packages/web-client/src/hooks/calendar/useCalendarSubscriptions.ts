/**
 * Subscribing a new calendar to a read-only iCalendar URL, and turning an
 * existing subscription's refresh off and on (issue #1261).
 *
 * The server fetches the feed before it creates anything, so a refused
 * subscribe leaves no calendar behind and its reason is what the form states.
 * A 401 is not among the statuses owned here: a lapsed session escalates the
 * way it does everywhere else.
 */
import {
	calendarDetailOperationsUpdateCalendarMutation,
	calendarOperationsCreateCalendarMutation,
	calendarOperationsListCalendarsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { softErrorStatuses } from "@/lib/error-classifier";
import { useInvalidateCalendarReads } from "./useCalendarWrites";

const SUBSCRIPTION_WRITE_META = softErrorStatuses(400, 404);

export interface CalendarSubscribeRequest {
	displayName: string;
	url: string;
}

export interface CalendarSubscriptionControls {
	subscribe: (request: CalendarSubscribeRequest, onDone: () => void) => void;
	isSubscribing: boolean;
	subscribeError: unknown;
	setEnabled: (calendarId: string, enabled: boolean) => void;
	togglingCalendarId: string;
	/** The last pause or resume the server turned down, and whose it was. */
	toggleFailure: { calendarId: string; error: unknown };
}

const urlSegmentFor = (): string =>
	`subscribed-${crypto.randomUUID().slice(0, 8)}`;

export function useCalendarSubscriptions(): CalendarSubscriptionControls {
	const queryClient = useQueryClient();
	const invalidateReads = useInvalidateCalendarReads();
	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: calendarOperationsListCalendarsQueryKey(),
		});
		invalidateReads();
	};

	const create = useMutation({
		...calendarOperationsCreateCalendarMutation(),
		meta: SUBSCRIPTION_WRITE_META,
		onSuccess: invalidate,
	});

	const toggle = useMutation({
		...calendarDetailOperationsUpdateCalendarMutation(),
		meta: SUBSCRIPTION_WRITE_META,
		onSuccess: invalidate,
	});

	const { mutate: createCalendar } = create;
	const subscribe = useCallback(
		(request: CalendarSubscribeRequest, onDone: () => void) => {
			createCalendar(
				{
					body: {
						urlSegment: urlSegmentFor(),
						displayName: request.displayName.trim(),
						subscriptionUrl: request.url.trim(),
					},
				},
				{ onSuccess: onDone },
			);
		},
		[createCalendar],
	);

	const { mutate: updateCalendar } = toggle;
	const setEnabled = useCallback(
		(calendarId: string, enabled: boolean) => {
			updateCalendar({
				path: { calendarId },
				body: { subscriptionEnabled: enabled },
			});
		},
		[updateCalendar],
	);

	return {
		subscribe,
		isSubscribing: create.isPending,
		subscribeError: create.error,
		setEnabled,
		togglingCalendarId: toggle.isPending
			? (toggle.variables?.path.calendarId ?? "")
			: "",
		toggleFailure: {
			calendarId: toggle.variables?.path.calendarId ?? "",
			error: toggle.error,
		},
	};
}
