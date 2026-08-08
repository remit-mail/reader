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
