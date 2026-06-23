import { AlertCircle } from "lucide-react";
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
		<div className="space-y-0" aria-busy="true" aria-label="Loading messages">
			{Array.from({ length: 8 }).map((_, i) => (
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
 * Empty mailbox / empty-search state. Copy mirrors the live MessageList
 * EmptyState: a plain "No messages…" line, switching to the search variant
 * when a query is active.
 */
export function MessageListEmpty({ searchQuery }: { searchQuery?: string }) {
	const isSearching = Boolean(searchQuery?.trim());
	return (
		<div className="flex h-full flex-1 items-center justify-center">
			<div className="flex flex-col items-center justify-center p-8 text-center">
				<p className="text-fg-muted">
					{isSearching
						? "No messages match your search"
						: "No messages in this mailbox"}
				</p>
			</div>
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
