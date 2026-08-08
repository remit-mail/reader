import type { CalendarColorId } from "../components/calendar-types.js";

/**
 * A calendar's hue is data, so the utility names cannot be built by
 * interpolation — Tailwind only sees class strings it can read in source.
 * Every calendar colour therefore names its utilities once, here, and every
 * calendar surface reads them from this table.
 */
export interface CalendarColorClasses {
	/** Solid fill: the swatch, the dot, the left rail of a chip. */
	solid: string;
	/** Tinted fill for the body of a chip or a day cell. */
	soft: string;
	/** Text and icons that sit on `soft`, or on a plain surface. */
	text: string;
	/** Hairline in the calendar's own hue. */
	border: string;
	/** Border on the leading edge only — the rail a timed chip carries. */
	rail: string;
}

const table: Record<CalendarColorId, CalendarColorClasses> = {
	"cal-1": {
		solid: "bg-cal-1",
		soft: "bg-cal-1-soft",
		text: "text-cal-1",
		border: "border-cal-1",
		rail: "border-l-cal-1",
	},
	"cal-2": {
		solid: "bg-cal-2",
		soft: "bg-cal-2-soft",
		text: "text-cal-2",
		border: "border-cal-2",
		rail: "border-l-cal-2",
	},
	"cal-3": {
		solid: "bg-cal-3",
		soft: "bg-cal-3-soft",
		text: "text-cal-3",
		border: "border-cal-3",
		rail: "border-l-cal-3",
	},
	"cal-4": {
		solid: "bg-cal-4",
		soft: "bg-cal-4-soft",
		text: "text-cal-4",
		border: "border-cal-4",
		rail: "border-l-cal-4",
	},
	"cal-5": {
		solid: "bg-cal-5",
		soft: "bg-cal-5-soft",
		text: "text-cal-5",
		border: "border-cal-5",
		rail: "border-l-cal-5",
	},
	"cal-6": {
		solid: "bg-cal-6",
		soft: "bg-cal-6-soft",
		text: "text-cal-6",
		border: "border-cal-6",
		rail: "border-l-cal-6",
	},
};

export function calendarColorClasses(
	color: CalendarColorId,
): CalendarColorClasses {
	return table[color];
}
