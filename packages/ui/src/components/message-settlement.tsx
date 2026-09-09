import { CloudOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

/**
 * What a message row can prove from the wire about a mutation that gave up: the
 * operation it gave up on, and nothing else. `abandonedMutationOf` in
 * @remit/data-ports owns which values prove it and enumerates the give-ups it
 * cannot see.
 *
 * One member per operation the user can watch fail, because naming the wrong
 * one is worse than naming none: a move that handed back used to render the
 * delete copy, under a button that deleted the message (issue #1229). A copy
 * that gave up has no member — its row is `deleted`, so no listing carries it.
 */
export type RowSettlement = "delete_failed" | "move_failed";

export const messageSettlementCopy = {
	delete_failed: {
		label: "Not deleted",
		title: "This message was not deleted",
		detail:
			"Remit removed it here first, then refused to finish the delete on the mail server — most often because the Trash folder it was headed for is not there any more. The message is back in this folder because that is where the server still has it.",
		retryLabel: "Delete again",
		retryPendingLabel: "Deleting…",
	},
	move_failed: {
		label: "Not moved",
		title: "This message was not moved",
		detail:
			"Remit filed it here first, then could not finish the move on the mail server and stopped trying. The message is back in this folder because that is where the server still has it. The folder you picked is not recorded, so moving it again means choosing one.",
		retryLabel: "Move again",
		retryPendingLabel: "Moving…",
	},
} as const;

export interface MessageSettlementBadgeProps {
	settlement: RowSettlement;
	className?: string;
}

/**
 * List-row chip. Carries no action — a row is a link or a button and may not
 * nest one. The statement and the way out live on the open message, in
 * {@link MessageSettlementNotice}.
 */
export function MessageSettlementBadge({
	settlement,
	className,
}: MessageSettlementBadgeProps) {
	const copy = messageSettlementCopy[settlement];
	return (
		<Badge
			tone="danger"
			className={cn("shrink-0", className)}
			title={copy.title}
			data-settlement={settlement}
		>
			<CloudOff className="size-3 shrink-0" aria-hidden />
			<span>{copy.label}</span>
		</Badge>
	);
}

export interface MessageSettlementNoticeProps {
	settlement: RowSettlement;
	/**
	 * Repeats the operation that failed, and only that one. For a delete that
	 * is the ordinary delete endpoint, which accepts this row: the give-up put
	 * `status` back to `active`, so the placement guard passes it through.
	 * Omit where the retry needs input from the user, and pass {@link action}
	 * instead.
	 */
	onRetry?: () => void;
	/**
	 * The retry, where repeating the operation needs the user to say more than
	 * "again" — a move has to be told which folder, because the destination the
	 * give-up discarded is not on the row. Rendered in place of the button.
	 */
	action?: ReactNode;
	retryPending?: boolean;
	/** Prefilled issue link, for a retry that keeps failing. */
	reportHref?: string;
	className?: string;
}

/**
 * Reading-pane notice for a mutation that gave up: which operation failed,
 * where the message actually is, and the two ways out — repeat that same
 * operation, or report it.
 */
export function MessageSettlementNotice({
	settlement,
	onRetry,
	action,
	retryPending,
	reportHref,
	className,
}: MessageSettlementNoticeProps) {
	const copy = messageSettlementCopy[settlement];
	return (
		<div
			role="alert"
			data-testid="message-settlement-notice"
			data-settlement={settlement}
			className={cn(
				"flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm",
				className,
			)}
		>
			<CloudOff className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="font-medium text-danger">{copy.title}</p>
				<p className="mt-1 break-words text-fg-muted">{copy.detail}</p>
				<div className="mt-1 flex flex-wrap items-center gap-3">
					{action}
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							disabled={retryPending}
							className="font-medium text-accent hover:underline disabled:opacity-50"
						>
							{retryPending ? copy.retryPendingLabel : copy.retryLabel}
						</button>
					)}
					{reportHref && (
						<a
							href={reportHref}
							target="_blank"
							rel="noreferrer"
							className="font-medium text-accent hover:underline"
						>
							Report an issue
						</a>
					)}
				</div>
			</div>
		</div>
	);
}
