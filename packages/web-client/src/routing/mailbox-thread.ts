import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

/** The conversation a folder has open, as the address states it. */
export interface MailboxThreadPath {
	threadId: string;
	/**
	 * Which message inside the thread is expanded and scrolled to. Absent on a
	 * bare thread address, where the newest message answers for the conversation.
	 */
	messageId: string | undefined;
}

/**
 * A conversation to open. The thread is what the pane fetches by; the message is
 * the row the reader pointed at, so a list always knows both.
 */
export interface MailboxThreadTarget {
	threadId: string;
	messageId: string;
}

/**
 * The thread a folder has open, read off the path.
 *
 * The thread is a child route of the list, and the list layout mounts the pane
 * above the `Outlet` — so it asks the router which of its children matched
 * rather than reading a param it does not own. Each `from` names a real route,
 * so a segment that does not exist fails to compile.
 */
export function useMailboxThreadPath(): MailboxThreadPath | undefined {
	const thread = useParams({
		from: "/mail/$mailboxId/$threadId",
		shouldThrow: false,
	});
	const message = useParams({
		from: "/mail/$mailboxId/$threadId/$messageId",
		shouldThrow: false,
	});
	const threadId = thread?.threadId;
	const messageId = message?.messageId;

	return useMemo(
		() => (threadId ? { threadId, messageId } : undefined),
		[threadId, messageId],
	);
}
