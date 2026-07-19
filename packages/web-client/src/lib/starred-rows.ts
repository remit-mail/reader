import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";

/**
 * Collapse rows that are the same conversation.
 *
 * A message's identity includes its mailbox, so the same mail filed in two
 * folders is two rows carrying the same server-side star. The starred scope
 * already excludes the folder that causes this wholesale (Gmail's All Mail),
 * but an ordinary copy in a user folder still produces a pair.
 *
 * Deduping over the accumulated pages rather than inside one keeps a
 * conversation single even when its copies straddle a page boundary — a single
 * page cannot know what earlier pages already showed. The first row wins, which
 * is the newest under the server's descending order.
 */
export const dedupeByThread = (
	items: RemitImapThreadMessageResponse[],
): RemitImapThreadMessageResponse[] => {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.threadId)) return false;
		seen.add(item.threadId);
		return true;
	});
};
