/**
 * A deliberately small natural-language reader for the quick-entry field.
 *
 * It handles the phrasings a person actually types at a calendar — a title, a
 * day, a time, a length, and who is coming — and it reports what it consumed
 * for each one. The point is not coverage; it is that the machine's reading is
 * on screen, attributed to the words it came from, before anything is
 * committed. Whatever it could not settle comes back in `unresolved`, and
 * whatever it filled in for you comes back in `assumptions`. Both are meant to
 * be rendered, not swallowed.
 */

export interface PhraseParse {
	/** What is left after the day, time, length and guests are taken out. */
	title: string;
	/** `YYYY-MM-DD`, empty when the phrase named no day. */
	date: string;
	/** The words the day was read from, e.g. "friday". */
	dateText: string;
	/** `HH:MM` on a 24-hour clock, empty when the phrase named no time. */
	startTime: string;
	startTimeText: string;
	/** Minutes; 0 when the phrase named no length. */
	durationMinutes: number;
	durationText: string;
	attendees: string[];
	attendeesText: string;
	/** Things the phrase never said, in the words the UI should show. */
	unresolved: string[];
	/** Defaults applied on the reader's own authority. */
	assumptions: string[];
}

const WEEKDAYS: Record<string, number> = {
	sun: 0,
	sunday: 0,
	mon: 1,
	monday: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	wed: 3,
	weds: 3,
	wednesday: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	fri: 5,
	friday: 5,
	sat: 6,
	saturday: 6,
};

const WEEKDAY_ALTERNATION = Object.keys(WEEKDAYS)
	.sort((a, b) => b.length - a.length)
	.join("|");

const DURATION_RE =
	/\b(?:for\s+)?(\d+(?:[.,]\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m)\b/i;
const CLOCK_RE =
	/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i;
const NOON_RE = /\b(noon|midday|midnight)\b/i;
const RELATIVE_DAY_RE = /\b(today|tonight|tomorrow)\b/i;
const NEXT_WEEKDAY_RE = new RegExp(
	`\\bnext\\s+(${WEEKDAY_ALTERNATION})\\b`,
	"i",
);
const WEEKDAY_RE = new RegExp(`\\b(?:on\\s+)?(${WEEKDAY_ALTERNATION})\\b`, "i");
const WITH_RE = /\bwith\s+(.+)$/i;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
	const next = new Date(d);
	next.setDate(next.getDate() + days);
	return next;
}

/** The soonest day with this weekday, today included. */
function comingWeekday(now: Date, weekday: number): Date {
	return addDays(now, (weekday - now.getDay() + 7) % 7);
}

function minutesFrom(amount: number, unit: string): number {
	const isHours = /^h/i.test(unit);
	return Math.round(isHours ? amount * 60 : amount);
}

function cut(source: string, match: RegExpMatchArray): string {
	const at = match.index ?? 0;
	return `${source.slice(0, at)} ${source.slice(at + match[0].length)}`;
}

function tidy(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.replace(/^[\s,;–-]+|[\s,;–-]+$/g, "")
		.replace(/\s+(on|at|with|for|from)$/i, "")
		.trim();
}

function splitNames(clause: string): string[] {
	return clause
		.split(/\s*(?:,|\band\b|&)\s*/i)
		.map((name) => tidy(name))
		.filter((name) => name.length > 0);
}

function readClock(match: RegExpMatchArray): string {
	if (match[3]) {
		const meridiem = match[3].toLowerCase();
		const hour12 = Number(match[1]) % 12;
		const hour = meridiem === "pm" ? hour12 + 12 : hour12;
		return `${pad(hour)}:${pad(Number(match[2] ?? 0))}`;
	}
	return `${pad(Number(match[4]))}:${pad(Number(match[5]))}`;
}

/**
 * Reads `phrase` against `now`. `now` is a parameter rather than a call to the
 * clock so the same phrase always gives the same answer in a story and a test.
 */
export function parseEventPhrase(phrase: string, now: Date): PhraseParse {
	let rest = ` ${phrase} `;
	const unresolved: string[] = [];
	const assumptions: string[] = [];

	let durationMinutes = 0;
	let durationText = "";
	const duration = rest.match(DURATION_RE);
	if (duration) {
		durationMinutes = minutesFrom(
			Number(duration[1].replace(",", ".")),
			duration[2],
		);
		durationText = duration[0].trim();
		rest = cut(rest, duration);
	}

	let startTime = "";
	let startTimeText = "";
	const named = rest.match(NOON_RE);
	const clock = rest.match(CLOCK_RE);
	if (named) {
		const word = named[1].toLowerCase();
		startTime = word === "midnight" ? "00:00" : "12:00";
		startTimeText = named[0].trim();
		rest = cut(rest, named);
	} else if (clock) {
		startTime = readClock(clock);
		startTimeText = clock[0].trim();
		rest = cut(rest, clock);
	}

	let date = "";
	let dateText = "";
	const relative = rest.match(RELATIVE_DAY_RE);
	const nextWeekday = rest.match(NEXT_WEEKDAY_RE);
	const weekday = rest.match(WEEKDAY_RE);
	if (relative) {
		const word = relative[1].toLowerCase();
		date = isoDate(word === "tomorrow" ? addDays(now, 1) : now);
		dateText = relative[0].trim();
		rest = cut(rest, relative);
	} else if (nextWeekday) {
		date = isoDate(
			addDays(comingWeekday(now, WEEKDAYS[nextWeekday[1].toLowerCase()]), 7),
		);
		dateText = nextWeekday[0].trim();
		rest = cut(rest, nextWeekday);
	} else if (weekday) {
		date = isoDate(comingWeekday(now, WEEKDAYS[weekday[1].toLowerCase()]));
		dateText = weekday[0].trim();
		rest = cut(rest, weekday);
	}

	let attendees: string[] = [];
	let attendeesText = "";
	const guests = tidy(rest).match(WITH_RE);
	if (guests) {
		attendees = splitNames(guests[1]);
		attendeesText = guests[0].trim();
		rest = tidy(rest).slice(0, guests.index ?? 0);
	}

	const title = tidy(rest);

	if (title === "") unresolved.push("No title yet");
	if (date === "") {
		date = isoDate(now);
		assumptions.push("No day given — using today");
	}
	if (startTime === "") {
		unresolved.push("No time given");
	} else if (durationMinutes === 0) {
		durationMinutes = 60;
		assumptions.push("No length given — using an hour");
	}

	return {
		title,
		date,
		dateText,
		startTime,
		startTimeText,
		durationMinutes,
		durationText,
		attendees,
		attendeesText,
		unresolved,
		assumptions,
	};
}

/** `13:00` + 90 → `14:30`. Empty in, empty out. */
export function addMinutesToClock(clock: string, minutes: number): string {
	if (clock === "") return "";
	const [hours, mins] = clock.split(":").map(Number);
	const total = (hours * 60 + mins + minutes) % 1440;
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
