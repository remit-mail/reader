import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { useBrowsedList, useNavigateToBrowsedList } from "./browsed-list";
import { useRetainOpenPanels } from "./fragment";

/**
 * The compose route under each list. The draft is an optional segment of the
 * same route rather than a child of it, so adopting the id the first autosave
 * creates rewrites the address without unmounting the composer.
 */
const BRIEF_COMPOSE = "/mail/brief/compose/{-$outboxMessageId}" as const;
const FLAGGED_COMPOSE = "/mail/flagged/compose/{-$outboxMessageId}" as const;
const OUTBOX_COMPOSE = "/mail/outbox/compose/{-$outboxMessageId}" as const;
const MAILBOX_COMPOSE = "/mail/$mailboxId/compose/{-$outboxMessageId}" as const;

/**
 * The compose match, if the address has one. Each `from` names a real route, so
 * a segment that does not exist fails to compile.
 *
 * A path matches one list at a time, so at most one of these answers.
 */
function useComposeParams(): { outboxMessageId?: string } | undefined {
	const brief = useParams({ from: BRIEF_COMPOSE, shouldThrow: false });
	const flagged = useParams({ from: FLAGGED_COMPOSE, shouldThrow: false });
	const outbox = useParams({ from: OUTBOX_COMPOSE, shouldThrow: false });
	const mailbox = useParams({ from: MAILBOX_COMPOSE, shouldThrow: false });
	return brief ?? flagged ?? outbox ?? mailbox;
}

/**
 * Whether the compose surface is showing.
 *
 * Compose is a child route of the list it was started from, so "is compose
 * showing" is a question about the path rather than a flag somebody else has to
 * keep in step with it.
 */
export function useIsComposing(): boolean {
	return useComposeParams() !== undefined;
}

/**
 * The draft the open composer is writing to, or `undefined` while it is still a
 * message with nothing saved behind it.
 *
 * One owner: the address. A copy in React state disagrees with it the first
 * time the reader presses Back, and the composer comes back empty over a draft
 * row that is still listed.
 */
export function useComposeDraftId(): string | undefined {
	return useComposeParams()?.outboxMessageId;
}

interface ComposeNavigation {
	/** Which list's compose route, and the draft segment under it. */
	to: typeof BRIEF_COMPOSE | typeof FLAGGED_COMPOSE | typeof OUTBOX_COMPOSE;
	params: { outboxMessageId: string | undefined };
}

interface MailboxComposeNavigation {
	to: typeof MAILBOX_COMPOSE;
	params: { mailboxId: string; outboxMessageId: string | undefined };
}

/**
 * Where compose opens: the list being browsed, or the brief.
 *
 * Every case lands on a composer. The brief is the fallback rather than a
 * refusal because it always exists and always mounts the surface, so the two
 * addresses that name no folder — `/mail` on its way to the brief, and a folder
 * route in the frame before its id resolves — open a composer instead of
 * explaining why they cannot. A press that reports rather than writes is the
 * dead button this change deletes, and neither case has anything to report:
 * a message needs no folder to be written in.
 */
function composeTarget(
	list: "brief" | "flagged" | "outbox" | "mailbox" | undefined,
	mailboxId: string | undefined,
	outboxMessageId: string | undefined,
): ComposeNavigation | MailboxComposeNavigation {
	if (list === "flagged")
		return { to: FLAGGED_COMPOSE, params: { outboxMessageId } };
	if (list === "outbox")
		return { to: OUTBOX_COMPOSE, params: { outboxMessageId } };
	if (list === "mailbox" && mailboxId)
		return { to: MAILBOX_COMPOSE, params: { mailboxId, outboxMessageId } };
	return { to: BRIEF_COMPOSE, params: { outboxMessageId } };
}

/**
 * Navigate to compose on the list being browsed, on the draft named or on none.
 *
 * The draft travels as an argument rather than being set somewhere first: an
 * opener that had to do both could do only one, and the composer would come up
 * on whatever the last one left behind.
 */
function useComposeNavigate(): (
	outboxMessageId: string | undefined,
	options?: { replace?: boolean; keepPanels?: boolean },
) => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { list, mailboxId } = useBrowsedList();

	return useCallback(
		(
			outboxMessageId: string | undefined,
			options?: { replace?: boolean; keepPanels?: boolean },
		) => {
			navigate({
				...composeTarget(list, mailboxId, outboxMessageId),
				search: (prev: Record<string, unknown>) => prev,
				// Opening or closing the surface is going somewhere, so the panes the
				// reader keeps up travel and the overlays they were reading over do
				// not. Recording the draft is not going anywhere — the address is
				// rewritten under a composer they are still typing in — so whatever is
				// up stays up, sheet included.
				hash: options?.keepPanels ? true : retainPanels,
				replace: options?.replace ?? false,
			});
		},
		[navigate, retainPanels, list, mailboxId],
	);
}

/**
 * Start a new message.
 *
 * Takes nothing, because it is wired straight to buttons and key handlers: an
 * optional draft argument here would quietly receive a click event instead.
 * Resuming a draft is `useEditDraft`, which says so.
 *
 * A push, so Back leaves the surface and returns whatever it was opened over,
 * and the query travels with it — a compose started mid-search is still inside
 * that search.
 */
export function useOpenCompose(): () => void {
	const openCompose = useComposeNavigate();
	return useCallback(() => openCompose(undefined), [openCompose]);
}

/** Resume a draft: the same surface, addressed at what it is editing. */
export function useEditDraft(): (outboxMessageId: string) => void {
	const openCompose = useComposeNavigate();
	return useCallback(
		(outboxMessageId: string) => openCompose(outboxMessageId),
		[openCompose],
	);
}

/**
 * Record the draft the composer just created, in the address.
 *
 * A replace, and every panel left alone: the reader started one message, so the
 * draft arriving under it is neither another step of history nor a move away
 * from whatever they have open over the composer.
 */
export function useAdoptComposeDraft(): (outboxMessageId: string) => void {
	const openCompose = useComposeNavigate();
	return useCallback(
		(outboxMessageId: string) =>
			openCompose(outboxMessageId, { replace: true, keepPanels: true }),
		[openCompose],
	);
}

/**
 * Close compose, landing back on the list it was opened from.
 *
 * A push, like opening it: closing a surface moves the reader on, and Back is
 * how they undo that. Replacing the entry instead makes the press after a close
 * do nothing at all, because the entry behind it is the list they are already
 * looking at.
 *
 * Every branch leaves, the brief included. Leaving is what the reader asked
 * for, so a case this cannot name has to put them somewhere real rather than
 * return and strand them inside a surface they just dismissed.
 */
export function useCloseCompose(): () => void {
	return useNavigateToBrowsedList();
}
