import { MailOpen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileSelectionTopBarProps {
	selectedCount: number;
	onCancel: () => void;
	onDelete: () => void;
	onMarkAsRead?: () => void;
	selectedIds: string[];
}

/**
 * Mobile-specific top bar shown during multi-select mode.
 * All buttons have 44px minimum touch targets.
 */
export const MobileSelectionTopBar = ({
	selectedCount,
	onCancel,
	onDelete,
	onMarkAsRead,
}: MobileSelectionTopBarProps) => {
	return (
		<div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onCancel}
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded hover:bg-accent transition-colors"
					aria-label="Cancel selection"
				>
					<X className="size-4 text-muted-foreground" />
				</button>
				<span className="text-sm font-medium">
					{selectedCount} {selectedCount === 1 ? "message" : "messages"}{" "}
					selected
				</span>
			</div>
			<div className="flex items-center gap-1">
				{onMarkAsRead && (
					<button
						type="button"
						onClick={onMarkAsRead}
						className="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors hover:bg-accent"
						aria-label="Mark as read"
					>
						<MailOpen className="size-4" />
					</button>
				)}
				<button
					type="button"
					onClick={onDelete}
					className={cn(
						"min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors hover:bg-accent",
						"text-destructive",
					)}
					aria-label="Delete selected messages"
				>
					<Trash2 className="size-4" />
				</button>
			</div>
		</div>
	);
};
