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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle,
	Clock,
	Loader2,
	RotateCcw,
	Send,
	Trash2,
} from "lucide-react";
import { z } from "zod";
import { useCompose } from "@/components/compose/ComposeProvider";
import { Panel } from "@/components/layout/Panel";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/layout/Resizable";
import { MessageBody } from "@/components/mail/MessageBody";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
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

	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors",
				isSelected && "bg-accent",
				isFailed && !isSelected && "bg-red-50/50 dark:bg-red-950/20",
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
			<div
				className="flex items-center gap-1 shrink-0"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				role="presentation"
			>
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
					</>
				)}
			</div>
		</button>
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
		<div className="h-full overflow-y-auto bg-background">
			<div className="border-b border-border p-4">
				{onBack && (
					<button
						type="button"
						onClick={onBack}
						className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
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
						<span className="text-muted-foreground shrink-0 w-12">From:</span>
						<span className="text-foreground">
							{message.fromName
								? `${message.fromName} <${message.fromAddress}>`
								: message.fromAddress}
						</span>
					</div>
					<div className="flex gap-2">
						<span className="text-muted-foreground shrink-0 w-12">To:</span>
						<span className="text-foreground">
							{(message.toAddresses ?? []).join(", ")}
						</span>
					</div>
					{message.ccAddresses && message.ccAddresses.length > 0 && (
						<div className="flex gap-2">
							<span className="text-muted-foreground shrink-0 w-12">Cc:</span>
							<span className="text-foreground">
								{message.ccAddresses.join(", ")}
							</span>
						</div>
					)}
					<div className="flex gap-2">
						<span className="text-muted-foreground shrink-0 w-12">Date:</span>
						<span className="text-foreground">{sentLabel}</span>
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
							{message.lastError && (
								<span className="text-xs text-muted-foreground">
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

	const messages = (outboxResponse?.items ?? []).filter(
		(item) => item.status !== "draft",
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
			<div className="flex h-full items-center justify-center bg-background">
				<span className="text-muted-foreground">Loading...</span>
			</div>
		);
	}

	const list = (
		<div className="h-full flex flex-col bg-background">
			<div className="px-4 py-3 border-b border-border">
				<h2 className="text-lg font-semibold">Outbox</h2>
				<p className="text-sm text-muted-foreground">
					{messages.length} {messages.length === 1 ? "message" : "messages"}
				</p>
			</div>
			<div className="flex-1 overflow-y-auto">
				{messages.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<EmptyState message="No outbox messages" />
					</div>
				) : (
					messages.map((message) => (
						<OutboxMessageRow
							key={message.outboxMessageId}
							message={message}
							isSelected={selectedOutboxMessageId === message.outboxMessageId}
							onSelect={() => selectMessage(message.outboxMessageId)}
						/>
					))
				)}
			</div>
		</div>
	);

	const detail = selected ? (
		<OutboxMessageDetail
			message={selected}
			onBack={!isDesktop ? () => selectMessage(undefined) : undefined}
		/>
	) : (
		<div className="flex h-full items-center justify-center">
			<EmptyState message="Select a message to read" />
		</div>
	);

	if (!isDesktop) {
		return <div className="h-full">{selected ? detail : list}</div>;
	}

	return (
		<ResizablePanelGroup
			direction="horizontal"
			className="h-full"
			autoSaveId="remit-outbox-pane"
		>
			<ResizablePanel id="outbox-list" order={1} defaultSize={35} minSize={10}>
				<Panel className="h-full">{list}</Panel>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel
				id="outbox-detail"
				order={2}
				defaultSize={65}
				minSize={20}
			>
				<Panel withBorder={false} className="h-full">
					{detail}
				</Panel>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
