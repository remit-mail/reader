import type { CalendarSlotPick } from "@remit/ui";
import { createContext, type ReactNode, useContext } from "react";

/**
 * The slot a reader dragged out of the grid, handed to the composer the click
 * opened.
 *
 * It is not in the address on purpose. What a half-written event says is not a
 * fact about where the reader is, and a link to a composer pre-filled with
 * somebody else's Tuesday afternoon is not an address worth being able to send.
 * The composer opened without one starts on the day the calendar is showing.
 *
 * It lives in a module reached through the `@/` alias for the same reason
 * `CalendarShell`'s context does: the generated route tree imports route files
 * relatively, so a context declared inside one resolves to a second module
 * instance and hands the consumer an empty default.
 */
const CalendarComposeSeedCtx = createContext<CalendarSlotPick | undefined>(
	undefined,
);

export const CalendarComposeSeedProvider = ({
	pick,
	children,
}: {
	pick: CalendarSlotPick | undefined;
	children?: ReactNode;
}) => (
	<CalendarComposeSeedCtx.Provider value={pick}>
		{children}
	</CalendarComposeSeedCtx.Provider>
);

export const useCalendarComposeSeed = (): CalendarSlotPick | undefined =>
	useContext(CalendarComposeSeedCtx);
