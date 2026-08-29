/**
 * How much of a day this device shows at once.
 *
 * A phone on a train and a monitor on a desk want different amounts of the
 * same week, and the answer belongs to the screen rather than to the calendar:
 * it is not a fact about the view, so it is in no tier of the address, and a
 * link shared from one device must not resize the day on another. Stored the
 * way the intelligence rail's preference is (`lib/intelligence-pref.ts`), and
 * a storage failure falls back to the default rather than crashing.
 */
import type { Density } from "@remit/ui";

export const CALENDAR_DENSITY_KEY = "remit:calendar-density";

/** Roomy enough to read a title at a glance, which is the common case. */
export const DEFAULT_CALENDAR_DENSITY: Density = "comfortable";

export function readCalendarDensity(): Density {
	try {
		return localStorage.getItem(CALENDAR_DENSITY_KEY) === "compact"
			? "compact"
			: DEFAULT_CALENDAR_DENSITY;
	} catch {
		return DEFAULT_CALENDAR_DENSITY;
	}
}

export function writeCalendarDensity(density: Density): void {
	try {
		localStorage.setItem(CALENDAR_DENSITY_KEY, density);
	} catch {
		// Storage unavailable — the in-memory default stands.
	}
}
