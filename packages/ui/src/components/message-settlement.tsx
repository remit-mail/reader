import { CloudOff } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

/**
 * The one unsettled state a message row can prove from the wire: a delete Remit
 * abandoned before running it, which handed the row back to the folder the mail
 * server still holds the message in (`hasAbandonedDelete` in @remit/data-ports,
 * which enumerates what this can and cannot see).
 *
 * A one-member union on purpose. A move that gave up leaves exactly the state a
 * move mid-retry leaves, so it is not derivable and gets no treatment here —
 * saying "Remit stopped retrying" over a push about to succeed would be a
 * louder lie than the silence this replaces. Adding a member is what a new
 * persisted signal would earn.
 */
export type RowSettlement = "delete_failed";

export const messageSettlementCopy = {
	delete_failed: {
		label: "Not deleted",
		title: "This message was not deleted",
		detail:
			"Remit removed it here first, then refused to finish the delete on the mail server — most often because the Trash folder it was headed for is not there any more. The message is back in this folder because that is where the server still has it.",
		retryLabel: "Delete again",
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
	 * Re-drives the delete through the ordinary delete endpoint, which accepts
	 * this row: the give-up put `status` back to `active`, so the placement
	 * guard passes it through. Omit only where no delete action is available.
	 */
	onRetry?: () => void;
	retryPending?: boolean;
	/** Prefilled issue link, for a retry that keeps failing. */
	reportHref?: string;
	className?: string;
}

/**
 * Reading-pane notice for a delete that gave up: what failed, where the message
 * actually is, and the two ways out — delete it again, or report it.
 */
export function MessageSettlementNotice({
	settlement,
	onRetry,
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
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							disabled={retryPending}
							className="font-medium text-accent hover:underline disabled:opacity-50"
						>
							{retryPending ? "Deleting…" : copy.retryLabel}
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
