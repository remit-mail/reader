/**
 * iCalendar fixtures, assembled from lines so the CRLF the RFC requires is
 * explicit rather than a property of this file's own line endings.
 */
export const ical = (...lines: string[]): string => `${lines.join("\r\n")}\r\n`;

/**
 * The same resource as a client that ignores RFC 5545 3.1 would send it. Real
 * `.ics` files arrive LF-only often enough — anything that has been through a
 * text-mode checkout, an editor, or a naive copy — that reading them is part of
 * the job, not an edge case.
 */
export const asLf = (icalData: string): string =>
	icalData.replace(/\r\n/g, "\n");

/**
 * Europe/Amsterdam as a client writes it into a resource. Present so a
 * DST-crossing series resolves against the definition the resource itself
 * carries, which is the only zone data RFC 5545 promises a server.
 */
export const AMSTERDAM_VTIMEZONE = [
	"BEGIN:VTIMEZONE",
	"TZID:Europe/Amsterdam",
	"BEGIN:DAYLIGHT",
	"TZOFFSETFROM:+0100",
	"TZOFFSETTO:+0200",
	"TZNAME:CEST",
	"DTSTART:19700329T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
	"END:DAYLIGHT",
	"BEGIN:STANDARD",
	"TZOFFSETFROM:+0200",
	"TZOFFSETTO:+0100",
	"TZNAME:CET",
	"DTSTART:19701025T030000",
	"RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
	"END:STANDARD",
	"END:VTIMEZONE",
];

export const singleEvent = (...eventLines: string[]): string =>
	ical(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Remit//Calendar Tests//EN",
		"BEGIN:VEVENT",
		"UID:fixture@example.com",
		"DTSTAMP:20260801T090000Z",
		...eventLines,
		"END:VEVENT",
		"END:VCALENDAR",
	);
