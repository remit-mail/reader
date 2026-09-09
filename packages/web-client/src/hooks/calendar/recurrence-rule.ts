/**
 * Repeat rules, between the sentence a person picks and the RRULE the API
 * stores.
 *
 * The kit's picker deals only in sentences — "Every weekday, 09:15" — and the
 * calendar API deals only in RFC 5545 rules. This is the single table read both
 * ways, so a rule this client wrote reads back as the sentence it was picked
 * from. A rule written by anything else, a native client or an invitation, is
 * not forced into one of these sentences: it comes back unread, and the surface
 * says the event repeats without claiming to know how.
 */

const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const MONTHS = [
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

const ORDINAL_NUMBERS = [1, 2, 3, 4, -1];

const WEEKDAY_SET = "MO,TU,WE,TH,FR";

/** The clock the picker appends, stripped so the rule itself can be read. */
const withoutClock = (text: string): string =>
	text.replace(/,\s*\d{2}:\d{2}$/, "").trim();

/**
 * The RRULE a picked sentence means, or `undefined` for a sentence this table
 * does not cover. A caller refuses the write rather than storing a rule it
 * guessed at.
 */
export function rruleFromText(text: string): string | undefined {
	const rule = withoutClock(text);
	if (rule === "") return "";
	if (rule === "Every day") return "FREQ=DAILY";
	if (rule === "Every weekday") return `FREQ=WEEKLY;BYDAY=${WEEKDAY_SET}`;

	const weekly = rule.match(/^Every week on (\w+)$/);
	if (weekly) {
		const day = WEEKDAYS.indexOf(weekly[1]);
		return day === -1 ? undefined : `FREQ=WEEKLY;BYDAY=${BYDAY[day]}`;
	}

	const monthly = rule.match(/^Every month on the (\w+) (\w+)$/);
	if (monthly) {
		const ordinal = ORDINALS.indexOf(monthly[1]);
		const day = WEEKDAYS.indexOf(monthly[2]);
		if (ordinal === -1 || day === -1) return undefined;
		return `FREQ=MONTHLY;BYDAY=${ORDINAL_NUMBERS[ordinal]}${BYDAY[day]}`;
	}

	const yearly = rule.match(/^Every year on (\d{1,2}) (\w+)$/);
	if (yearly) {
		const month = MONTHS.indexOf(yearly[2]);
		if (month === -1) return undefined;
		return `FREQ=YEARLY;BYMONTH=${month + 1};BYMONTHDAY=${Number(yearly[1])}`;
	}

	return undefined;
}

const clockSuffix = (startTime: string): string =>
	startTime === "" ? "" : `, ${startTime}`;

/** The sentence an RRULE was picked from, or `undefined` where it was not. */
export function textFromRrule(
	rule: string,
	startTime: string,
): string | undefined {
	const parts = new Map(
		rule
			.split(";")
			.map((part) => part.split("="))
			.filter((pair): pair is [string, string] => pair.length === 2)
			.map(([name, value]) => [name.toUpperCase(), value.toUpperCase()]),
	);
	const clock = clockSuffix(startTime);
	const frequency = parts.get("FREQ");
	const byDay = parts.get("BYDAY");

	if (parts.has("INTERVAL") && parts.get("INTERVAL") !== "1") return undefined;
	if (parts.has("UNTIL") || parts.has("COUNT")) return undefined;

	if (frequency === "DAILY") return `Every day${clock}`;

	if (frequency === "WEEKLY") {
		if (byDay === undefined) return undefined;
		if (byDay === WEEKDAY_SET) return `Every weekday${clock}`;
		const day = BYDAY.indexOf(byDay);
		return day === -1 ? undefined : `Every week on ${WEEKDAYS[day]}${clock}`;
	}

	if (frequency === "MONTHLY") {
		const match = byDay?.match(/^(-?\d)([A-Z]{2})$/);
		if (!match) return undefined;
		const ordinal = ORDINAL_NUMBERS.indexOf(Number(match[1]));
		const day = BYDAY.indexOf(match[2]);
		if (ordinal === -1 || day === -1) return undefined;
		return `Every month on the ${ORDINALS[ordinal]} ${WEEKDAYS[day]}${clock}`;
	}

	if (frequency === "YEARLY") {
		const month = Number(parts.get("BYMONTH"));
		const day = Number(parts.get("BYMONTHDAY"));
		if (!month || !day || month > 12) return undefined;
		return `Every year on ${day} ${MONTHS[month - 1]}${clock}`;
	}

	return undefined;
}
