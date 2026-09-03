import { CloudAlert, CloudOff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

/**
 * How far the last IMAP mutation on a message got, as the row can tell.
 * `settled` has no treatment, so it is not a member here: a caller with a
 * settled row passes nothing and nothing renders.
 *
 * The values mirror `messageSettlementOf` in @remit/data-ports, which derives
 * them from the `status`/`syncStatus` pair the message response carries. The
 * derivation lives there and only there; this module owns the words for it.
 */
export type RowSettlement = "in_flight" | "abandoned";

export interface MessageSettlementCopy {
	/** Chip text on a list row. */
	label: string;
	/** Headline of the reading-pane notice. */
	title: string;
	/** What happened and what it means for this message. */
	detail: string;
}

export const messageSettlementCopy: Record<
	RowSettlement,
	MessageSettlementCopy
> = {
	in_flight: {
		label: "Not synced yet",
		title: "Waiting for the mail server",
		detail:
			"This message was moved or deleted here first and the change is still being pushed. It settles on its own, usually within seconds.",
	},
	abandoned: {
		label: "Not synced",
		title: "This change never reached the mail server",
		detail:
			"This message was moved or deleted here first, and the push to the mail server failed until Remit stopped retrying. On the server the message is still where it was, and nothing retries it on its own.",
	},
};

const tones = {
	in_flight: "warning",
	abandoned: "danger",
} as const;

const icons = {
	in_flight: CloudAlert,
	abandoned: CloudOff,
} as const;

export interface MessageSettlementBadgeProps {
	settlement: RowSettlement;
	className?: string;
}

/**
 * List-row chip for a message whose last mutation has not settled. Sized for a
 * row, carries no action — a row is a link or a button and may not nest one.
 * The full statement and the way out live in {@link MessageSettlementNotice},
 * on the open message.
 */
export function MessageSettlementBadge({
	settlement,
	className,
}: MessageSettlementBadgeProps) {
	const copy = messageSettlementCopy[settlement];
	const Icon = icons[settlement];
	return (
		<Badge
			tone={tones[settlement]}
			className={cn("shrink-0", className)}
			title={copy.title}
			data-settlement={settlement}
		>
			<Icon className="size-3 shrink-0" aria-hidden />
			<span>{copy.label}</span>
		</Badge>
	);
}

export interface MessageSettlementNoticeProps {
	settlement: RowSettlement;
	/**
	 * Prefilled issue link. Present for `abandoned`, where nothing in the
	 * product re-drives the mutation and reporting it is the only way out;
	 * omitted for `in_flight`, which resolves itself.
	 */
	reportHref?: string;
	className?: string;
	children?: ReactNode;
}

/**
 * Reading-pane notice for a message whose last mutation has not settled. States
 * what failed and what it means, and — for a mutation that gave up — offers the
 * prefilled issue link, because no endpoint re-drives one.
 */
export function MessageSettlementNotice({
	settlement,
	reportHref,
	className,
	children,
}: MessageSettlementNoticeProps) {
	const copy = messageSettlementCopy[settlement];
	const Icon = icons[settlement];
	const abandoned = settlement === "abandoned";
	return (
		<div
			role={abandoned ? "alert" : "status"}
			data-testid="message-settlement-notice"
			data-settlement={settlement}
			className={cn(
				"flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
				abandoned
					? "border-danger/40 bg-danger-soft"
					: "border-line bg-surface-sunken",
				className,
			)}
		>
			<Icon
				className={cn(
					"mt-0.5 size-4 shrink-0",
					abandoned ? "text-danger" : "text-warning",
				)}
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<p className={cn("font-medium", abandoned ? "text-danger" : "text-fg")}>
					{copy.title}
				</p>
				<p className="mt-1 break-words text-fg-muted">{copy.detail}</p>
				{reportHref && (
					<a
						href={reportHref}
						target="_blank"
						rel="noreferrer"
						className="mt-1 inline-block font-medium text-accent hover:underline"
					>
						Report an issue
					</a>
				)}
				{children}
			</div>
		</div>
	);
}
