/**
 * The few properties a reading pane needs that the occurrence listing does not
 * carry, read off the stored resource.
 *
 * This is not a parser and never becomes one. It reads three named properties
 * of the master VEVENT so the pane can show a location and the editor can send
 * one back unchanged; anything structural — recurrence expansion above all —
 * belongs to the server, which is the only thing that expands a series.
 */

/**
 * RFC 5545 breaks a long property across lines with a leading space or tab, so
 * the folds are joined before anything is matched — a value read fold-first
 * stops halfway through and looks like a shorter value rather than a broken one.
 */
const unfold = (icalData: string): string =>
	icalData.replace(/\r?\n[ \t]/g, "");

/** RFC 5545 3.3.11: the four escapes a TEXT value carries. */
const unescapeText = (value: string): string =>
	value
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");

/**
 * Where a content line's parameters end and its value begins.
 *
 * The separator is the first colon outside a quoted string, not the first colon
 * (RFC 5545 3.1). A parameter value is allowed to be quoted precisely so it can
 * hold one — `ALTREP="cid:part1"` is ordinary — and splitting on the first
 * colon hands back the tail of a URI as though it were the property's value.
 */
function valueAt(line: string, name: string): string | undefined {
	let quoted = false;
	for (let index = name.length; index < line.length; index += 1) {
		const character = line[index];
		if (index === name.length && character !== ";" && character !== ":")
			return undefined;
		if (character === '"') {
			quoted = !quoted;
			continue;
		}
		if (!quoted && character === ":") return line.slice(index + 1).trim();
	}
	return undefined;
}

/**
 * The first occurrence of a property, parameters and all. The master VEVENT is
 * written before its overrides, so the first match is the series' own value.
 */
function firstProperty(icalData: string, name: string): string {
	for (const line of unfold(icalData).split(/\r?\n/)) {
		if (!line.startsWith(name)) continue;
		const value = valueAt(line, name);
		if (value !== undefined) return value;
	}
	return "";
}

export const rruleFromIcalData = (icalData: string): string =>
	firstProperty(icalData, "RRULE");

export interface CalendarResourceText {
	location: string;
	description: string;
}

export const textFromIcalData = (icalData: string): CalendarResourceText => ({
	location: unescapeText(firstProperty(icalData, "LOCATION")),
	description: unescapeText(firstProperty(icalData, "DESCRIPTION")),
});
