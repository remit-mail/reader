import type { RemitClient } from "@remit/backend/client";
import {
	type CalendarFeedFetcher,
	isSubscriptionDue,
	refreshCalendarSubscription,
} from "@remit/calendar-service";
import type {
	ICalendarCollectionRepository,
	ICalendarStore,
} from "@remit/data-ports";
import type { Logger } from "@remit/logger";
import pMap from "p-map";
import type { CalendarSubscriptionTally } from "./run-tick.js";

const REFRESH_CONCURRENCY = 4;

export interface CalendarSubscriptionRefreshDeps {
	calendarCollection: Pick<
		ICalendarCollectionRepository,
		"listEnabledSubscriptions"
	>;
	calendarStore: ICalendarStore;
	log: Logger;
	fetcher?: CalendarFeedFetcher;
}

/**
 * Re-reads every enabled subscription whose last fetch is at least
 * `intervalMs` old. A disabled subscription is never listed, which is what
 * stops its refresh while leaving its events in place.
 *
 * One feed's failure is recorded on its own collection and counted here; it
 * never stops the others. The log names the calendar and the reason, never the
 * URL, which for a Google secret address is the whole credential.
 */
export const refreshDueCalendarSubscriptions = async (
	deps: CalendarSubscriptionRefreshDeps,
	now: number,
	intervalMs: number,
): Promise<CalendarSubscriptionTally> => {
	const enabled = await deps.calendarCollection.listEnabledSubscriptions();
	const due = enabled.filter((collection) =>
		isSubscriptionDue(collection, now, intervalMs),
	);

	const outcomes = await pMap(
		due,
		(collection) =>
			refreshCalendarSubscription(
				deps.calendarStore,
				collection,
				now,
				deps.fetcher,
			).then(
				(refresh) => {
					if (refresh.ok) return true;
					deps.log.warn(
						{ calendarId: collection.calendarId, reason: refresh.reason },
						"Calendar subscription could not be refreshed",
					);
					return false;
				},
				(error: unknown) => {
					deps.log.error(
						{ calendarId: collection.calendarId, error },
						"Calendar subscription refresh failed",
					);
					return false;
				},
			),
		{ concurrency: REFRESH_CONCURRENCY },
	);

	return {
		refreshed: outcomes.filter(Boolean).length,
		failed: outcomes.filter((ok) => !ok).length,
		notDue: enabled.length - due.length,
	};
};

export const buildCalendarSubscriptionRefresh =
	(
		client: Pick<RemitClient, "calendarCollection" | "calendarStore">,
		log: Logger,
	): ((
		now: number,
		intervalMs: number,
	) => Promise<CalendarSubscriptionTally>) =>
	(now, intervalMs) =>
		refreshDueCalendarSubscriptions(
			{
				calendarCollection: client.calendarCollection,
				calendarStore: client.calendarStore,
				log,
			},
			now,
			intervalMs,
		);
