import type { ReactNode } from "react";
import type { CalendarsResult } from "@/hooks/calendar";
import { NavLink } from "@/routing";

/**
 * Whether there is a calendar an answer can write to. Declining and muting
 * write none, so only adding waits on this.
 */
export type CalendarWriteGate = "ready" | "loading" | "failed" | "none";

export function calendarWriteGate(
	calendars: Pick<CalendarsResult, "defaultCalendarId" | "isLoading" | "error">,
): CalendarWriteGate {
	if (calendars.defaultCalendarId !== "") return "ready";
	if (calendars.error !== null) return "failed";
	if (calendars.isLoading) return "loading";
	return "none";
}

/**
 * Why adding waits, with the way past it. Undefined when nothing stops it, so a
 * host can hand the answer straight to a card's `addBlocked`.
 */
export function calendarUnavailable(
	gate: CalendarWriteGate,
	reportHref: string,
): ReactNode | undefined {
	if (gate === "ready") return undefined;
	if (gate === "loading") return "Reading your calendars…";
	if (gate === "failed")
		return (
			<>
				Couldn't read your calendars, so there is nowhere to add this yet.
				Reload to try again.{" "}
				<a
					href={reportHref}
					target="_blank"
					rel="noreferrer"
					className="font-medium text-accent hover:underline"
				>
					Report an issue
				</a>
			</>
		);
	return (
		<>
			You have no calendar yet, so there is nowhere to add this.{" "}
			<NavLink
				to="/settings/calendars"
				className="font-medium text-accent hover:underline"
			>
				Create a calendar
			</NavLink>
		</>
	);
}
