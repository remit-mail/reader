import {
	Archive,
	EllipsisVertical,
	FolderInput,
	Info,
	Mail,
	MailOpen,
	Star,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MoveToTrigger } from "./MoveToTrigger";

export interface MobileConversationTopBarProps {
	/** Whether a thread is open (gates action handlers). */
	hasThread: boolean;
	onArchive?: () => void;
	/** Whether an archive destination exists. When false the Archive button still renders active but explains on title. */
	canArchive?: boolean;
	onDelete?: () => void;
	onToggleStar?: () => void;
	isStarred?: boolean;
	onToggleRead?: () => void;
	isRead?: boolean;
	moveContext?: {
		accountId: string;
		currentMailboxId: string;
		onMove: (destinationMailboxId: string) => void;
	};
	/** Opens the intelligence bottom sheet. When omitted the ⓘ button is hidden. */
	onOpenIntelligence?: () => void;
	intelligenceOpen?: boolean;
}

/**
 * ⋮ overflow menu: mark read/unread + move. Rendered as a local toggle popover.
 * Dismissed on outside click or Escape.
 */
function OverflowMenu({
	onToggleRead,
	isRead,
	hasThread,
	moveContext,
}: {
	onToggleRead?: () => void;
	isRead?: boolean;
	hasThread: boolean;
	moveContext?: MobileConversationTopBarProps["moveContext"];
}) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handlePointer = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("keydown", handleKey);
		};
	}, [open]);

	const canToggleRead = hasThread && !!onToggleRead;
	const canMove = hasThread && !!moveContext;

	if (!canToggleRead && !canMove) return null;

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
				aria-label="More actions"
				aria-expanded={open}
				aria-haspopup="menu"
			>
				<EllipsisVertical className="size-5" />
			</button>

			{open && (
				<div
					role="menu"
					className="absolute right-0 top-full mt-1 z-50 min-w-44 flex flex-col bg-surface border border-line rounded-md shadow-lg"
				>
					{canToggleRead && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onToggleRead();
							}}
							className="flex items-center gap-3 px-4 py-3 min-h-11 text-sm text-left hover:bg-surface-raised transition-colors"
						>
							{isRead ? (
								<>
									<Mail className="size-4 shrink-0" />
									Mark as unread
								</>
							) : (
								<>
									<MailOpen className="size-4 shrink-0" />
									Mark as read
								</>
							)}
						</button>
					)}

					{canMove && moveContext && (
						/* vaul Drawer portals out of this subtree, so nesting is safe.
						   Close the menu row first so both surfaces don't stack. */
						<div className="flex items-center gap-3 px-4 py-0 min-h-11 text-sm hover:bg-surface-raised transition-colors">
							<FolderInput className="size-4 shrink-0 pointer-events-none" />
							<span className="flex-1 pointer-events-none text-sm">
								Move to folder
							</span>
							<div
								onClick={() => setOpen(false)}
								onKeyDown={() => setOpen(false)}
							>
								<MoveToTrigger
									accountId={moveContext.accountId}
									currentMailboxId={moveContext.currentMailboxId}
									onMove={moveContext.onMove}
									disabled={!hasThread}
									label="Move to folder"
									variant="icon-only"
								/>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Top app bar for the mobile conversation view.
 *
 * Primary actions (top bar): star, archive, delete, ⓘ intelligence.
 * Overflow ⋮ menu: mark read/unread, move to folder.
 *
 * Reply verbs stay in the bottom ActionBar and are not duplicated here.
 * All buttons are ≥44 × 44 px (min-h-11 min-w-11) for touch ergonomics.
 *
 * Per UX rules, no button is silently disabled — archive renders active
 * even when no destination mailbox exists; the title attribute explains why.
 */
export const MobileConversationTopBar = ({
	hasThread,
	onArchive,
	canArchive = true,
	onDelete,
	onToggleStar,
	isStarred,
	onToggleRead,
	isRead,
	moveContext,
	onOpenIntelligence,
	intelligenceOpen,
}: MobileConversationTopBarProps) => (
	<div className="flex h-12 shrink-0 items-center justify-end gap-0.5 border-b border-line bg-canvas px-1">
		<button
			type="button"
			onClick={onToggleStar}
			className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
			aria-label={isStarred ? "Remove flag" : "Flag"}
			title={isStarred ? "Remove flag" : "Flag"}
		>
			<Star
				className={cn("size-5", isStarred ? "fill-warning text-warning" : "")}
			/>
		</button>

		<button
			type="button"
			onClick={onArchive}
			className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
			aria-label="Archive"
			title={canArchive ? "Archive" : "No archive mailbox for this account"}
		>
			<Archive className="size-5" />
		</button>

		<button
			type="button"
			onClick={onDelete}
			className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
			aria-label="Move to Trash"
			title="Move to Trash"
		>
			<Trash2 className="size-5" />
		</button>

		<OverflowMenu
			onToggleRead={onToggleRead}
			isRead={isRead}
			hasThread={hasThread}
			moveContext={moveContext}
		/>

		{onOpenIntelligence !== undefined && (
			<button
				type="button"
				onClick={onOpenIntelligence}
				className={cn(
					"min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised",
					intelligenceOpen ? "bg-accent-2-soft text-accent-2" : "",
				)}
				aria-label={
					intelligenceOpen
						? "Hide intelligence panel"
						: "Show intelligence panel"
				}
				aria-pressed={intelligenceOpen}
				title="Intelligence"
			>
				<Info className="size-5" />
			</button>
		)}
	</div>
);
