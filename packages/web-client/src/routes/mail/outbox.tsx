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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle,
	Clock,
	Loader2,
	RotateCcw,
	Send,
	Trash2,
} from "lucide-react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mail/outbox")({
	component: OutboxView,
});

const STATUS_CONFIG: Record<
	Exclude<RemitImapOutboxMessageStatus, "draft">,
	{ icon: typeof Send; label: string; className: string }
> = {
	queued: {
		icon: Clock,
		label: "Queued",
		className: "text-yellow-600 dark:text-yellow-400",
	},
	sending: {
		icon: Loader2,
		label: "Sending…",
		className: "text-blue-600 dark:text-blue-400",
	},
	sent: {
		icon: CheckCircle,
		label: "Sent",
		className: "text-green-600 dark:text-green-400",
	},
	failed: {
		icon: AlertCircle,
		label: "Failed",
		className: "text-red-600 dark:text-red-400",
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

const formatRecipients = (message: RemitImapOutboxMessageResponse): string => {
	const recipients = message.toAddresses ?? [];
	if (recipients.length === 0) return "No recipients";
	if (recipients.length === 1) return recipients[0];
	return `${recipients[0]} +${recipients.length - 1}`;
};

const OutboxMessageItem = ({
	message,
}: {
	message: RemitImapOutboxMessageResponse;
}) => {
	const queryClient = useQueryClient();
	const { openCompose } = useCompose();

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
	});

	const deleteMutation = useMutation({
		...outboxDetailOperationsDeleteOutboxMessageMutation(),
		onSuccess: () => {
			invalidateOutbox();
		},
	});

	const status = message.status as Exclude<
		RemitImapOutboxMessageStatus,
		"draft"
	>;
	const config = STATUS_CONFIG[status];

	if (!config) return null;

	const StatusIcon = config.icon;
	const isFailed = message.status === "failed";
	const isDraft = message.status === "draft";

	return (
		<div
			className={cn(
				"flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors",
				isFailed && "bg-red-50/50 dark:bg-red-950/20",
			)}
		>
			<div className={cn("mt-0.5 shrink-0", config.className)}>
				<StatusIcon
					className={cn(
						"size-4",
						message.status === "sending" && "animate-spin",
					)}
				/>
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center justify-between gap-2">
					<span className="text-sm font-medium truncate">
						{formatRecipients(message)}
					</span>
					<span className="text-xs text-muted-foreground shrink-0">
						{formatDate(message.sentAt ?? message.updatedAt)}
					</span>
				</div>
				<div className="text-sm truncate">
					{message.subject || "No subject"}
				</div>
				<div className="flex items-center gap-2 mt-1">
					<span className={cn("text-xs font-medium", config.className)}>
						{config.label}
					</span>
					{isFailed && message.lastError && (
						<span className="text-xs text-muted-foreground truncate">
							— {message.lastError}
						</span>
					)}
				</div>
			</div>
			<div className="flex items-center gap-1 shrink-0">
				{isFailed && (
					<>
						<button
							type="button"
							onClick={() =>
								retryMutation.mutate({
									path: { outboxMessageId: message.outboxMessageId },
								})
							}
							disabled={retryMutation.isPending}
							className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							title="Retry sending"
						>
							<RotateCcw className="size-3.5" />
						</button>
						<button
							type="button"
							onClick={() =>
								openCompose({
									mode: "new",
									outboxMessageId: message.outboxMessageId,
								})
							}
							className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							title="Edit as draft"
						>
							<Send className="size-3.5" />
						</button>
					</>
				)}
				{(isFailed || isDraft) && (
					<button
						type="button"
						onClick={() =>
							deleteMutation.mutate({
								path: { outboxMessageId: message.outboxMessageId },
							})
						}
						disabled={deleteMutation.isPending}
						className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
						title="Delete message"
					>
						<Trash2 className="size-3.5" />
					</button>
				)}
			</div>
		</div>
	);
};

function OutboxView() {
	const { data: outboxResponse, isLoading } = useQuery(
		outboxOperationsListOutboxMessagesOptions(),
	);

	const messages = (outboxResponse?.items ?? []).filter(
		(item) => item.status !== "draft",
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center bg-background">
				<span className="text-muted-foreground">Loading...</span>
			</div>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="flex h-full items-center justify-center bg-background">
				<EmptyState message="No outbox messages" />
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col bg-background">
			<div className="px-4 py-3 border-b border-border">
				<h2 className="text-lg font-semibold">Outbox</h2>
				<p className="text-sm text-muted-foreground">
					{messages.length} {messages.length === 1 ? "message" : "messages"}
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				{messages.map((message) => (
					<OutboxMessageItem key={message.outboxMessageId} message={message} />
				))}
			</div>
		</div>
	);
}
