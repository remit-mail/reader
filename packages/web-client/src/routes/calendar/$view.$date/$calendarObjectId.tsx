// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /calendar/{view}/{date}/{calendarObjectId} — an event open in the reading
 * pane, mirroring `$threadId` under a mail list.
 *
 * A layout, because one instance of a series nests under it: the series is what
 * the address names, and the occurrence is the segment below.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/calendar/$view/$date/$calendarObjectId")(
	{
		component: Outlet,
	},
);
