/**
 * How much of a calendar surface the rail beside the grid is worth.
 *
 * The rail carries six calendars across three accounts and, in Option A, the
 * readings waiting to be answered; at a fixed 256px those names truncate on a
 * screen that has room to spare. So the width is a share of what the surface
 * actually has, stepped at the shell's own two thresholds, and draggable from
 * there.
 */
import { INTELLIGENCE_MIN_WIDTH, READING_PANE_MIN_WIDTH } from "@remit/ui";

/** The rail's resting width at each of the shell's tiers. */
const RESTING_WIDTH = { narrow: 224, wide: 264, wide2: 320 } as const;

/** Narrower than this the names truncate; wider than it the grid starts to hurt. */
const MIN_WIDTH = 176;
const MAX_WIDTH = 440;

export interface RailShare {
	/**
	 * Changes only when the surface crosses a tier. A panel group keyed on it
	 * takes the new resting width instead of holding the one it was mounted with.
	 */
	tier: string;
	size: number;
	minSize: number;
	maxSize: number;
}

export function railShare(surfaceWidth: number): RailShare {
	const width = Math.max(surfaceWidth, 1);
	const tier =
		width >= INTELLIGENCE_MIN_WIDTH
			? "wide2"
			: width >= READING_PANE_MIN_WIDTH
				? "wide"
				: "narrow";
	const share = (px: number) => Math.round((px / width) * 100);
	const minSize = Math.min(share(MIN_WIDTH), 40);
	return {
		tier,
		size: Math.max(share(RESTING_WIDTH[tier]), minSize),
		minSize,
		maxSize: Math.max(share(MAX_WIDTH), minSize + 5),
	};
}
