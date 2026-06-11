import { Button } from "@remit/ui";
import {
	Archive,
	FolderInput,
	Forward,
	Info,
	Reply,
	ReplyAll,
	SquarePen,
	Star,
	Trash2,
} from "lucide-react";
import { SearchBar } from "@/components/layout/SearchBar";
import { MoveToTrigger } from "./MoveToTrigger";

/**
 * Message action toolbar on the pane-header datum (40px, the shared
 * `--spacing-pane-header`). The reading pane's verbs — reply / reply-all /
 * forward, then archive / delete / move / flag — Apple-Mail-style ghost
 * icon buttons, then the search field top-right (still filters the current
 * list), compose (✎) and the intelligence toggle (#422).
 *
 * Action callbacks are optional; when omitted the buttons remain in
 * their disabled presentational state (e.g. when no thread is open).
 */
export interface MessageToolbarProps {
	hasThread: boolean;
	onCompose: () => void;
	intelligenceOpen: boolean;
	/**
	 * Whether the intelligence toggle is shown at all. The rail is contextual
	 * to an open message, so the toggle only appears once a thread is selected
	 * (matches the remit-ui AppShell reference) — it never opens an empty rail.
	 */
	showIntelligenceToggle: boolean;
	onToggleIntelligence: () => void;
	searchValue: string;
	onSearchChange: (value: string) => void;
	onSearchClear: () => void;

	/* ---- wired action callbacks (omit to keep presentational) ---- */
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onArchive?: () => void;
	/**
	 * Whether an archive destination exists for the current account. When
	 * false the Archive button is disabled (dimmed) even with a thread open,
	 * so it never looks enabled while being a silent no-op.
	 */
	canArchive?: boolean;
	/** Delete all messages in the open thread. */
	onDelete?: () => void;
	/** Toggle the star on the most-recent message in the thread. */
	onToggleStar?: () => void;
	/** Whether the most-recent message is starred. */
	isStarred?: boolean;
	/**
	 * Move-to-mailbox trigger context. When present the FolderInput button
	 * is replaced by the full `MoveToTrigger` popover.
	 */
	moveContext?: {
		accountId: string;
		currentMailboxId: string;
		onMove: (destinationMailboxId: string) => void;
	};
}

export const MessageToolbar = ({
	hasThread,
	onCompose,
	intelligenceOpen,
	showIntelligenceToggle,
	onToggleIntelligence,
	searchValue,
	onSearchChange,
	onSearchClear,
	onReply,
	onReplyAll,
	onForward,
	onArchive,
	canArchive = true,
	onDelete,
	onToggleStar,
	isStarred,
	moveContext,
}: MessageToolbarProps) => (
	<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Reply className="size-4" />}
			title="Reply (r)"
			aria-label="Reply"
			onClick={onReply}
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<ReplyAll className="size-4" />}
			title="Reply all (a)"
			aria-label="Reply all"
			onClick={onReplyAll}
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Forward className="size-4" />}
			title="Forward (f)"
			aria-label="Forward"
			onClick={onForward}
		/>
		<span className="mx-1 h-4 w-px bg-line" aria-hidden />
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread || !canArchive}
			icon={<Archive className="size-4" />}
			title={canArchive ? "Archive (e)" : "No archive mailbox for this account"}
			aria-label="Archive"
			onClick={onArchive}
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Trash2 className="size-4" />}
			title="Delete (#)"
			// "Move to Trash" (no "Delete" substring) so this always-present
			// toolbar button's accessible name doesn't collide with the
			// message-action menu's bare "Delete" item. Playwright's getByRole
			// name match is substring-by-default, so "Delete message" would still
			// have matched name:"Delete" — "Move to Trash" does not. ("Trash" is
			// only used elsewhere as a sidebar *link*, a different role.)
			aria-label="Move to Trash"
			onClick={onDelete}
		/>
		{moveContext ? (
			<MoveToTrigger
				accountId={moveContext.accountId}
				currentMailboxId={moveContext.currentMailboxId}
				onMove={moveContext.onMove}
				disabled={!hasThread}
				label="Move to mailbox"
			/>
		) : (
			<Button
				variant="ghost"
				size="sm"
				disabled={!hasThread}
				icon={<FolderInput className="size-4" />}
				title="Move to mailbox"
				aria-label="Move to mailbox"
			/>
		)}
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={
				<Star
					className={`size-4${isStarred ? " fill-warning text-warning" : ""}`}
				/>
			}
			title="Flag (s)"
			aria-label="Flag"
			onClick={onToggleStar}
		/>
		<div className="flex-1" />
		{/* Apple Mail geometry: search sits top-right over the message area
		    but still filters the current list. Reuses the wired SearchBar
		    (the global "/" focus shortcut + Escape handling live in it). */}
		<div className="w-64 min-w-40 shrink">
			<SearchBar
				value={searchValue}
				onChange={onSearchChange}
				onClear={onSearchClear}
				placeholder="Search mail"
			/>
		</div>
		<span className="mx-1 h-4 w-px bg-line" aria-hidden />
		<Button
			variant="ghost"
			size="sm"
			icon={<SquarePen className="size-4" />}
			title="Compose (c)"
			aria-label="Compose"
			onClick={onCompose}
		/>
		{showIntelligenceToggle && (
			<Button
				variant="ghost"
				size="sm"
				icon={<Info className="size-4" />}
				title="Intelligence"
				aria-label={
					intelligenceOpen
						? "Hide intelligence sidebar"
						: "Show intelligence sidebar"
				}
				aria-pressed={intelligenceOpen}
				onClick={onToggleIntelligence}
				className={
					intelligenceOpen ? "bg-accent-2-soft text-accent-2" : undefined
				}
			/>
		)}
	</header>
);
