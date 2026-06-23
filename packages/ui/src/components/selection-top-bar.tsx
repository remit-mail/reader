import { MailOpen, Trash2, X } from "lucide-react";
import { Button } from "./button.js";

/**
 * Replaces the list header in narrow-width multi-select: a count plus the bulk
 * verbs (cancel, mark read, delete). Real Buttons that never disable.
 */
export function SelectionTopBar({
	count,
	onCancel,
	onMarkRead,
	onDelete,
}: {
	count: number;
	onCancel: () => void;
	onMarkRead: () => void;
	onDelete: () => void;
}) {
	return (
		<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line bg-surface-sunken px-row-inset">
			<Button
				variant="ghost"
				size="sm"
				icon={<X className="size-4" />}
				onClick={onCancel}
				aria-label="Cancel selection"
				className="-ml-1 shrink-0"
			/>
			<span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
				{count} {count === 1 ? "message" : "messages"} selected
			</span>
			<Button
				variant="ghost"
				size="sm"
				icon={<MailOpen className="size-4" />}
				onClick={onMarkRead}
				aria-label="Mark as read"
				className="shrink-0"
			/>
			<Button
				variant="ghost"
				size="sm"
				icon={<Trash2 className="size-4 text-danger" />}
				onClick={onDelete}
				aria-label="Delete selected messages"
				className="shrink-0"
			/>
		</header>
	);
}
