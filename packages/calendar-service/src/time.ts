import type { CalendarObjectItem } from "@remit/data-ports";
import { ZoneCertainty } from "@remit/domain-enums";
import ICAL from "ical.js";

/**
 * A resolved iCalendar time, in the two forms the store keeps.
 *
 * `isoUtc` is what a sort key holds: fixed width, so lexicographic order is
 * chronological order. `isoOffset` is what a client displays: the event's own
 * wall time with the offset it was written in, which `isoUtc` cannot express
 * for an all-day event without turning a civil date into an instant.
 *
 * `certainty` says how much either of them is worth. A zone that could not be
 * resolved still produces an instant — there is nothing else to produce — and
 * without this marker that guess is indistinguishable from a fact.
 */
export interface ResolvedTime {
	instantMs: number;
	isoUtc: string;
	isoOffset: string;
	isDate: boolean;
	certainty: CalendarObjectItem["zoneCertainty"];
}

const pad = (value: number, width = 2): string =>
	String(Math.abs(value)).padStart(width, "0");

const civilOf = (
	time: ICAL.Time,
): {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
} => ({
	year: time.year,
	month: time.month,
	day: time.day,
	hour: time.isDate ? 0 : time.hour,
	minute: time.isDate ? 0 : time.minute,
	second: time.isDate ? 0 : time.second,
});

/**
 * The offset an IANA zone was at on a given instant, in minutes.
 *
 * Read from the platform's own zone database through `Intl` rather than from a
 * bundled copy: ical.js ships no zone data, and a resource whose TZID names a
 * zone it carries no VTIMEZONE for is otherwise unresolvable — which is how a
 * DST-crossing series silently drifts by an hour.
 */
const zoneOffsetMinutes = (timeZone: string, instantMs: number): number => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(instantMs));
	const field = (type: string): number =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	const asUtc = Date.UTC(
		field("year"),
		field("month") - 1,
		field("day"),
		field("hour"),
		field("minute"),
		field("second"),
	);
	return (asUtc - instantMs) / 60_000;
};

/**
 * The zones this platform can be asked about.
 *
 * Read once from the runtime rather than probed per value: an unusable TZID —
 * a Windows zone name, a typo — makes `Intl` throw, and a resource written by a
 * client with a zone we cannot name is a resource to read in the next fallback,
 * never a crashed write. The list is the canonical IANA set, so a deprecated
 * alias falls through to the collection's own zone.
 */
const KNOWN_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

const isKnownZone = (timeZone: string): boolean => KNOWN_ZONES.has(timeZone);

/**
 * The offset a civil wall time carries in a zone. Applied twice because the
 * first lookup asks the zone about the wrong instant — the wall time read as if
 * it were UTC — which lands in the wrong side of a DST transition for wall
 * times within an hour or so of the cutover.
 */
const offsetForCivil = (
	timeZone: string,
	civil: ReturnType<typeof civilOf>,
): number => {
	const asUtc = Date.UTC(
		civil.year,
		civil.month - 1,
		civil.day,
		civil.hour,
		civil.minute,
		civil.second,
	);
	const firstPass = zoneOffsetMinutes(timeZone, asUtc);
	return zoneOffsetMinutes(timeZone, asUtc - firstPass * 60_000);
};

const formatOffset = (offsetMinutes: number): string => {
	const sign = offsetMinutes < 0 ? "-" : "+";
	return `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
};

const formatCivil = (
	civil: ReturnType<typeof civilOf>,
	offsetMinutes: number,
): string =>
	`${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)}T${pad(civil.hour)}:${pad(civil.minute)}:${pad(civil.second)}${formatOffset(offsetMinutes)}`;

export const toUtcIso = (instantMs: number): string =>
	`${new Date(instantMs).toISOString().slice(0, 19)}Z`;

/**
 * Resolves one iCalendar time to an instant and to its own wall-clock form.
 *
 * The zone is taken from the value itself when ical.js could bind one — a
 * VTIMEZONE defined in this very resource, or UTC. A floating value, and a
 * value whose TZID has no VTIMEZONE, falls back to `tzidHint` (the property's
 * own TZID parameter) and then to the collection's timezone, so a resource
 * written by a client that assumes the server knows the zone database still
 * lands on the right instant.
 *
 * Which of those happened is reported, never swallowed: a named zone that no
 * fallback could resolve comes back `Ambiguous`, so a caller can say the event
 * may be hours out instead of drawing it in the wrong place in silence.
 */
export const resolveTime = (
	time: ICAL.Time,
	tzidHint: string,
	collectionTimezone: string,
): ResolvedTime => {
	const civil = civilOf(time);

	let offsetMinutes: number;
	let certainty: ResolvedTime["certainty"];
	if (time.zone === ICAL.Timezone.utcTimezone) {
		offsetMinutes = 0;
		certainty = ZoneCertainty.Explicit;
	} else if (time.zone !== ICAL.Timezone.localTimezone) {
		offsetMinutes = time.utcOffset() / 60;
		certainty = ZoneCertainty.Explicit;
	} else {
		const fallback = [tzidHint, collectionTimezone].find(isKnownZone) ?? "UTC";
		offsetMinutes = offsetForCivil(fallback, civil);
		if (tzidHint === "") {
			// No zone was ever named. RFC 5545 floating time, read where the
			// collection lives.
			certainty = ZoneCertainty.Local;
		} else {
			certainty = isKnownZone(tzidHint)
				? ZoneCertainty.Explicit
				: ZoneCertainty.Ambiguous;
		}
	}

	const instantMs =
		Date.UTC(
			civil.year,
			civil.month - 1,
			civil.day,
			civil.hour,
			civil.minute,
			civil.second,
		) -
		offsetMinutes * 60_000;

	return {
		instantMs,
		isoUtc: toUtcIso(instantMs),
		isoOffset: formatCivil(civil, offsetMinutes),
		isDate: time.isDate,
		certainty,
	};
};

/** The TZID a property was written with, or `""` when it names none. */
export const tzidOf = (property: ICAL.Property | null): string => {
	const tzid = property?.getParameter("tzid");
	return typeof tzid === "string" ? tzid : "";
};
