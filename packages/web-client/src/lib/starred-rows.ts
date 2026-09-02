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
 *
 * Generic over anything naming its thread, so the same collapse runs over the
 * API rows and over the merged display rows a text search produces — two
 * definitions of "same conversation" is one too many. A row that names no
 * thread is never merged: there is nothing to say it is the same conversation
 * as any other.
 */
export const dedupeByThread = <T extends { threadId?: string }>(
	items: T[],
): T[] => {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (item.threadId === undefined) return true;
		if (seen.has(item.threadId)) return false;
		seen.add(item.threadId);
		return true;
	});
};
