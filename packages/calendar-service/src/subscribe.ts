import { createHash } from "node:crypto";
import type {
	CalendarCollectionItem,
	ICalendarUnitOfWork,
} from "@remit/data-ports";
import ICAL from "ical.js";
import { type CalendarResult, calendarFailure } from "./errors.js";
import { readCalendarComponent, serializeCalendar } from "./parse.js";
import { deleteCalendarObject, putCalendarObject } from "./put.js";

export const CALENDAR_SUBSCRIPTION_TIMEOUT_MS = 30_000;

export const CALENDAR_SUBSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;

const SUBSCRIPTION_ERROR_MAX_LENGTH = 512;

const SCHEMES: Record<string, string> = {
	"http:": "http:",
	"https:": "https:",
	"webcal:": "https:",
	"webcals:": "https:",
};

export type CalendarFeedFetcher = (
	url: string,
	init: RequestInit,
) => Promise<Response>;

export type CalendarFeedFetch =
	| { ok: true; value: string }
	| { ok: false; reason: string };

export interface CalendarFeedResource {
	uid: string;
	resourceName: string;
	icalData: string;
}

export interface CalendarFeedSplit {
	resources: CalendarFeedResource[];
	unreadable: number;
}

export interface CalendarFeedWrite {
	/** The subscription was paused while its feed was being read, so nothing was written. */
	paused: boolean;
	written: number;
	unchanged: number;
	removed: number;
	skipped: number;
}

export interface CalendarSubscriptionTarget {
	accountConfigId: string;
	calendarId: string;
}

export type CalendarSubscriptionRefresh =
	| { ok: true; value: CalendarFeedWrite }
	| { ok: false; reason: string };

/**
 * The URL a subscription is fetched from. `webcal:` is what calendar products
 * hand out for "subscribe", and means the same address over HTTPS.
 */
export const readSubscriptionUrl = (raw: string): CalendarResult<string> => {
	const trimmed = raw.trim();
	if (!URL.canParse(trimmed)) {
		return calendarFailure(
			"InvalidSubscriptionUrl",
			"the subscription address is not a URL",
		);
	}
	const url = new URL(trimmed);
	const scheme = SCHEMES[url.protocol];
	if (!scheme) {
		return calendarFailure(
			"InvalidSubscriptionUrl",
			`a subscription address starts with http, https or webcal, not ${url.protocol.replace(/:$/, "")}`,
		);
	}
	if (url.username !== "" || url.password !== "") {
		return calendarFailure(
			"InvalidSubscriptionUrl",
			"a subscription address carries no user name or password",
		);
	}
	const address = new URL(`${scheme}${trimmed.slice(url.protocol.length)}`);
	return { ok: true, value: address.toString() };
};

const truncate = (reason: string): string =>
	reason.length <= SUBSCRIPTION_ERROR_MAX_LENGTH
		? reason
		: `${reason.slice(0, SUBSCRIPTION_ERROR_MAX_LENGTH - 1)}…`;

const unreachableReason = (error: unknown): string => {
	if (error instanceof Error && error.name === "TimeoutError") {
		return `the feed did not answer within ${CALENDAR_SUBSCRIPTION_TIMEOUT_MS / 1000} seconds`;
	}
	const cause =
		error instanceof Error && error.cause instanceof Error
			? error.cause
			: undefined;
	const code =
		cause && "code" in cause && typeof cause.code === "string"
			? cause.code
			: undefined;
	return code
		? `the feed could not be reached (${code})`
		: "the feed could not be reached";
};

/**
 * Reads a subscription's feed. Every failure is a returned reason that a
 * person can act on and that never repeats the URL: for a Google secret
 * address the URL is the whole credential, and the reason is stored on the
 * collection and drawn in the calendar view.
 */
export const fetchCalendarFeed = async (
	url: string,
	fetcher: CalendarFeedFetcher = fetch,
): Promise<CalendarFeedFetch> => {
	const response = await fetcher(url, {
		headers: { accept: "text/calendar, */*;q=0.5" },
		redirect: "follow",
		signal: AbortSignal.timeout(CALENDAR_SUBSCRIPTION_TIMEOUT_MS),
	}).then(
		(value) => ({ ok: true, value }) as const,
		(error: unknown) =>
			({ ok: false, reason: unreachableReason(error) }) as const,
	);
	if (!response.ok) return response;

	const { status } = response.value;
	if (status < 200 || status > 299) {
		await response.value.body?.cancel();
		return { ok: false, reason: `the feed answered HTTP ${status}` };
	}

	const declared = Number(response.value.headers.get("content-length") ?? "0");
	if (declared > CALENDAR_SUBSCRIPTION_MAX_BYTES) {
		await response.value.body?.cancel();
		return { ok: false, reason: TOO_LARGE };
	}

	const { body } = response.value;
	if (!body) return { ok: true, value: "" };
	return readCapped(body).then(
		(read) => read,
		(error: unknown) => ({ ok: false, reason: unreachableReason(error) }),
	);
};

const TOO_LARGE = "the feed is larger than 10 MB";

/**
 * Reads a body a chunk at a time and stops at the cap. A feed sent chunked
 * carries no length to refuse up front, so counting as it arrives is the only
 * thing that keeps an endless body out of memory.
 */
const readCapped = async (
	body: ReadableStream<Uint8Array>,
): Promise<CalendarFeedFetch> => {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let text = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		if (received > CALENDAR_SUBSCRIPTION_MAX_BYTES) {
			await reader.cancel();
			return { ok: false, reason: TOO_LARGE };
		}
		text += decoder.decode(value, { stream: true });
	}
	return { ok: true, value: text + decoder.decode() };
};

/**
 * A resource as it would compare across two fetches. DTSTAMP is when the
 * provider exported the feed, not when the event changed — Google restamps it
 * on every fetch — so it is left out, or every refresh would rewrite every
 * event.
 */
const comparable = (icalData: string): string =>
	icalData.replace(/^DTSTAMP[;:][^\r\n]*\r?\n/gim, "");

const resourceNameOf = (uid: string): string =>
	`${createHash("sha256").update(uid, "utf8").digest("hex").slice(0, 40)}.ics`;

const zonesReferencedBy = (events: ICAL.Component[]): Set<string> => {
	const zones = new Set<string>();
	for (const event of events) {
		for (const property of event.getAllProperties()) {
			const tzid = property.getParameter("tzid");
			if (typeof tzid === "string") zones.add(tzid);
		}
	}
	return zones;
};

/**
 * Cuts a whole feed into one resource per UID, the shape the calendar write
 * path stores: a series and its RECURRENCE-ID overrides travel together, with
 * the VTIMEZONEs they name, so a DST-crossing series resolves against the zone
 * the provider published.
 *
 * The feed's calendar-level properties are kept on every resource except
 * METHOD, which a stored resource never carries. A VEVENT with no UID has
 * nothing to key it by across refreshes, so it is counted and left out.
 */
export const splitCalendarFeed = async (
	icalData: string,
): Promise<CalendarResult<CalendarFeedSplit>> => {
	const read = await readCalendarComponent(icalData);
	if (!read.ok) return read;
	const feed = read.value;
	if (feed.name !== "vcalendar") {
		return calendarFailure(
			"NotACalendar",
			feed.name
				? `expected a VCALENDAR, found ${feed.name.toUpperCase()}`
				: "expected a VCALENDAR, found nothing",
		);
	}

	const timezones = feed.getAllSubcomponents("vtimezone");
	const byUid = new Map<string, ICAL.Component[]>();
	let unreadable = 0;
	for (const event of feed.getAllSubcomponents("vevent")) {
		const uid = event.getFirstPropertyValue("uid");
		if (typeof uid !== "string" || uid === "") {
			unreadable += 1;
			continue;
		}
		byUid.set(uid, [...(byUid.get(uid) ?? []), event]);
	}

	const resources = [...byUid].map(([uid, events]) => {
		const calendar = new ICAL.Component("vcalendar");
		for (const property of feed.getAllProperties()) {
			if (property.name === "method") continue;
			calendar.addProperty(new ICAL.Property(property.toJSON()));
		}
		const zones = zonesReferencedBy(events);
		for (const timezone of timezones) {
			const tzid = timezone.getFirstPropertyValue("tzid");
			if (typeof tzid === "string" && zones.has(tzid)) {
				calendar.addSubcomponent(new ICAL.Component(timezone.toJSON()));
			}
		}
		for (const event of events) {
			calendar.addSubcomponent(new ICAL.Component(event.toJSON()));
		}
		return {
			uid,
			resourceName: resourceNameOf(uid),
			icalData: serializeCalendar(calendar),
		};
	});

	return { ok: true, value: { resources, unreadable } };
};

const feedErrorOf = (write: CalendarFeedWrite): string =>
	write.skipped === 0
		? ""
		: `${write.skipped} ${write.skipped === 1 ? "event" : "events"} in the feed could not be stored`;

/**
 * Makes a subscribed collection hold what the feed holds, in one unit.
 *
 * Every resource goes through `putCalendarObject`, the one write path, so a
 * subscribed event is stored, projected and expanded the way any other event
 * is. A resource whose bytes have not changed is left alone, and one the feed
 * no longer carries is removed. A resource the write path refuses is counted
 * and recorded on the collection rather than failing the whole refresh.
 */
export const writeCalendarFeed = async (
	unitOfWork: ICalendarUnitOfWork,
	target: CalendarSubscriptionTarget,
	split: CalendarFeedSplit,
	now: number,
): Promise<CalendarFeedWrite> =>
	unitOfWork.transaction(async (repos) => {
		const current = await repos.calendarCollection.get(
			target.accountConfigId,
			target.calendarId,
		);
		if (!current.subscriptionEnabled) {
			return { paused: true, written: 0, unchanged: 0, removed: 0, skipped: 0 };
		}
		const stored = await repos.calendarObject.listByCalendar(target.calendarId);
		const storedByName = new Map(
			stored.map((object) => [object.resourceName, object]),
		);
		const kept = new Set<string>();
		const write: CalendarFeedWrite = {
			paused: false,
			written: 0,
			unchanged: 0,
			removed: 0,
			skipped: split.unreadable,
		};

		for (const resource of split.resources) {
			const existing = storedByName.get(resource.resourceName);
			if (
				existing &&
				comparable(existing.icalData) === comparable(resource.icalData)
			) {
				kept.add(resource.resourceName);
				write.unchanged += 1;
				continue;
			}
			const put = await putCalendarObject(unitOfWork, {
				accountConfigId: target.accountConfigId,
				calendarId: target.calendarId,
				resourceName: resource.resourceName,
				icalData: resource.icalData,
			});
			if (!put.ok) {
				write.skipped += 1;
				continue;
			}
			kept.add(resource.resourceName);
			write.written += 1;
		}

		for (const object of stored) {
			if (kept.has(object.resourceName)) continue;
			await deleteCalendarObject(unitOfWork, {
				accountConfigId: target.accountConfigId,
				calendarId: target.calendarId,
				calendarObjectId: object.calendarObjectId,
			});
			write.removed += 1;
		}

		await repos.calendarCollection.update(
			target.accountConfigId,
			target.calendarId,
			{
				subscriptionCheckedAt: now,
				subscriptionFetchedAt: now,
				subscriptionError: truncate(feedErrorOf(write)),
			},
		);
		return write;
	});

/** Records a refresh that stored nothing, and why. Every stored event stays. */
export const recordCalendarFeedFailure = async (
	unitOfWork: ICalendarUnitOfWork,
	target: CalendarSubscriptionTarget,
	reason: string,
	now: number,
): Promise<void> => {
	await unitOfWork.transaction((repos) =>
		repos.calendarCollection.update(target.accountConfigId, target.calendarId, {
			subscriptionCheckedAt: now,
			subscriptionError: truncate(reason),
		}),
	);
};

/** Fetches and cuts a feed, or answers why it cannot be stored. */
export const readCalendarFeed = async (
	url: string,
	fetcher: CalendarFeedFetcher = fetch,
): Promise<
	{ ok: true; value: CalendarFeedSplit } | { ok: false; reason: string }
> => {
	const fetched = await fetchCalendarFeed(url, fetcher);
	if (!fetched.ok) return fetched;
	const split = await splitCalendarFeed(fetched.value);
	if (!split.ok) {
		return {
			ok: false,
			reason: `the feed is not a calendar: ${split.error.message}`,
		};
	}
	return split;
};

/**
 * One scheduled refresh of one subscription. A feed that cannot be read
 * records its reason on the collection and removes nothing.
 */
export const refreshCalendarSubscription = async (
	unitOfWork: ICalendarUnitOfWork,
	collection: CalendarCollectionItem,
	now: number,
	fetcher: CalendarFeedFetcher = fetch,
): Promise<CalendarSubscriptionRefresh> => {
	const target = {
		accountConfigId: collection.accountConfigId,
		calendarId: collection.calendarId,
	};
	const feed = await readCalendarFeed(collection.subscriptionUrl, fetcher);
	if (!feed.ok) {
		await recordCalendarFeedFailure(unitOfWork, target, feed.reason, now);
		return feed;
	}
	const write = await writeCalendarFeed(unitOfWork, target, feed.value, now);
	return { ok: true, value: write };
};

/**
 * Whether a subscription is due a refresh: its last fetch, successful or not,
 * is at least `intervalMs` old.
 */
export const isSubscriptionDue = (
	collection: CalendarCollectionItem,
	now: number,
	intervalMs: number,
): boolean => now - collection.subscriptionCheckedAt >= intervalMs;
