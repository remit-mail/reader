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

/**
 * Message action toolbar on the pane-header datum (40px, the shared
 * `--spacing-pane-header`). The reading pane's verbs — reply / reply-all /
 * forward, then archive / delete / move / flag — Apple-Mail-style ghost
 * icon buttons, then the search field top-right (still filters the current
 * list), compose (✎) and the intelligence toggle (#422).
 *
 * Triage/reply verbs are presentational placeholders here: they dim when
 * no thread is open, and their tooltips carry the keys the global key
 * layer (#429) will bind. The working reply / reply-all / forward controls
 * live in the conversation's action bar (their redesign is #424). Compose,
 * search and the intelligence toggle are wired for real.
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
}: MessageToolbarProps) => (
	<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Reply className="size-4" />}
			title="Reply (r)"
			aria-label="Reply"
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<ReplyAll className="size-4" />}
			title="Reply all (a)"
			aria-label="Reply all"
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Forward className="size-4" />}
			title="Forward (f)"
			aria-label="Forward"
		/>
		<span className="mx-1 h-4 w-px bg-line" aria-hidden />
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Archive className="size-4" />}
			title="Archive (e)"
			aria-label="Archive"
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
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<FolderInput className="size-4" />}
			title="Move to mailbox"
			aria-label="Move to mailbox"
		/>
		<Button
			variant="ghost"
			size="sm"
			disabled={!hasThread}
			icon={<Star className="size-4" />}
			title="Flag (s)"
			aria-label="Flag"
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
