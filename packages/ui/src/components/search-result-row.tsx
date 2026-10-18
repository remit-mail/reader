import { cn } from "../lib/cn.js";
import type { ThreadRowData } from "./app-shell-types.js";
import { Badge } from "./badge.js";
import { provenanceFolderLabel, type ResultFolder } from "./folder-role.js";
import { ComfortableRowBody, comfortableRowClass } from "./message-row.js";

export type SearchResultTone =
	| "neutral"
	| "accent"
	| "positive"
	| "warning"
	| "danger";

export interface SearchResult {
	id: string;
	sender: string;
	/**
	 * Sender address. The avatar's color is keyed on it, so a message keeps the
	 * same circle in a search result as in the list it came from. Absent keys
	 * the avatar on the name.
	 */
	senderEmail?: string;
	subject: string;
	snippet: string;
	date: string;
	unread?: boolean;
	flagged?: boolean;
	category?: { label: string; tone?: SearchResultTone };
	/**
	 * The thread this result belongs to. Lets the consumer open the conversation
	 * directly, even when the message isn't in the currently loaded list.
	 */
	threadId?: string;
	/** The mailbox the result lives in; paired with {@link threadId} to open it. */
	mailboxId?: string;
	/**
	 * The folder this row was read from. A search that reaches every folder
	 * returns rows from all over, so the row says where it came from; see
	 * {@link provenanceFolderLabel} for which folders can be named.
	 */
	folder?: ResultFolder;
}

export interface SearchResultRowProps {
	result: SearchResult;
	onClick?: () => void;
	/** When given, literal (case-insensitive) matches are bolded in subject/snippet. */
	query?: string;
	/**
	 * Show the folder the row came from. Defaults to true. A search confined to
	 * one folder turns it off — every row would carry the same label, which is
	 * noise rather than provenance.
	 */
	showFolder?: boolean;
}

/**
 * A search result as list-row data. The engines return less than a list row
 * holds — no attachment flag, no thread count, no labels — so those fall away
 * rather than being invented. The category is not mapped here: the search
 * carries its own labelled chip, which the row renders in the badge slot.
 */
function searchResultRowData(result: SearchResult): ThreadRowData {
	return {
		id: result.id,
		fromName: result.sender,
		fromEmail: result.senderEmail ?? result.sender,
		subject: result.subject,
		snippet: result.snippet,
		timeLabel: result.date,
		isRead: !result.unread,
		starred: result.flagged,
		...(result.mailboxId ? { mailboxId: result.mailboxId } : {}),
	};
}

/**
 * One tappable search result — the same row the lists render.
 *
 * Search is a mode of the list, not a separate surface, so the row body is the
 * shared `ComfortableRowBody`: the sender avatar, the unread dot, the star and
 * the sender/subject/snippet rhythm all come from one implementation, and a
 * message looks the same whether it was found or scrolled to. Everything only a
 * search knows — the folder a row was read from and the search's own category
 * chip — rides in the row's badge slot. Presentational and prop-driven; the app supplies `onClick` and the
 * optional `query` to bold literal matches.
 */
export function SearchResultRow({
	result,
	onClick,
	query,
	showFolder = true,
}: SearchResultRowProps) {
	const folderLabel =
		showFolder && result.folder
			? provenanceFolderLabel(result.folder)
			: undefined;
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn("group", comfortableRowClass({}), "border-b border-line")}
		>
			<ComfortableRowBody
				thread={searchResultRowData(result)}
				highlightQuery={query}
				badge={
					<>
						{folderLabel && (
							<Badge tone="neutral" className="shrink-0">
								{folderLabel}
							</Badge>
						)}
						{result.category && (
							<Badge
								tone={result.category.tone ?? "neutral"}
								className="shrink-0"
							>
								{result.category.label}
							</Badge>
						)}
					</>
				}
			/>
		</button>
	);
}
