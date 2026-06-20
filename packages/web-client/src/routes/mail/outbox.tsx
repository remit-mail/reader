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
import {
	OutboxRow,
	ReadingPaneEmpty,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	CheckCircle,
	Clock,
	Loader2,
	Send,
} from "lucide-react";
import { z } from "zod";
import { useCompose } from "@/components/compose/ComposeProvider";
import { MessageBody } from "@/components/mail/MessageBody";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { isOutboxListRow, isUnsendableStatus } from "@/lib/outbox-status";
import { cn } from "@/lib/utils";

const outboxSearchSchema = z.object({
	selectedOutboxMessageId: z.string().optional(),
});

type OutboxSearch = z.infer<typeof outboxSearchSchema>;

export const Route = createFileRoute("/mail/outbox")({
	component: OutboxView,
	validateSearch: outboxSearchSchema,
});

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
	const date = new Date(timestamp);
	const now = new Date();
	const isToday = date.toDateString() === now.toDateString();

	if (isToday) {
		return date.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
	}

	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
};

const formatDateFull = (timestamp: number): string => {
	const date = new Date(timestamp);
	return date.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
};

const formatRecipients = (message: RemitImapOutboxMessageResponse): string => {
	const recipients = message.toAddresses ?? [];
	if (recipients.length === 0) return "No recipients";
	if (recipients.length === 1) return recipients[0];
	return `${recipients[0]} +${recipients.length - 1}`;
};

interface OutboxMessageRowProps {
	message: RemitImapOutboxMessageResponse;
	isSelected: boolean;
	onSelect: () => void;
}

const OutboxMessageRow = ({
	message,
	isSelected,
	onSelect,
}: OutboxMessageRowProps) => {
	const queryClient = useQueryClient();
	const { openCompose } = useCompose();
	const { pushError } = useErrorBanners();

	const invalidateOutbox = () => {
		queryClient.invalidateQueries({
			queryKey: outboxOperationsListOutboxMessagesQueryKey(),
		});
	};

	const retryMutation = useMutation({
		...outboxDetailOperationsSendOutboxMessageMutation(),
		onSuccess: () => {
			invalidateOutbox();
		},
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
		onSuccess: () => {
			invalidateOutbox();
		},
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
};

interface OutboxMessageDetailProps {
	message: RemitImapOutboxMessageResponse;
	onBack?: () => void;
}

const OutboxMessageDetail = ({ message, onBack }: OutboxMessageDetailProps) => {
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
};

function OutboxView() {
	const { selectedOutboxMessageId } = Route.useSearch();
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();

	const { data: outboxResponse, isLoading } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	// Outbox surfaces in-flight + actionable rows only. `draft` lives in the
	// Drafts view; `sent` rows are deleted by the IMAP append handler once
	// the message lands in Sent (issue #178), but we filter defensively so a
	// successfully-sent row never lingers in the Outbox list even if APPEND
	// has not completed yet (issue #193).
	const messages = (outboxResponse?.items ?? []).filter((item) =>
		isOutboxListRow(item.status),
	);

	const selected = messages.find(
		(m) => m.outboxMessageId === selectedOutboxMessageId,
	);

	const selectMessage = (id: string | undefined) => {
		navigate({
			to: "/mail/outbox",
			search: (prev: OutboxSearch) => ({
				...prev,
				selectedOutboxMessageId: id,
			}),
		});
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center bg-canvas">
				<span className="text-fg-muted">Loading...</span>
			</div>
		);
	}

	// Empty state: single centered icon + label, no two-column split.
	if (messages.length === 0) {
		return (
			<div className="flex h-full bg-surface">
				<ReadingPaneEmpty message="No outbox messages" showHints={false} />
			</div>
		);
	}

	const list = (
		<div className="h-full flex flex-col bg-canvas">
			{/* List datum bar (40px, the shared `--spacing-pane-header`): keeps
			    the bottom hairline on the same y as the mailbox view so the grid
			    line stays continuous across nav → outbox (no staircase, #422). */}
			<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
				<h1 className="truncate text-sm font-semibold text-fg">Outbox</h1>
				<span className="shrink-0 text-2xs text-fg-subtle">
					{messages.length} {messages.length === 1 ? "message" : "messages"}
				</span>
			</header>
			<div className="flex-1 overflow-y-auto">
				{messages.map((message) => (
					<OutboxMessageRow
						key={message.outboxMessageId}
						message={message}
						isSelected={selectedOutboxMessageId === message.outboxMessageId}
						onSelect={() => selectMessage(message.outboxMessageId)}
					/>
				))}
			</div>
		</div>
	);

	const detail = selected ? (
		<OutboxMessageDetail
			message={selected}
			onBack={!isDesktop ? () => selectMessage(undefined) : undefined}
		/>
	) : (
		<ReadingPaneEmpty message="Select a message to read" showHints={false} />
	);

	if (!isDesktop) {
		return <div className="h-full">{selected ? detail : list}</div>;
	}

	return (
		<ResizablePanelGroup direction="horizontal" className="h-full">
			<ResizablePanel
				id="outbox-list"
				order={1}
				defaultSize={35}
				minSize={20}
				maxSize={48}
				className="min-w-0"
			>
				<div className="h-full overflow-hidden border-r border-line">
					{list}
				</div>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel
				id="outbox-detail"
				order={2}
				defaultSize={65}
				minSize={24}
				className="min-w-0"
			>
				<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
					{/* Detail datum bar (40px): outbox has no message-action toolbar,
					    but the datum bar must be present so its bottom hairline lines
					    up with the list pane's, keeping the grid continuous (#422). */}
					<header className="flex h-pane-header shrink-0 items-center border-b border-line px-3" />
					<div className="min-h-0 flex-1 overflow-hidden">{detail}</div>
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
