import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

/** The conversation a list has open, as the address states it. */
export interface OpenThreadPath {
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
export interface OpenThreadTarget {
	threadId: string;
	messageId: string;
}

/**
 * The thread the address has open, whichever list is browsing it.
 *
 * The thread is a child route of the list, and the list layout mounts the pane
 * above the `Outlet` — so it asks the router which of its children matched
 * rather than reading a param it does not own. A path matches one list at a
 * time, so one hook answers for every list rather than each list keeping its
 * own copy of the same question. Each `from` names a real route, so a segment
 * that does not exist fails to compile.
 */
export function useOpenThreadPath(): OpenThreadPath | undefined {
	const briefThread = useParams({
		from: "/mail/brief/$threadId",
		shouldThrow: false,
	});
	const briefMessage = useParams({
		from: "/mail/brief/$threadId/$messageId",
		shouldThrow: false,
	});
	const flaggedThread = useParams({
		from: "/mail/flagged/$threadId",
		shouldThrow: false,
	});
	const flaggedMessage = useParams({
		from: "/mail/flagged/$threadId/$messageId",
		shouldThrow: false,
	});
	const mailboxThread = useParams({
		from: "/mail/$mailboxId/$threadId",
		shouldThrow: false,
	});
	const mailboxMessage = useParams({
		from: "/mail/$mailboxId/$threadId/$messageId",
		shouldThrow: false,
	});

	const threadId =
		briefThread?.threadId ?? flaggedThread?.threadId ?? mailboxThread?.threadId;
	const messageId =
		briefMessage?.messageId ??
		flaggedMessage?.messageId ??
		mailboxMessage?.messageId;

	return useMemo(
		() => (threadId ? { threadId, messageId } : undefined),
		[threadId, messageId],
	);
}
