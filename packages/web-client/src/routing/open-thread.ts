import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useBrowsedList, useNavigateToBrowsedList } from "./browsed-list";
import { useRetainOpenPanels } from "./fragment";

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

/** How an open differs from the plain one, where it does. */
export interface OpenThreadOptions {
	/** Replace the entry rather than push one, so Back skips the row. */
	replace?: boolean;
	/**
	 * Commit this query with the open. The debounced q-mirror walks back up to
	 * the list when a query goes active, so a row tapped before the debounce
	 * settles is closed again a moment later unless the address already says the
	 * query the conversation was opened under. Omitted, the open carries whatever
	 * query the address already had.
	 */
	query?: string;
	/**
	 * Open under this mailbox rather than the one being browsed. A search hit
	 * carries its own, so a row can never open under a mailbox it does not belong
	 * to.
	 */
	mailboxId?: string;
}

/**
 * Open a conversation on the list the reader is browsing.
 *
 * The thread is a child route of its list, so the list decides the address and
 * the caller only names the conversation. The brief is the fallback, and legal
 * for any thread: a list with no thread route under it — the outbox — and a
 * mailbox route in the frame before its id resolves both still open the
 * conversation rather than doing nothing, which is the dead row this route shape
 * exists to delete.
 */
export function useOpenThread(): (
	target: OpenThreadTarget,
	options?: OpenThreadOptions,
) => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { list, mailboxId: browsedMailboxId } = useBrowsedList();

	return useCallback(
		(target: OpenThreadTarget, options?: OpenThreadOptions) => {
			const query = options?.query;
			const search = (prev: Record<string, unknown>) =>
				query === undefined ? prev : { ...prev, q: query || undefined };
			const rest = {
				search,
				hash: retainPanels,
				replace: options?.replace ?? false,
			};
			if (list === "flagged") {
				navigate({
					to: "/mail/flagged/$threadId/$messageId",
					params: target,
					...rest,
				});
				return;
			}
			const mailboxId = options?.mailboxId ?? browsedMailboxId;
			if (list === "mailbox" && mailboxId) {
				navigate({
					to: "/mail/$mailboxId/$threadId/$messageId",
					params: { mailboxId, ...target },
					...rest,
				});
				return;
			}
			navigate({
				to: "/mail/brief/$threadId/$messageId",
				params: target,
				...rest,
			});
		},
		[navigate, retainPanels, list, browsedMailboxId],
	);
}

/**
 * Close the conversation, landing back on the list it was opened from.
 *
 * A navigation up rather than a flag, so nothing is left mounted below the list
 * and Esc unwinds exactly one step.
 */
export function useCloseThread(): () => void {
	return useNavigateToBrowsedList();
}
