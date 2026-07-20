/**
 * OutboxPane — compound component for the outbox view (/mail/outbox route).
 *
 * Usage in mail.tsx:
 *
 *   <OutboxPane>
 *     <AppShellSlotted
 *       list={<OutboxPane.List />}
 *       reading={<OutboxPane.Reading />}
 *     />
 *   </OutboxPane>
 *
 * On phone/tablet, use `<OutboxPane.Phone />` instead of the slot sub-views.
 */
import {
	outboxDetailOperationsDeleteOutboxMessageMutation,
	outboxDetailOperationsSendOutboxMessageMutation,
	outboxOperationsListOutboxMessagesOptions,
	outboxOperationsListOutboxMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapOutboxMessageResponse,
	RemitImapOutboxMessageStatus,
} from "@remit/api-http-client/types.gen.ts";
import { OutboxRow, ReadingPaneEmpty } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	Clock,
	Loader2,
	Send,
} from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { MessageBody } from "@/components/mail/MessageBody";
import { NavMenuButton } from "@/components/mail/NavMenuButton";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import { useSearchTokenContext } from "@/hooks/useSearchTokenContext";
import { formatDate as formatLocaleDate, toDate } from "@/lib/format";
import { useMailContext } from "@/lib/mail-context";
import {
	matchesOutboxSearch,
	outboxQueryIsUnsupported,
} from "@/lib/outbox-search";
import { isOutboxListRow, isUnsendableStatus } from "@/lib/outbox-status";
import { normalizeSearchQuery } from "@/lib/search-query";
import { parseSearchTokens } from "@/lib/search-tokens";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Helpers (shared between List, Reading, Phone sub-views)             */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
	Exclude<RemitImapOutboxMessageStatus, "draft">,
	{ icon: typeof Send; label: string; className: string }
> = {
	queued: {
		icon: Clock,
		label: "Queued",
		className: "text-warning",
	},
	sending: {
		icon: Loader2,
		label: "Sending…",
		className: "text-accent-2",
	},
	sent: {
		icon: CheckCircle,
		label: "Sent",
		className: "text-positive",
	},
	failed: {
		icon: AlertCircle,
		label: "Failed",
		className: "text-danger",
	},
	blocked: {
		icon: AlertTriangle,
		label: "Blocked",
		className: "text-warning",
	},
};

const formatDate = (timestamp: number): string => {
	const date = toDate(timestamp);
	const isToday = date.toDateString() === new Date().toDateString();
	return isToday
		? formatLocaleDate(timestamp, { hour: "numeric", minute: "2-digit" })
		: formatLocaleDate(timestamp, { month: "short", day: "numeric" });
};

const formatDateFull = (timestamp: number): string =>
	formatLocaleDate(timestamp, { dateStyle: "medium", timeStyle: "short" });

const formatRecipients = (message: RemitImapOutboxMessageResponse): string => {
	const recipients = message.toAddresses ?? [];
	if (recipients.length === 0) return "No recipients";
	if (recipients.length === 1) return recipients[0];
	return `${recipients[0]} +${recipients.length - 1}`;
};

/**
 * What an empty outbox list says. A query that filtered everything out reads
 * differently from an empty outbox, and a query the outbox cannot serve at all
 * has to say so rather than look like a search that found nothing.
 */
const outboxEmptyMessage = (
	hasQuery: boolean,
	unsupportedQuery: boolean,
): string => {
	if (unsupportedQuery) return "The outbox cannot filter on those terms";
	if (hasQuery) return "No matching outbox messages";
	return "No outbox messages";
};

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface OutboxPaneContextValue {
	/** Outbox rows, narrowed by the search query when one is active. */
	messages: RemitImapOutboxMessageResponse[];
	/** True while a query is narrowing `messages` — the empty state differs. */
	hasQuery: boolean;
	/** True when that query asks for a filter the outbox cannot apply. */
	unsupportedQuery: boolean;
	isLoading: boolean;
	selectedMessageId: string | undefined;
	selectedMessage: RemitImapOutboxMessageResponse | undefined;
	onSelectMessage: (id: string | undefined) => void;
}

const OutboxPaneCtx = createContext<OutboxPaneContextValue | null>(null);

function useOutboxPane(): OutboxPaneContextValue {
	const ctx = useContext(OutboxPaneCtx);
	if (!ctx) throw new Error("OutboxPane.* must be used inside <OutboxPane>");
	return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

interface OutboxPaneProps {
	children: ReactNode;
}

function OutboxPaneProvider({ children }: OutboxPaneProps) {
	const navigate = useNavigate();
	// Read selectedOutboxMessageId from the URL directly — this avoids threading
	// a prop through the parent shell for a param that only outbox uses.
	const { selectedOutboxMessageId: selectedMessageId } = useSearch({
		strict: false,
	}) as { selectedOutboxMessageId?: string };

	const { data: outboxResponse, isLoading } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	// The top bar's field scopes to this view (`in:outbox`), so a query typed
	// here narrows these rows. The list is small and already fully loaded, so
	// the narrowing is a filter over what is in hand — see lib/outbox-search.ts
	// for which fields it matches and why the filter tokens are not honored.
	// The query is parsed the same way every other engine parses it, and only
	// the free text is used: `Q3 from:billing` still matches on "Q3" rather
	// than searching the rows for the literal string "from:billing".
	const { searchQuery } = useMailContext();
	const tokenContext = useSearchTokenContext();
	const normalizedQuery = normalizeSearchQuery(searchQuery);
	const parsedQuery = parseSearchTokens(normalizedQuery, tokenContext);
	const hasQuery = normalizedQuery.length > 0;
	const unsupportedQuery = outboxQueryIsUnsupported(parsedQuery);

	// Outbox surfaces in-flight + actionable rows only. `draft` lives in the
	// Drafts view; `sent` rows are deleted by the IMAP append handler once
	// the message lands in Sent (issue #178), but we filter defensively so a
	// successfully-sent row never lingers in the Outbox list even if APPEND
	// has not completed yet (issue #193).
	const messages = useMemo(
		() =>
			unsupportedQuery
				? []
				: (outboxResponse?.items ?? [])
						.filter((item) => isOutboxListRow(item.status))
						.filter((item) => matchesOutboxSearch(item, parsedQuery.freeText)),
		[outboxResponse, parsedQuery.freeText, unsupportedQuery],
	);

	const selectedMessage = useMemo(
		() => messages.find((m) => m.outboxMessageId === selectedMessageId),
		[messages, selectedMessageId],
	);

	const handleSelectMessage = useCallback(
		(id: string | undefined) => {
			navigate({
				to: "/mail/outbox",
				search: (prev) => ({
					...prev,
					selectedOutboxMessageId: id,
				}),
			});
		},
		[navigate],
	);

	const ctx: OutboxPaneContextValue = {
		messages,
		hasQuery,
		unsupportedQuery,
		isLoading,
		selectedMessageId,
		selectedMessage,
		onSelectMessage: handleSelectMessage,
	};

	return (
		<OutboxPaneCtx.Provider value={ctx}>{children}</OutboxPaneCtx.Provider>
	);
}

/* ------------------------------------------------------------------ */
/* Row component                                                        */
/* ------------------------------------------------------------------ */

interface OutboxMessageRowProps {
	message: RemitImapOutboxMessageResponse;
	isSelected: boolean;
	onSelect: () => void;
}

function OutboxMessageRow({
	message,
	isSelected,
	onSelect,
}: OutboxMessageRowProps) {
	const queryClient = useQueryClient();
	const { openCompose } = useCompose();
	const { pushError } = useErrorBanners();

	const invalidateOutbox = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: outboxOperationsListOutboxMessagesQueryKey(),
		});
	}, [queryClient]);

	const retryMutation = useMutation({
		...outboxDetailOperationsSendOutboxMessageMutation(),
		onSuccess: invalidateOutbox,
		onError: (error) => {
			// A failed retry must not look successful — surface it. A fatal 5xx
			// also escalates through the global MutationCache.onError sink.
			pushError(
				buildMutationErrorBanner(
					"Couldn't resend message",
					"The message wasn't sent.",
					error,
				),
			);
		},
	});

	const deleteMutation = useMutation({
		...outboxDetailOperationsDeleteOutboxMessageMutation(),
		onSuccess: invalidateOutbox,
		onError: (error) => {
			pushError(
				buildMutationErrorBanner(
					"Couldn't delete message",
					"The message wasn't deleted.",
					error,
				),
			);
		},
	});

	const status = message.status as Exclude<
		RemitImapOutboxMessageStatus,
		"draft"
	>;
	if (!STATUS_CONFIG[status]) return null;

	const showError = isUnsendableStatus(message.status);

	return (
		<OutboxRow
			recipients={formatRecipients(message)}
			subject={message.subject || ""}
			time={formatDate(message.sentAt ?? message.updatedAt)}
			status={status}
			error={showError ? (message.lastError ?? undefined) : undefined}
			selected={isSelected}
			onSelect={onSelect}
			onRetry={
				status === "failed"
					? () =>
							retryMutation.mutate({
								path: { outboxMessageId: message.outboxMessageId },
							})
					: undefined
			}
			retrying={retryMutation.isPending}
			onEdit={() =>
				openCompose({
					mode: "new",
					outboxMessageId: message.outboxMessageId,
				})
			}
			onDelete={() =>
				deleteMutation.mutate({
					path: { outboxMessageId: message.outboxMessageId },
				})
			}
			deleting={deleteMutation.isPending}
		/>
	);
}

/* ------------------------------------------------------------------ */
/* Detail component                                                     */
/* ------------------------------------------------------------------ */

interface OutboxMessageDetailProps {
	message: RemitImapOutboxMessageResponse;
	onBack?: () => void;
}

function OutboxMessageDetail({ message, onBack }: OutboxMessageDetailProps) {
	const status = message.status as Exclude<
		RemitImapOutboxMessageStatus,
		"draft"
	>;
	const config = STATUS_CONFIG[status];
	const StatusIcon = config?.icon ?? Send;
	const sentLabel = message.sentAt
		? formatDateFull(message.sentAt)
		: formatDateFull(message.updatedAt);

	return (
		<div className="h-full overflow-y-auto bg-canvas">
			<div className="border-b border-line p-4">
				{onBack && (
					<button
						type="button"
						onClick={onBack}
						className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
					>
						<ArrowLeft className="size-4" />
						<span>Back</span>
					</button>
				)}
				<h1 className="text-xl font-semibold mb-3">
					{message.subject || "(No subject)"}
				</h1>
				<div className="space-y-1 text-sm">
					<div className="flex gap-2">
						<span className="text-fg-muted shrink-0 w-12">From:</span>
						<span className="text-fg">
							{message.fromName
								? `${message.fromName} <${message.fromAddress}>`
								: message.fromAddress}
						</span>
					</div>
					<div className="flex gap-2">
						<span className="text-fg-muted shrink-0 w-12">To:</span>
						<span className="text-fg">
							{(message.toAddresses ?? []).join(", ")}
						</span>
					</div>
					{message.ccAddresses && message.ccAddresses.length > 0 && (
						<div className="flex gap-2">
							<span className="text-fg-muted shrink-0 w-12">Cc:</span>
							<span className="text-fg">{message.ccAddresses.join(", ")}</span>
						</div>
					)}
					<div className="flex gap-2">
						<span className="text-fg-muted shrink-0 w-12">Date:</span>
						<span className="text-fg">{sentLabel}</span>
					</div>
					{config && (
						<div className="flex items-center gap-2 pt-2">
							<StatusIcon
								className={cn(
									"size-4",
									config.className,
									status === "sending" && "animate-spin",
								)}
							/>
							<span className={cn("text-xs font-medium", config.className)}>
								{config.label}
							</span>
							{isUnsendableStatus(message.status) && message.lastError && (
								<span className="text-xs text-fg-muted">
									— {message.lastError}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
			<div className="p-4">
				<MessageBody html={message.htmlBody} text={message.textBody} />
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                            */
/* ------------------------------------------------------------------ */

/**
 * Outbox list with datum bar header. Mount in the `list` slot of `AppShellSlotted`.
 */
function OutboxList() {
	const {
		messages,
		hasQuery,
		unsupportedQuery,
		isLoading,
		selectedMessageId,
		onSelectMessage,
	} = useOutboxPane();

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center bg-canvas">
				<span className="text-fg-muted">Loading...</span>
			</div>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="flex h-full bg-surface">
				<ReadingPaneEmpty
					message={outboxEmptyMessage(hasQuery, unsupportedQuery)}
					showHints={false}
				/>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col bg-canvas">
			{/* List datum bar (40px, the shared `--spacing-pane-header`): keeps
			    the bottom hairline on the same y as the mailbox view so the grid
			    line stays continuous across nav → outbox (no staircase, #422). */}
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<NavMenuButton />
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					Outbox
				</h1>
				<span className="shrink-0 text-2xs text-fg-subtle">
					{messages.length} {messages.length === 1 ? "message" : "messages"}
				</span>
			</header>
			<div className="flex-1 overflow-y-auto">
				{messages.map((message) => (
					<OutboxMessageRow
						key={message.outboxMessageId}
						message={message}
						isSelected={selectedMessageId === message.outboxMessageId}
						onSelect={() => onSelectMessage(message.outboxMessageId)}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * Outbox reading pane. Mount in the `reading` slot of `AppShellSlotted`.
 * Only rendered ≥ 1024px.
 */
function OutboxReading() {
	const { selectedMessage } = useOutboxPane();

	return (
		<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
			{/* Detail datum bar (40px): outbox has no message-action toolbar,
			    but the datum bar must be present so its bottom hairline lines
			    up with the list pane's, keeping the grid continuous (#422). */}
			<header className="flex h-pane-header shrink-0 items-center border-b border-line px-3" />
			<div className="min-h-0 flex-1 overflow-hidden">
				{selectedMessage ? (
					<OutboxMessageDetail message={selectedMessage} />
				) : (
					<ReadingPaneEmpty
						message="Select a message to read"
						showHints={false}
					/>
				)}
			</div>
		</section>
	);
}

/**
 * Phone view: detail when a message is selected, or the list.
 * Mount in the `list` slot of `AppShellSlotted` on single-pane tiers.
 */
function OutboxPhone() {
	const {
		messages,
		hasQuery,
		unsupportedQuery,
		isLoading,
		selectedMessageId,
		selectedMessage,
		onSelectMessage,
	} = useOutboxPane();

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center bg-canvas">
				<span className="text-fg-muted">Loading...</span>
			</div>
		);
	}

	if (selectedMessage) {
		return (
			<OutboxMessageDetail
				message={selectedMessage}
				onBack={() => onSelectMessage(undefined)}
			/>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="flex h-full bg-surface">
				<ReadingPaneEmpty
					message={outboxEmptyMessage(hasQuery, unsupportedQuery)}
					showHints={false}
				/>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col bg-canvas">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<NavMenuButton />
				<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					Outbox
				</h1>
				<span className="shrink-0 text-2xs text-fg-subtle">
					{messages.length} {messages.length === 1 ? "message" : "messages"}
				</span>
			</header>
			<div className="flex-1 overflow-y-auto">
				{messages.map((message) => (
					<OutboxMessageRow
						key={message.outboxMessageId}
						message={message}
						isSelected={selectedMessageId === message.outboxMessageId}
						onSelect={() => onSelectMessage(message.outboxMessageId)}
					/>
				))}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Compound component assembly                                          */
/* ------------------------------------------------------------------ */

const OutboxPane = Object.assign(OutboxPaneProvider, {
	List: OutboxList,
	Reading: OutboxReading,
	Phone: OutboxPhone,
});

export { OutboxPane };
