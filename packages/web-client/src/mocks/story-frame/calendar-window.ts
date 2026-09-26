import type { RemitImapCalendarEventInstance } from "@remit/api-http-client/types.gen.ts";

/**
 * The occurrences inside the window a request asked for.
 *
 * The panes read a week at a time and hold several weeks at once, so a server
 * that answered every window with the same list would draw each day's events
 * once per window it appears in.
 */
export const instancesWithin = (
	url: URL,
	instances: readonly RemitImapCalendarEventInstance[],
): RemitImapCalendarEventInstance[] => {
	const from = Date.parse(url.searchParams.get("from") ?? "");
	const to = Date.parse(url.searchParams.get("to") ?? "");
	if (Number.isNaN(from) || Number.isNaN(to)) return [...instances];
	return instances.filter((instance) => {
		const start = Date.parse(instance.start);
		return start >= from && start < to;
	});
};
