import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { AddressList, Avatar } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	BadgeCheck,
	ChevronDown,
	ChevronRight,
	Paperclip,
	Star,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { isMessageNotFoundError } from "@/components/ui/error-banners";
import { formatDatePreset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MessageActionMenu } from "./MessageActionMenu";
import { MessageBody } from "./MessageBody";
import { RawMessageView } from "./RawMessageView";

const TrustedSenderBadge = () => (
	<BadgeCheck
		className="inline-block size-4 ml-1 -mt-0.5 text-positive align-middle"
		aria-label="Trusted sender"
		data-testid="trusted-sender-badge"
	/>
);

/**
 * Indicators column showing star and attachment icons below the date
 */
const MessageIndicators = ({
	isStarred,
	hasAttachment,
	onToggleStar,
	isStarPending,
}: {
	isStarred: boolean;
	hasAttachment: boolean;
	onToggleStar: () => void;
	isStarPending?: boolean;
}) => (
	<div className="flex items-center justify-end gap-1 mt-0.5">
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onToggleStar();
			}}
			disabled={isStarPending}
			className={cn(
				"p-0.5 rounded transition-colors",
				isStarred ? "text-warning" : "text-fg-subtle hover:text-warning",
				isStarPending && "opacity-50",
			)}
		>
			<Star className={cn("size-3.5", isStarred && "fill-current")} />
		</button>
		{hasAttachment && (
			<span className="text-fg-subtle p-0.5">
				<Paperclip className="size-3.5" />
			</span>
		)}
	</div>
);

interface MessageCardProps {
	threadMessage: RemitImapThreadMessageResponse;
	isExpanded: boolean;
	isFocused?: boolean;
	onToggle: () => void;
	onToggleStar: () => void;
	isStarPending?: boolean;
	/**
	 * Owning account for the thread's mailbox. Forwarded to
	 * `MessageActionMenu` so the per-message Move trigger can scope its
	 * folder picker to the right account. Optional because the resolver
	 * is async — when omitted the Move trigger is hidden until the lookup
	 * completes.
	 */
	accountId?: string;
}

const CollapsedCard = ({
	threadMessage,
	isFocused,
	onToggle,
	onToggleStar,
	isStarPending,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	isFocused?: boolean;
	onToggle: () => void;
	onToggleStar: () => void;
	isStarPending?: boolean;
}) => {
	const senderName =
		threadMessage.fromName || threadMessage.fromEmail || "Unknown";
	const date = formatDatePreset(threadMessage.sentDate, "datetime");
	const snippet = threadMessage.snippet || "";
	const isStarred = threadMessage.hasStars;
	const isUnread = !threadMessage.isRead;
	const hasAttachment = threadMessage.hasAttachment;

	// Design reference: AppShell CollapsedMessage — full-width border divider,
	// px-5 py-2, ChevronRight left, avatar, fixed-width sender, snippet,
	// date right-aligned. Matches the approved Storybook mock exactly.
	return (
		<button
			type="button"
			onClick={onToggle}
			className={cn(
				"group flex w-full items-center gap-3 border-b border-line px-5 py-2 text-left",
				"hover:bg-surface-sunken transition-colors",
				isFocused && "bg-surface-sunken ring-1 ring-inset ring-accent/30",
			)}
		>
			<ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
			{/* Unread dot overlays the avatar column */}
			<div className="relative shrink-0">
				<Avatar
					name={threadMessage.fromName ?? threadMessage.fromEmail ?? "?"}
					email={threadMessage.fromEmail ?? undefined}
					size="sm"
				/>
				{isUnread && (
					<span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent border border-canvas" />
				)}
			</div>
			<span
				className={cn(
					"w-36 shrink-0 truncate text-sm",
					isUnread ? "font-semibold text-fg" : "font-medium text-fg-muted",
				)}
			>
				{senderName}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
				{snippet}
			</span>
			{hasAttachment && (
				<Paperclip className="size-3 shrink-0 text-fg-subtle" />
			)}
			{/* Star button — stops click propagation so it doesn't expand the card */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggleStar();
				}}
				disabled={isStarPending}
				aria-label={isStarred ? "Remove star" : "Add star"}
				className={cn(
					"shrink-0 p-0.5 rounded transition-colors",
					isStarred
						? "text-warning"
						: "text-fg-subtle hover:text-warning opacity-0 group-hover:opacity-100 focus:opacity-100",
					isStarPending && "opacity-50",
				)}
			>
				<Star className={cn("size-3", isStarred && "fill-current")} />
			</button>
			<span
				data-testid="message-date"
				className="shrink-0 text-2xs text-fg-subtle tabular-nums"
			>
				{date}
			</span>
		</button>
	);
};

const ExpandedCard = ({
	threadMessage,
	messageData,
	isLoading,
	isError,
	error,
	onRetry,
	isFocused,
	onToggle,
	onToggleStar,
	isStarPending,
	accountId,
	showRaw,
	onToggleRaw,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	messageData?: RemitImapDescribeMessageResponse;
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	onRetry: () => void;
	isFocused?: boolean;
	onToggle: () => void;
	onToggleStar: () => void;
	isStarPending?: boolean;
	accountId?: string;
	showRaw: boolean;
	onToggleRaw: () => void;
}) => {
	const senderName =
		threadMessage.fromName || threadMessage.fromEmail || "Unknown";
	const date = formatDatePreset(threadMessage.sentDate, "long");
	const isStarred = threadMessage.hasStars;
	const isUnread = !threadMessage.isRead;
	const hasAttachment = threadMessage.hasAttachment;
	const isTrusted =
		messageData?.envelope.from[0]?.flags?.trusted?.value === true;

	// Design reference: AppShell ExpandedMessage — px-5 py-3, no own
	// background (inherits bg-canvas from article). Keyboard-focus indicator
	// (`isFocused`) adds a subtle inset ring without changing the surface.
	return (
		<div
			className={cn(
				"px-5 py-3",
				isFocused && "ring-1 ring-inset ring-accent/30",
			)}
		>
			{/* Header row: avatar · sender/to block · date · collapse chevron · action menu */}
			<div className="flex items-start gap-3">
				<Avatar
					name={threadMessage.fromName ?? threadMessage.fromEmail ?? "?"}
					email={threadMessage.fromEmail ?? undefined}
					size="md"
				/>
				<div className="min-w-0 flex-1">
					{/* Clickable area collapses the card */}
					<button type="button" onClick={onToggle} className="w-full text-left">
						<div className="flex items-baseline justify-between gap-2">
							<span
								className={cn(
									"text-sm",
									isUnread ? "font-semibold text-fg" : "font-medium text-fg",
								)}
							>
								{senderName}
								{isTrusted && <TrustedSenderBadge />}
							</span>
							<div className="flex items-center gap-1 shrink-0">
								<span
									data-testid="message-date"
									className="text-2xs text-fg-subtle"
								>
									{date}
								</span>
								<ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
							</div>
						</div>
						{messageData && (
							<div className="text-xs text-fg-subtle">
								<AddressList label="To" addresses={messageData.envelope.to} />
							</div>
						)}
						{!messageData && (
							<div className="text-xs text-fg-subtle">
								{threadMessage.fromEmail}
							</div>
						)}
					</button>
					<div className="flex items-center gap-1 mt-0.5">
						<MessageIndicators
							isStarred={isStarred}
							hasAttachment={hasAttachment}
							onToggleStar={onToggleStar}
							isStarPending={isStarPending}
						/>
						{isUnread && (
							<span
								className="size-1.5 rounded-full bg-accent"
								aria-label="Unread"
							/>
						)}
					</div>
				</div>
				<div className="shrink-0">
					<MessageActionMenu
						messageId={threadMessage.messageId}
						threadId={threadMessage.threadId}
						mailboxId={threadMessage.mailboxId}
						isRead={threadMessage.isRead}
						accountId={accountId}
						fromAddressId={messageData?.envelope.from[0]?.addressId}
						isTrusted={
							messageData?.envelope.from[0]?.flags?.trusted?.value === true
						}
						showRaw={showRaw}
						onToggleRaw={onToggleRaw}
					/>
				</div>
			</div>

			{/* Body: mt-3 matches the AppShell ExpandedMessage spacing. */}
			<div className="mt-3">
				{isLoading ? (
					<div className="animate-pulse space-y-2">
						<div className="h-4 bg-surface-sunken rounded w-full" />
						<div className="h-4 bg-surface-sunken rounded w-3/4" />
						<div className="h-4 bg-surface-sunken rounded w-1/2" />
					</div>
				) : isError && isMessageNotFoundError(error) ? (
					<EmptyState message="This message has been deleted" />
				) : isError ? (
					<ErrorState
						variant="inline"
						title="Couldn't load this message"
						error={error}
						onRetry={onRetry}
					/>
				) : showRaw ? (
					<RawMessageView messageId={threadMessage.messageId} />
				) : (
					<MessageBody
						bodyParts={messageData?.bodyParts}
						messageId={threadMessage.messageId}
						fromAddressId={messageData?.envelope.from[0]?.addressId}
						isTrusted={
							messageData?.envelope.from[0]?.flags?.trusted?.value === true
						}
						category={threadMessage.category}
						framedVariant="inline"
					/>
				)}
			</div>
		</div>
	);
};

export const MessageCard = ({
	threadMessage,
	isExpanded,
	isFocused,
	onToggle,
	onToggleStar,
	isStarPending,
	accountId,
}: MessageCardProps) => {
	const [showRaw, setShowRaw] = useState(false);
	const {
		data: messageData,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...messageOperationsDescribeMessageOptions({
			path: { messageId: threadMessage.messageId },
		}),
		enabled: isExpanded,
	});

	if (!isExpanded) {
		return (
			<CollapsedCard
				threadMessage={threadMessage}
				isFocused={isFocused}
				onToggle={onToggle}
				onToggleStar={onToggleStar}
				isStarPending={isStarPending}
			/>
		);
	}

	return (
		<ExpandedCard
			threadMessage={threadMessage}
			messageData={messageData}
			isLoading={isLoading}
			isError={isError}
			error={error}
			onRetry={() => refetch()}
			isFocused={isFocused}
			onToggle={onToggle}
			onToggleStar={onToggleStar}
			isStarPending={isStarPending}
			accountId={accountId}
			showRaw={showRaw}
			onToggleRaw={() => setShowRaw((prev) => !prev)}
		/>
	);
};
