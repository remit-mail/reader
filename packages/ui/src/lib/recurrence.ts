/**
 * Repeat rules in the words a person would say them.
 *
 * A rule is carried and shown as that sentence — "Every weekday, 09:15" — and
 * never as an RRULE the reader has to decode. The picker offers the handful of
 * rules a date can plausibly repeat by, worked out from the date itself, so
 * "every month" means the second Wednesday when that is the Wednesday you
 * clicked rather than a number nobody chose.
 */

const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const ORDINALS = ["first", "second", "third", "fourth", "last"];

/** No repeat at all — the value a one-off carries. */
export const NO_REPEAT = "";

/**
 * The rules on offer for a date, widest interval last. `startTime` is appended
 * when there is one, because "every weekday" without an hour is only half a
 * rule.
 */
export function repeatChoices(date: string, startTime: string): string[] {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
	const [year, month, dayOfMonth] = date.split("-").map(Number);
	const when = new Date(Date.UTC(year, month - 1, dayOfMonth));
	const weekday = WEEKDAY_NAMES[when.getUTCDay()];
	const ordinal = ORDINALS[Math.min(Math.floor((dayOfMonth - 1) / 7), 4)];
	const clock = startTime === "" ? "" : `, ${startTime}`;
	const onWeekdays = when.getUTCDay() >= 1 && when.getUTCDay() <= 5;

	return [
		`Every day${clock}`,
		...(onWeekdays ? [`Every weekday${clock}`] : []),
		`Every week on ${weekday}${clock}`,
		`Every month on the ${ordinal} ${weekday}${clock}`,
		`Every year on ${dayOfMonth} ${MONTH_NAMES[month - 1]}${clock}`,
	];
}

/* ------------------------------------------------------------------ */
/* A rule the offered ones do not cover                                */
/* ------------------------------------------------------------------ */

export type RecurrenceUnit = "day" | "week" | "month" | "year";

/**
 * A monthly rule can mean two different things about the same date, and which
 * one is meant is never derivable — the 14th and the second Tuesday coincide
 * this month and diverge the next.
 */
export type MonthlyMode = "dayOfMonth" | "weekdayOfMonth";

export type RecurrenceEnd =
	| { kind: "never" }
	| { kind: "onDate"; date: string }
	| { kind: "afterCount"; count: number };

export interface CustomRecurrence {
	/** How many units between occurrences. One means every one. */
	interval: number;
	unit: RecurrenceUnit;
	/** Weekday indexes, Sunday first. Read only when the unit is a week. */
	weekdays: number[];
	/** Read only when the unit is a month. */
	monthlyMode: MonthlyMode;
	ends: RecurrenceEnd;
}

/** Single-letter weekday labels, Sunday first, for a row of toggles. */
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export const weekdayName = (index: number): string => WEEKDAY_NAMES[index];

function parseDate(date: string): Date | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
	const [year, month, day] = date.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day));
}

/** The event's own day is what a custom rule starts from. */
export function defaultCustomRecurrence(date: string): CustomRecurrence {
	const when = parseDate(date);
	return {
		interval: 1,
		unit: "week",
		weekdays: when ? [when.getUTCDay()] : [],
		monthlyMode: "dayOfMonth",
		ends: { kind: "never" },
	};
}

/**
 * What the "on" ending offers before anyone picks a day: a year out, so the
 * field reads as a date rather than as an empty box.
 */
export function defaultEndDate(date: string): string {
	const when = parseDate(date);
	if (!when) return date;
	when.setUTCFullYear(when.getUTCFullYear() + 1);
	return when.toISOString().slice(0, 10);
}

/** "the second Tuesday", derived from the date the event sits on. */
export function ordinalWeekdayLabel(date: string): string {
	const when = parseDate(date);
	if (!when) return "";
	const dayOfMonth = when.getUTCDate();
	return `the ${ORDINALS[Math.min(Math.floor((dayOfMonth - 1) / 7), 4)]} ${
		WEEKDAY_NAMES[when.getUTCDay()]
	}`;
}

/** "day 14", the other reading of the same date. */
export function dayOfMonthLabel(date: string): string {
	const when = parseDate(date);
	return when ? `day ${when.getUTCDate()}` : "";
}

/** "3 October" — an end date read the way the rule reads it back. */
export function endDateLabel(date: string): string {
	const when = parseDate(date);
	return when
		? `${when.getUTCDate()} ${MONTH_NAMES[when.getUTCMonth()]}`
		: date;
}

function joinWords(parts: string[]): string {
	if (parts.length <= 1) return parts.join("");
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The rule as a sentence. Everything the editor can express reads back in
 * words — an RRULE is never shown, and never typed.
 */
export function formatCustomRecurrence(
	rule: CustomRecurrence,
	date: string,
	startTime: string,
): string {
	const every =
		rule.interval <= 1
			? `Every ${rule.unit}`
			: `Every ${rule.interval} ${rule.unit}s`;

	let on = "";
	if (rule.unit === "week" && rule.weekdays.length > 0)
		on = ` on ${joinWords(
			[...rule.weekdays].sort((a, b) => a - b).map(weekdayName),
		)}`;
	if (rule.unit === "month")
		on = ` on ${
			rule.monthlyMode === "dayOfMonth"
				? dayOfMonthLabel(date)
				: ordinalWeekdayLabel(date)
		}`;
	if (rule.unit === "year") {
		const when = parseDate(date);
		if (when)
			on = ` on ${when.getUTCDate()} ${MONTH_NAMES[when.getUTCMonth()]}`;
	}

	const clock = startTime === "" ? "" : `, ${startTime}`;
	const ends =
		rule.ends.kind === "onDate"
			? `, until ${endDateLabel(rule.ends.date)}`
			: rule.ends.kind === "afterCount"
				? `, ${rule.ends.count} times`
				: "";

	return `${every}${on}${clock}${ends}`;
}

/**
 * The inverse of `formatCustomRecurrence`, so reopening the editor shows the
 * rule the event already carries. A sentence it did not write — one of the
 * offered choices, or a rule read out of a mail — returns nothing, and the
 * editor starts from the event's own day instead.
 */
export function readCustomRecurrence(
	text: string,
	date: string,
): CustomRecurrence | undefined {
	let rest = text.trim();
	let ends: RecurrenceEnd = { kind: "never" };

	const times = rest.match(/,\s*(\d+) times$/);
	if (times) {
		ends = { kind: "afterCount", count: Number(times[1]) };
		rest = rest.slice(0, times.index);
	}

	const until = rest.match(/,\s*until (\d{1,2}) ([A-Z][a-z]+)$/);
	if (until) {
		const endDate = isoForDayMonth(Number(until[1]), until[2], date);
		if (endDate === "") return undefined;
		ends = { kind: "onDate", date: endDate };
		rest = rest.slice(0, until.index);
	}

	rest = rest.replace(/,\s*\d{2}:\d{2}$/, "");

	const head = rest.match(
		/^Every (?:(\d+) )?(day|week|month|year)s?(?: on (.+))?$/,
	);
	if (!head) return undefined;

	const interval = head[1] === undefined ? 1 : Number(head[1]);
	const unit = head[2] as RecurrenceUnit;
	const on = head[3] ?? "";
	const base = { ...defaultCustomRecurrence(date), interval, unit, ends };

	if (unit === "week") {
		if (on === "") return base;
		const names = on.split(/,\s*|\s+and\s+/);
		const weekdays = names.map((name) => WEEKDAY_NAMES.indexOf(name));
		if (weekdays.some((index) => index === -1)) return undefined;
		return { ...base, weekdays };
	}

	if (unit === "month") {
		if (/^day \d{1,2}$/.test(on)) return { ...base, monthlyMode: "dayOfMonth" };
		if (/^the \w+ [A-Z][a-z]+$/.test(on))
			return { ...base, monthlyMode: "weekdayOfMonth" };
		return on === "" ? base : undefined;
	}

	return base;
}

/** "3 October" against the event's own year, rolling forward if it has passed. */
function isoForDayMonth(day: number, month: string, from: string): string {
	const index = MONTH_NAMES.indexOf(month);
	const start = parseDate(from);
	if (index === -1 || !start) return "";
	const sameYear = new Date(Date.UTC(start.getUTCFullYear(), index, day));
	const when =
		sameYear < start
			? new Date(Date.UTC(start.getUTCFullYear() + 1, index, day))
			: sameYear;
	return when.toISOString().slice(0, 10);
}
