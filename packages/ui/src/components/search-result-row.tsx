import { Flag } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";
import { provenanceFolderLabel, type ResultFolder } from "./folder-role.js";

export type SearchResultTone =
	| "neutral"
	| "accent"
	| "positive"
	| "warning"
	| "danger";

export interface SearchResult {
	id: string;
	sender: string;
	subject: string;
	snippet: string;
	date: string;
	unread?: boolean;
	flagged?: boolean;
	category?: { label: string; tone?: SearchResultTone };
	/**
	 * The thread this result belongs to. Lets the consumer open the conversation
	 * directly — even when the message isn't in the currently loaded list, which is
	 * the case for semantic "Related" hits surfaced from anywhere in the mailbox.
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
	/**
	 * Why a semantic ("Related") hit matched — a plain-language label derived
	 * from `matchedChunkType` (e.g. "body", "subject", "attachment"), so the user
	 * understands why the result showed up. Absent for literal "Top matches"
	 * rows, which match by construction.
	 */
	matchedChunkLabel?: string;
	/** Relevance figure (0–1) from the semantic engine; rendered beside the chip. */
	score?: number;
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

function highlight(text: string, query?: string): ReactNode {
	const term = query?.trim();
	if (!term) return text;
	const lower = text.toLowerCase();
	const needle = term.toLowerCase();
	const parts: ReactNode[] = [];
	let cursor = 0;
	let match = lower.indexOf(needle, cursor);
	let key = 0;
	while (match !== -1) {
		if (match > cursor) parts.push(text.slice(cursor, match));
		parts.push(
			<mark key={key++} className="bg-transparent font-semibold text-fg">
				{text.slice(match, match + needle.length)}
			</mark>,
		);
		cursor = match + needle.length;
		match = lower.indexOf(needle, cursor);
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts;
}

/**
 * One tappable search result. Mirrors the collapsed reading-pane row rhythm:
 * sender + right-aligned date on the top line, the subject, then a one-line
 * truncated snippet, with an optional category Badge and a flag indicator. The
 * sender bolds when unread. Presentational and prop-driven; the app supplies
 * `onClick` and the optional `query` to bold literal matches.
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
			className="flex w-full flex-col gap-0.5 border-b border-line px-row-inset py-2.5 text-left transition-colors hover:bg-surface-sunken"
		>
			<div className="flex items-baseline gap-2">
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						result.unread
							? "font-semibold text-fg"
							: "font-medium text-fg-muted",
					)}
				>
					{result.sender}
				</span>
				<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
					{result.date}
				</span>
			</div>
			<div className="flex items-center gap-1.5">
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						result.unread ? "text-fg" : "text-fg-muted",
					)}
				>
					{highlight(result.subject, query)}
				</span>
				{result.flagged && (
					<Flag className="size-3.5 shrink-0 fill-warning text-warning" />
				)}
			</div>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
					{highlight(result.snippet, query)}
				</span>
				{folderLabel && (
					<Badge tone="neutral" className="shrink-0">
						{folderLabel}
					</Badge>
				)}
				{result.category && (
					<Badge tone={result.category.tone ?? "neutral"} className="shrink-0">
						{result.category.label}
					</Badge>
				)}
				{result.matchedChunkLabel && (
					<Badge tone="neutral" className="shrink-0">
						{`matched: ${result.matchedChunkLabel}`}
					</Badge>
				)}
				{result.score != null && (
					<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
						{result.score.toFixed(2)}
					</span>
				)}
			</div>
		</button>
	);
}
