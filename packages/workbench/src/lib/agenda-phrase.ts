/**
 * The quick-entry reader, extended for the phrasings this option puts first.
 *
 * The kit's `parseEventPhrase` handles a title, a day, a clock time, a length
 * and guests. Typing is the primary create path here, so the sentence also has
 * to carry a repeat rule, a time range, a calendar date and a place — and,
 * where a sentence genuinely has two readings, it has to say so instead of
 * picking one. Those cases come back as `choices`: a question, the readings
 * that answer it, and which one is currently applied. Nothing is resolved
 * behind the reader's back.
 *
 * The extension works by taking its own phrasings out of the sentence first and
 * handing the remainder to the kit's reader, so there is one implementation of
 * the parts they share.
 */
import { addMinutesToClock, parseEventPhrase } from "@remit/ui";

export interface PhraseChoiceOption {
	id: string;
	label: string;
	/** Empty leaves the reading from the rest of the sentence alone. */
	date: string;
	startTime: string;
}

export interface PhraseChoice {
	id: string;
	question: string;
	/** The words the question is about. */
	source: string;
	options: PhraseChoiceOption[];
	chosenId: string;
}

export interface AgendaParse {
	title: string;
	date: string;
	dateText: string;
	startTime: string;
	startTimeText: string;
	endTime: string;
	durationMinutes: number;
	durationText: string;
	attendees: string[];
	attendeesText: string;
	location: string;
	locationText: string;
	/** Human-readable rule, empty for a one-off. */
	repeat: string;
	repeatText: string;
	/** Defaults the reader applied on its own authority. */
	assumptions: string[];
	/** What the sentence never said. */
	unresolved: string[];
	/** What the sentence said two ways. */
	choices: PhraseChoice[];
}

/** Choice id → option id, as answered by the person typing. */
export type ChoicePicks = Readonly<Record<string, string>>;

const WEEKDAY_FULL: Record<string, string> = {
	sun: "Sunday",
	sunday: "Sunday",
	mon: "Monday",
	monday: "Monday",
	tue: "Tuesday",
	tues: "Tuesday",
	tuesday: "Tuesday",
	wed: "Wednesday",
	weds: "Wednesday",
	wednesday: "Wednesday",
	thu: "Thursday",
	thur: "Thursday",
	thurs: "Thursday",
	thursday: "Thursday",
	fri: "Friday",
	friday: "Friday",
	sat: "Saturday",
	saturday: "Saturday",
};

const WEEKDAY_WORDS = Object.keys(WEEKDAY_FULL)
	.sort((a, b) => b.length - a.length)
	.join("|");

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

const MONTH_WORDS = MONTHS.join("|");

const RANGE_RE =
	/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i;
/* The lookbehind keeps the 30 in "12:30 june" from being read as a day. */
const DAY_MONTH_RE = new RegExp(
	`(?<![:.\\d])\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_WORDS})[a-z]*\\b`,
	"i",
);
const MONTH_DAY_RE = new RegExp(
	`\\b(${MONTH_WORDS})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
	"i",
);
const NEXT_WEEK_RE = /\bnext\s+week\b/i;
const BARE_HOUR_RE = /\bat\s+(\d{1,2})(?!\s*[:.]\d)(?!\s*(?:am|pm))\b/i;
const AT_SIGN_RE = /\s+@\s*([^,]+)$/;
const AT_PLACE_RE = /\bat\s+([A-Z][^,]*)$/;
const BARE_WEEKDAY_RE = new RegExp(`^(?:on\\s+)?(${WEEKDAY_WORDS})$`, "i");

interface RepeatRule {
	re: RegExp;
	rule: (match: RegExpMatchArray) => string;
	/** What is put back in place of the match, so the base reader still sees it. */
	keep: (match: RegExpMatchArray) => string;
}

const REPEAT_RULES: RepeatRule[] = [
	{ re: /\bevery\s+weekday\b/i, rule: () => "Every weekday", keep: () => "" },
	{
		re: new RegExp(`\\bevery\\s+other\\s+(${WEEKDAY_WORDS})s?\\b`, "i"),
		rule: (m) => `Every other ${WEEKDAY_FULL[m[1].toLowerCase()]}`,
		keep: (m) => m[1],
	},
	{
		re: new RegExp(`\\bevery\\s+(${WEEKDAY_WORDS})s?\\b`, "i"),
		rule: (m) => `Every ${WEEKDAY_FULL[m[1].toLowerCase()]}`,
		keep: (m) => m[1],
	},
	{
		re: /\bevery\s+(\d+)\s+weeks?\b/i,
		rule: (m) => `Every ${m[1]} weeks`,
		keep: () => "",
	},
	{ re: /\b(?:every\s+day|daily)\b/i, rule: () => "Every day", keep: () => "" },
	{
		re: /\b(?:every\s+week|weekly)\b/i,
		rule: () => "Every week",
		keep: () => "",
	},
	{
		re: /\b(?:every\s+month|monthly)\b/i,
		rule: () => "Every month",
		keep: () => "",
	},
];

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function isoDate(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function shiftIso(date: string, days: number): string {
	const cursor = new Date(`${date}T00:00:00Z`);
	cursor.setUTCDate(cursor.getUTCDate() + days);
	return cursor.toISOString().slice(0, 10);
}

function replaceAt(
	source: string,
	match: RegExpMatchArray,
	insert: string,
): string {
	const at = match.index ?? 0;
	return `${source.slice(0, at)} ${insert} ${source.slice(at + match[0].length)}`;
}

function tidy(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** "Fri 12 Jun". */
export function formatChoiceDay(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

function readMeridiem(hour: number, meridiem: string | undefined): number {
	if (!meridiem) return hour;
	const base = hour % 12;
	return meridiem.toLowerCase() === "pm" ? base + 12 : base;
}

interface RangeReading {
	startTime: string;
	endTime: string;
	minutes: number;
	text: string;
}

function readRange(match: RegExpMatchArray): RangeReading {
	const startMeridiem = match[3] ?? match[6];
	const endMeridiem = match[6] ?? match[3];
	let startHour = readMeridiem(Number(match[1]), startMeridiem);
	let endHour = readMeridiem(Number(match[4]), endMeridiem);
	const startMinute = Number(match[2] ?? 0);
	const endMinute = Number(match[5] ?? 0);
	if (startHour > 23) startHour -= 12;
	if (endHour * 60 + endMinute <= startHour * 60 + startMinute) endHour += 12;
	return {
		startTime: `${pad(startHour)}:${pad(startMinute)}`,
		endTime: `${pad(endHour % 24)}:${pad(endMinute)}`,
		minutes: endHour * 60 + endMinute - (startHour * 60 + startMinute),
		text: match[0].trim(),
	};
}

function readCalendarDate(
	dayOfMonth: number,
	monthWord: string,
	now: Date,
): string {
	const month = MONTHS.indexOf(monthWord.slice(0, 3).toLowerCase());
	const candidate = new Date(now.getFullYear(), month, dayOfMonth);
	if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate()))
		candidate.setFullYear(candidate.getFullYear() + 1);
	return isoDate(candidate);
}

/** The soonest Monday-to-Friday, today included. */
function comingWeekday(now: Date): Date {
	let cursor = new Date(now);
	while (cursor.getDay() === 0 || cursor.getDay() === 6)
		cursor = addDays(cursor, 1);
	return cursor;
}

export function parseAgendaPhrase(
	phrase: string,
	now: Date,
	picks: ChoicePicks = {},
): AgendaParse {
	let rest = ` ${phrase} `;
	const assumptions: string[] = [];
	const unresolved: string[] = [];
	const choices: PhraseChoice[] = [];

	let repeat = "";
	let repeatText = "";
	for (const rule of REPEAT_RULES) {
		const match = rest.match(rule.re);
		if (!match) continue;
		repeat = rule.rule(match);
		repeatText = match[0].trim();
		rest = replaceAt(rest, match, rule.keep(match));
		break;
	}

	let range: RangeReading | undefined;
	const rangeMatch = rest.match(RANGE_RE);
	if (rangeMatch) {
		range = readRange(rangeMatch);
		rest = replaceAt(rest, rangeMatch, range.startTime);
	}

	let overrideDate = "";
	let overrideDateText = "";
	const dayMonth = rest.match(DAY_MONTH_RE);
	const monthDay = rest.match(MONTH_DAY_RE);
	const nextWeek = rest.match(NEXT_WEEK_RE);
	if (dayMonth) {
		overrideDate = readCalendarDate(Number(dayMonth[1]), dayMonth[2], now);
		overrideDateText = dayMonth[0].trim();
		rest = replaceAt(rest, dayMonth, "");
	} else if (monthDay) {
		overrideDate = readCalendarDate(Number(monthDay[2]), monthDay[1], now);
		overrideDateText = monthDay[0].trim();
		rest = replaceAt(rest, monthDay, "");
	} else if (nextWeek) {
		overrideDate = isoDate(addDays(now, 7));
		overrideDateText = nextWeek[0].trim();
		rest = replaceAt(rest, nextWeek, "");
	}

	let bareHour = -1;
	const bare = rest.match(BARE_HOUR_RE);
	if (bare && !range) {
		bareHour = Number(bare[1]) % 12;
		rest = replaceAt(rest, bare, "");
	}

	let location = "";
	let locationText = "";
	const atSign = tidy(rest).match(AT_SIGN_RE);
	const atPlace = tidy(rest).match(AT_PLACE_RE);
	if (atSign) {
		location = tidy(atSign[1]);
		locationText = atSign[0].trim();
		rest = tidy(rest).slice(0, atSign.index ?? 0);
	} else if (atPlace) {
		location = tidy(atPlace[1]);
		locationText = atPlace[0].trim();
		rest = tidy(rest).slice(0, atPlace.index ?? 0);
	}

	const base = parseEventPhrase(tidy(rest), now);

	let date = overrideDate === "" ? base.date : overrideDate;
	const dateText = overrideDate === "" ? base.dateText : overrideDateText;
	let startTime = range ? range.startTime : base.startTime;
	const startTimeText = range ? range.text : base.startTimeText;

	for (const note of base.assumptions) {
		if (overrideDate !== "" && note.startsWith("No day given")) continue;
		if (range && note.startsWith("No length given")) continue;
		assumptions.push(note);
	}
	for (const note of base.unresolved) {
		if ((startTime !== "" || bareHour >= 0) && note.startsWith("No time given"))
			continue;
		unresolved.push(note);
	}

	if (repeat !== "" && overrideDate === "" && base.dateText === "") {
		const first = repeat === "Every weekday" ? comingWeekday(now) : now;
		date = isoDate(first);
		const index = assumptions.findIndex((note) =>
			note.startsWith("No day given"),
		);
		const wording = `No start day given — first one ${formatChoiceDay(date)}`;
		if (index === -1) assumptions.push(wording);
		else assumptions[index] = wording;
	}

	if (repeat !== "") unresolved.push("Repeats with no end — until you stop it");

	if (bareHour >= 0) {
		const morning = `${pad(bareHour === 0 ? 12 : bareHour)}:00`;
		const evening = `${pad((bareHour === 0 ? 12 : bareHour) + 12)}:00`;
		const preferred = bareHour >= 1 && bareHour <= 6 ? "evening" : "morning";
		const choice: PhraseChoice = {
			id: "hour",
			question: `"${bare?.[0].trim() ?? ""}" — morning or evening?`,
			source: bare?.[0].trim() ?? "",
			options: [
				{ id: "morning", label: morning, date: "", startTime: morning },
				{ id: "evening", label: evening, date: "", startTime: evening },
			],
			chosenId: picks.hour ?? preferred,
		};
		choices.push(choice);
		startTime =
			choice.options.find((option) => option.id === choice.chosenId)
				?.startTime ?? morning;
	}

	if (
		overrideDate === "" &&
		repeat === "" &&
		BARE_WEEKDAY_RE.test(base.dateText)
	) {
		const weekday =
			WEEKDAY_FULL[base.dateText.replace(/^on\s+/i, "").toLowerCase()];
		const later = shiftIso(base.date, 7);
		const choice: PhraseChoice = {
			id: "weekday",
			question: `Which ${weekday}?`,
			source: base.dateText,
			options: [
				{
					id: "soon",
					label: formatChoiceDay(base.date),
					date: base.date,
					startTime: "",
				},
				{
					id: "later",
					label: formatChoiceDay(later),
					date: later,
					startTime: "",
				},
			],
			chosenId: picks.weekday ?? "soon",
		};
		choices.push(choice);
		date =
			choice.options.find((option) => option.id === choice.chosenId)?.date ??
			base.date;
	}

	const durationMinutes = range
		? range.minutes
		: startTime === ""
			? base.durationMinutes
			: base.durationMinutes || 60;
	const endTime = range
		? range.endTime
		: addMinutesToClock(startTime, durationMinutes);

	if (startTime !== "" && !range && base.durationMinutes === 0 && bareHour >= 0)
		assumptions.push("No length given — using an hour");

	return {
		title: base.title,
		date,
		dateText,
		startTime,
		startTimeText,
		endTime,
		durationMinutes,
		durationText: range ? range.text : base.durationText,
		attendees: base.attendees,
		attendeesText: base.attendeesText,
		location,
		locationText,
		repeat,
		repeatText,
		assumptions,
		unresolved,
		choices,
	};
}
