import { RotateCcw, Send, Trash2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { LIST_ROW_ATTRIBUTE } from "../lib/roving-focus.js";
import type { OutboxStatus } from "./outbox-status-badge.js";
import { OutboxStatusBadge } from "./outbox-status-badge.js";
import { RowActions } from "./row-actions.js";

export interface OutboxRowProps {
	recipients: string;
	subject: string;
	/** Pre-formatted timestamp shown at the row's trailing edge. */
	time: string;
	status: OutboxStatus;
	/** Surfaced after the status label for failed/blocked rows. */
	error?: string;
	selected?: boolean;
	onSelect: () => void;
	/** Retry sending — present only for the `failed` status. */
	onRetry?: () => void;
	retrying?: boolean;
	onEdit: () => void;
	onDelete: () => void;
	deleting?: boolean;
}

const tintForStatus = (status: OutboxStatus, selected?: boolean): string => {
	if (selected) return "bg-accent-2-soft";
	if (status === "failed") return "bg-danger-soft";
	if (status === "blocked") return "bg-warning/10";
	return "";
};

/**
 * Status-tinted outbox message row composing OutboxStatusBadge and the shared
 * RowActions cluster. Presentational — the live route wires the callbacks to
 * mutations.
 */
export function OutboxRow({
	recipients,
	subject,
	time,
	status,
	error,
	selected,
	onSelect,
	onRetry,
	retrying,
	onEdit,
	onDelete,
	deleting,
}: OutboxRowProps) {
	const showActions = status === "failed" || status === "blocked";

	return (
		<div
			className={cn(
				"flex items-start gap-3 border-b border-line px-4 py-3 transition-colors hover:bg-surface-raised",
				tintForStatus(status, selected),
			)}
		>
			<button
				type="button"
				{...LIST_ROW_ATTRIBUTE}
				onClick={onSelect}
				className="flex flex-1 min-w-0 items-start gap-3 text-left"
			>
				<div className="mt-0.5 shrink-0">
					<OutboxStatusBadge status={status} iconOnly />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-2">
						<span className="truncate text-sm font-medium">{recipients}</span>
						<span className="shrink-0 text-xs text-fg-muted">{time}</span>
					</div>
					<div className="truncate text-sm">{subject || "No subject"}</div>
					<div className="mt-1 flex items-center gap-2">
						<OutboxStatusBadge status={status} />
						{error && (
							<span className="truncate text-xs text-fg-muted">— {error}</span>
						)}
					</div>
				</div>
			</button>
			{showActions && (
				<div className="shrink-0">
					<RowActions
						actions={[
							...(status === "failed" && onRetry
								? [
										{
											label: "Retry sending",
											iconOnly: true,
											icon: <RotateCcw className="size-3.5" />,
											busy: retrying,
											onClick: onRetry,
										} as const,
									]
								: []),
							{
								label: "Edit as draft",
								iconOnly: true,
								icon: <Send className="size-3.5" />,
								onClick: onEdit,
							},
						]}
						destructive={{
							label: "Delete message",
							iconOnly: true,
							icon: <Trash2 className="size-3.5" />,
							busy: deleting,
							confirm: {
								prompt: "Delete this message?",
								confirmLabel: "Delete",
							},
							onClick: onDelete,
						}}
					/>
				</div>
			)}
		</div>
	);
}
