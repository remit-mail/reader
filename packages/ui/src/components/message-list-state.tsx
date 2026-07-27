import { AlertCircle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.js";

/** Non-ready states the flat mailbox list can be in. "ready" renders rows. */
export type ListState = "ready" | "loading" | "empty" | "error";

/**
 * Skeleton mirror of the live web-client MessageList LoadingSkeleton: eight
 * pulse rows shaped like a comfortable message row (sender / time, subject,
 * snippet). Kept visually identical so the cold-load mock matches production.
 */
export function MessageListLoading() {
	return (
		// biome-ignore lint/a11y/useSemanticElements: <div> with role="status" preserves block layout; <output> is inline
		<div
			className="space-y-0"
			role="status"
			aria-busy="true"
			aria-label="Loading messages"
		>
			{Array.from({ length: 8 }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: list is static, no stable id
				<div key={i} className="animate-pulse border-b border-line px-3 py-2">
					<div className="mb-2 flex items-center justify-between">
						<div className="h-4 w-32 rounded bg-surface-sunken" />
						<div className="h-3 w-16 rounded bg-surface-sunken" />
					</div>
					<div className="mb-2 h-4 w-48 rounded bg-surface-sunken" />
					<div className="h-3 w-full rounded bg-surface-sunken" />
				</div>
			))}
		</div>
	);
}

/**
 * How much of the collection the filter was applied to.
 *
 * `whole-folder` is a SQL `where` over the mailbox — an empty result means the
 * folder holds no matching mail. `loaded-pages` is a criterion evaluated over
 * the rows fetched so far, which D19-S3 keeps alive for the off-row criteria
 * (`senderTrust`, `dkimMismatch`) that page with a continuation token: an empty
 * result there means nothing matched yet, not that nothing matches.
 *
 * A value rather than a `complete` flag, so the day a third reach exists the
 * copy is a case to add and not a boolean to reinterpret.
 */
export type FilterReach = "whole-folder" | "loaded-pages";

/**
 * The active category filter, the way out of it, and how far it reached. All
 * three together: the label cannot arrive without its escape, and the reach
 * cannot be left to a default, because it decides which completeness sentence
 * is true.
 */
export interface MessageListFilter {
	/** Display label of the active category, e.g. "Personal". */
	label: string;
	reach: FilterReach;
	onClear: () => void;
}

export interface MessageListEmptyProps {
	/** Absent when no category filter is active. */
	filter?: MessageListFilter;
	/**
	 * Name of the collection being listed, e.g. "Inbox". Absent for a plain
	 * mailbox, which keeps the generic copy. Cross-account collections that are
	 * not mailboxes (Flagged) name themselves here rather than being called one.
	 */
	scopeLabel?: string;
	searchQuery?: string;
}

/**
 * Empty list state. Unfiltered copy mirrors the live MessageList EmptyState: a
 * plain "No messages…" line, switching to the search variant when a query is
 * active.
 *
 * Under a filter it says how much was read (design D19). An empty list looks
 * identical whether it is correct or broken, which is how #315's bug survived
 * a mailbox holding thousands of matching messages. The sentence comes from the
 * filter's own reach, so a filtered empty state always carries one and never
 * claims more than the query did.
 */
export function MessageListEmpty({
	filter,
	scopeLabel,
	searchQuery,
}: MessageListEmptyProps) {
	const query = searchQuery?.trim();

	if (!filter) {
		return (
			<EmptyFrame>
				<p className="text-fg-muted">{unfilteredCopy(query, scopeLabel)}</p>
			</EmptyFrame>
		);
	}

	return (
		<EmptyFrame>
			<p className="font-medium text-fg">
				{filteredHeadline(filter.label, scopeLabel, query)}
			</p>
			<p className="mt-1 text-sm text-fg-muted">
				{COMPLETENESS_COPY[filter.reach]}
			</p>
			<Button
				variant="secondary"
				size="sm"
				className="mt-4"
				onClick={filter.onClear}
			>
				Clear filter
			</Button>
		</EmptyFrame>
	);
}

/**
 * The one sentence a filtered empty list always carries. `loaded-pages` states
 * what is true of a bounded read and nothing more; the wording it should settle
 * on belongs with whoever moves the off-row criteria on-row (D7).
 */
const COMPLETENESS_COPY: Record<FilterReach, string> = {
	"whole-folder": "Every message in this folder was checked.",
	"loaded-pages": "Only the messages loaded so far were checked.",
};

function unfilteredCopy(
	query: string | undefined,
	scopeLabel: string | undefined,
): string {
	if (query) return "No messages match your search";
	if (scopeLabel) return `No messages in ${scopeLabel}`;
	return "No messages in this mailbox";
}

/** One string, not JSX, so the copy stays a single text node and reads whole. */
function filteredHeadline(
	filterLabel: string,
	scopeLabel: string | undefined,
	query: string | undefined,
): string {
	if (query) return `No results for “${query}” in ${filterLabel}`;
	if (scopeLabel) return `No ${filterLabel} mail in ${scopeLabel}`;
	return `No ${filterLabel} mail`;
}

function EmptyFrame({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-full flex-1 items-center justify-center">
			<div className="flex max-w-sm flex-col items-center justify-center p-8 text-center">
				{children}
			</div>
		</div>
	);
}

/**
 * Another page in flight below rows already rendered. Says so in words: a bare
 * spinner (`MessageList.tsx:1429-1433`) is one of the ways "not fetched yet"
 * reads as "nothing there".
 */
export function MessageListLoadingMore() {
	return (
		<div
			className="flex items-center justify-center gap-2 py-4 text-sm text-fg-muted"
			role="status"
			aria-live="polite"
		>
			<Loader2 className="size-4 animate-spin" aria-hidden="true" />
			<span>Loading more&hellip;</span>
		</div>
	);
}

/**
 * Fail-hard list error (ux.md): a centered, blocking message that stops the
 * list — never a toast, never a control left looking healthy. States plainly
 * what failed, surfaces the underlying message, and offers a way back (Retry)
 * plus a way for the failure to go somewhere (Report).
 */
export function MessageListError({
	message = "Something went wrong loading this mailbox.",
	onRetry,
	onReport,
}: {
	message?: string;
	onRetry?: () => void;
	onReport?: () => void;
}) {
	return (
		<div className="flex h-full flex-1 items-center justify-center p-4">
			<div
				role="alert"
				className="flex max-w-sm flex-col items-center justify-center gap-3 text-center"
			>
				<AlertCircle className="size-8 text-danger" aria-hidden="true" />
				<div>
					<p className="font-medium text-danger">Couldn't load messages</p>
					<p className="mt-1 break-words text-sm text-fg-muted">{message}</p>
				</div>
				<div className="flex items-center gap-2">
					{onRetry && (
						<Button variant="secondary" size="sm" onClick={onRetry}>
							Retry
						</Button>
					)}
					{onReport && (
						<Button variant="ghost" size="sm" onClick={onReport}>
							Report a problem
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
