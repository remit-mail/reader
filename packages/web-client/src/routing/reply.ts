import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import type { MailListRoute } from "@/lib/mail-route";
import { useBrowsedList } from "./browsed-list";
import { useRetainOpenPanels } from "./fragment";

/**
 * The three ways to answer a message. They are one path param rather than three
 * literal routes, so the reply is one address shape and the mode is a value the
 * composer reads.
 */
export const replyModes = ["reply", "reply-all", "forward"] as const;

export type ReplyMode = (typeof replyModes)[number];

const replyModeSchema = z.enum(replyModes);

/**
 * The reply route under each list that can have a conversation open. The outbox
 * has no thread segment, so it has no reply either.
 *
 * The draft is an optional segment of the same route rather than a child of it,
 * for the reason `compose/{-$outboxMessageId}` is: the first autosave adopts
 * the id it created while the reader is mid-sentence, and a child route would
 * unmount the composer to record it.
 */
const BRIEF_REPLY =
	"/mail/brief/$threadId/$messageId/$mode/{-$outboxMessageId}" as const;
const FLAGGED_REPLY =
	"/mail/flagged/$threadId/$messageId/$mode/{-$outboxMessageId}" as const;
const MAILBOX_REPLY =
	"/mail/$mailboxId/$threadId/$messageId/$mode/{-$outboxMessageId}" as const;

/** The conversation and the turn inside it that a reply answers. */
export interface ReplyTarget {
	threadId: string;
	messageId: string;
	mode: ReplyMode;
}

/**
 * The reply the address names.
 *
 * `unknown` is a hand-typed segment naming no mode. It is a case rather than a
 * throw because the conversation behind it is still open and readable, and the
 * pane says so where the composer would have been.
 */
export interface ReplyAddress {
	mode: ReplyMode;
	threadId: string;
	/** The message being answered, which is the segment above this one. */
	sourceMessageId: string;
	/** The draft it writes to, once the first autosave has made one. */
	outboxMessageId: string | undefined;
}

export type ReplySurface =
	| ({ kind: "reply" } & ReplyAddress)
	| { kind: "unknown"; segment: string };

interface ReplyParams {
	threadId: string;
	messageId: string;
	mode: string;
	outboxMessageId?: string;
}

/**
 * The reply match, if the address has one. Each `from` names a real route, so a
 * segment that does not exist fails to compile.
 *
 * A path matches one list at a time, so at most one of these answers.
 */
function useReplyParams(): ReplyParams | undefined {
	const brief = useParams({ from: BRIEF_REPLY, shouldThrow: false });
	const flagged = useParams({ from: FLAGGED_REPLY, shouldThrow: false });
	const mailbox = useParams({ from: MAILBOX_REPLY, shouldThrow: false });
	return brief ?? flagged ?? mailbox;
}

/**
 * The reply surface the address names, or none.
 *
 * The mode and the message it answers are both segments, so a reply cannot
 * exist without a source and neither fact has a second owner. The draft is the
 * segment under them, so a reload comes back to what was being written instead
 * of starting a second draft beside it.
 */
export function useReplySurface(): ReplySurface | undefined {
	const params = useReplyParams();
	if (!params) return undefined;
	const mode = replyModeSchema.safeParse(params.mode);
	if (!mode.success) return { kind: "unknown", segment: params.mode };
	return {
		kind: "reply",
		mode: mode.data,
		threadId: params.threadId,
		sourceMessageId: params.messageId,
		outboxMessageId: params.outboxMessageId,
	};
}

interface ReplyNavigation {
	to: typeof BRIEF_REPLY | typeof FLAGGED_REPLY;
	params: ReplyTarget & { outboxMessageId: string | undefined };
}

interface MailboxReplyNavigation {
	to: typeof MAILBOX_REPLY;
	params: ReplyTarget & {
		mailboxId: string;
		outboxMessageId: string | undefined;
	};
}

/**
 * Where a reply opens: under the message, in the list the reader is browsing.
 *
 * The brief is the fallback for the reason compose falls back to it — it always
 * exists and always mounts the conversation — so the frame before a folder id
 * resolves opens a composer rather than reporting that it cannot.
 */
function replyTarget(
	list: MailListRoute["list"] | undefined,
	mailboxId: string | undefined,
	target: ReplyTarget,
	outboxMessageId: string | undefined,
): ReplyNavigation | MailboxReplyNavigation {
	if (list === "flagged")
		return { to: FLAGGED_REPLY, params: { ...target, outboxMessageId } };
	if (list === "mailbox" && mailboxId)
		return {
			to: MAILBOX_REPLY,
			params: { ...target, mailboxId, outboxMessageId },
		};
	return { to: BRIEF_REPLY, params: { ...target, outboxMessageId } };
}

/**
 * Answer a message: the mode and the turn it answers, as one navigation.
 *
 * The message travels with the mode, so replying from a row the address had not
 * named yet opens the conversation on it and the composer over it in the same
 * transition — there is no "open it first, then reply" for the second half to
 * be dropped from.
 *
 * A push, so Back leaves the reply and returns the message it was written
 * under, and the query travels with it.
 */
export function useOpenReply(): (target: ReplyTarget) => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { list, mailboxId } = useBrowsedList();

	return useCallback(
		(target: ReplyTarget) => {
			navigate({
				...replyTarget(list, mailboxId, target, undefined),
				search: (prev: Record<string, unknown>) => prev,
				hash: retainPanels,
			});
		},
		[navigate, retainPanels, list, mailboxId],
	);
}

/**
 * Record the draft the reply just created, in the address.
 *
 * A replace, and every panel left alone: the reader started one message, so the
 * draft arriving under it is neither another step of history nor a move away
 * from what they have open over the conversation.
 */
export function useAdoptReplyDraft(): (outboxMessageId: string) => void {
	const navigate = useNavigate();
	const { list, mailboxId } = useBrowsedList();
	const surface = useReplySurface();

	return useCallback(
		(outboxMessageId: string) => {
			if (surface?.kind !== "reply") return;
			navigate({
				...replyTarget(
					list,
					mailboxId,
					{
						threadId: surface.threadId,
						messageId: surface.sourceMessageId,
						mode: surface.mode,
					},
					outboxMessageId,
				),
				search: (prev: Record<string, unknown>) => prev,
				hash: true,
				replace: true,
			});
		},
		[navigate, list, mailboxId, surface],
	);
}

/**
 * Close the reply, landing back on the message it was answering.
 *
 * A push, like opening it: dismissing a surface moves the reader on, and Back
 * is how they undo that. The conversation stayed matched behind the reply, so
 * this drops the segments below it rather than rebuilding an address.
 */
export function useCloseReply(): () => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { list, mailboxId } = useBrowsedList();
	const params = useReplyParams();

	return useCallback(() => {
		if (!params) return;
		const search = (prev: Record<string, unknown>) => prev;
		const hash = retainPanels;
		const message = { threadId: params.threadId, messageId: params.messageId };
		if (list === "flagged") {
			navigate({
				to: "/mail/flagged/$threadId/$messageId",
				params: message,
				search,
				hash,
			});
			return;
		}
		if (list === "mailbox" && mailboxId) {
			navigate({
				to: "/mail/$mailboxId/$threadId/$messageId",
				params: { ...message, mailboxId },
				search,
				hash,
			});
			return;
		}
		navigate({
			to: "/mail/brief/$threadId/$messageId",
			params: message,
			search,
			hash,
		});
	}, [navigate, retainPanels, list, mailboxId, params]);
}
