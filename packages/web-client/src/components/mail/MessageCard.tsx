import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import {
	BadgeCheck,
	ChevronDown,
	ChevronRight,
	Paperclip,
	Star,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { isMessageNotFoundError } from "@/components/ui/error-banners";
import { formatDatePreset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddressList } from "./AddressDisplay";
import { MessageActionMenu } from "./MessageActionMenu";
import { MessageBody } from "./MessageBody";

const TrustedSenderBadge = () => (
	<BadgeCheck
		className="inline-block size-4 ml-1 -mt-0.5 text-green-600 dark:text-green-500 align-middle"
		aria-label="Trusted sender"
		data-testid="trusted-sender-badge"
	/>
);

/**
 * Unread indicator dot - occupies a fixed column width
 */
const UnreadIndicator = ({ isUnread }: { isUnread: boolean }) => (
	<div className="w-2 shrink-0 flex items-center justify-center pt-1">
		{isUnread && (
			<div className="size-2 rounded-full bg-blue-500" aria-label="Unread" />
		)}
	</div>
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
				isStarred
					? "text-yellow-500"
					: "text-muted-foreground/50 hover:text-yellow-500",
				isStarPending && "opacity-50",
			)}
		>
			<Star className={cn("size-3.5", isStarred && "fill-current")} />
		</button>
		{hasAttachment && (
			<span className="text-muted-foreground/50 p-0.5">
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

	return (
		<div
			className={cn(
				"group flex items-start gap-2 py-3 px-2 -mx-2 rounded-lg",
				"hover:bg-accent/30 transition-colors cursor-pointer",
				isFocused && "bg-accent/40",
			)}
			onClick={onToggle}
		>
			<UnreadIndicator isUnread={isUnread} />
			<Avatar
				name={threadMessage.fromName ?? undefined}
				email={threadMessage.fromEmail ?? undefined}
				size={40}
			/>
			<div className="flex-1 min-w-0">
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<span
							className={cn(
								"text-sm truncate block",
								isUnread ? "font-semibold text-foreground" : "text-foreground",
							)}
						>
							{senderName}
						</span>
						{snippet && (
							<div className="text-sm text-muted-foreground truncate mt-0.5">
								{snippet}
							</div>
						)}
					</div>
					<div className="shrink-0 text-right">
						<div className="flex items-center gap-1">
							<span
								data-testid="message-date"
								className="text-xs text-muted-foreground"
							>
								{date}
							</span>
							<ChevronRight className="size-4 text-muted-foreground" />
						</div>
						<MessageIndicators
							isStarred={isStarred}
							hasAttachment={hasAttachment}
							onToggleStar={onToggleStar}
							isStarPending={isStarPending}
						/>
					</div>
				</div>
			</div>
		</div>
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
}) => {
	const senderName =
		threadMessage.fromName || threadMessage.fromEmail || "Unknown";
	const date = formatDatePreset(threadMessage.sentDate, "long");
	const isStarred = threadMessage.hasStars;
	const isUnread = !threadMessage.isRead;
	const hasAttachment = threadMessage.hasAttachment;
	const isTrusted =
		messageData?.envelope.from[0]?.flags?.trusted?.value === true;

	return (
		<div className={cn("rounded-lg px-2 -mx-2", isFocused && "bg-accent/40")}>
			{/* Header - clickable to collapse */}
			<div className="flex items-start gap-2 py-3">
				<UnreadIndicator isUnread={isUnread} />
				<Avatar
					name={threadMessage.fromName ?? undefined}
					email={threadMessage.fromEmail ?? undefined}
					size={40}
				/>
				<button
					type="button"
					onClick={onToggle}
					className="flex-1 min-w-0 text-left hover:bg-accent/20 -my-2 py-2 px-1 -mx-1 rounded transition-colors"
				>
					<div className="flex items-start justify-between gap-2">
						<div className="flex-1 min-w-0">
							<span
								className={cn(
									"block mb-0.5",
									isUnread
										? "font-semibold text-foreground"
										: "text-foreground",
								)}
							>
								{senderName}
								{isTrusted && <TrustedSenderBadge />}
							</span>
							{messageData && (
								<AddressList label="To" addresses={messageData.envelope.to} />
							)}
						</div>
						<div className="shrink-0 text-right">
							<div className="flex items-center gap-1">
								<span
									data-testid="message-date"
									className="text-xs text-muted-foreground"
								>
									{date}
								</span>
								<ChevronDown className="size-4 text-muted-foreground" />
							</div>
							<MessageIndicators
								isStarred={isStarred}
								hasAttachment={hasAttachment}
								onToggleStar={onToggleStar}
								isStarPending={isStarPending}
							/>
						</div>
					</div>
				</button>
				<div className="shrink-0">
					<MessageActionMenu
						messageId={threadMessage.messageId}
						threadId={threadMessage.threadId}
						mailboxId={threadMessage.mailboxId}
						isRead={threadMessage.isRead}
						fromAddressId={messageData?.envelope.from[0]?.addressId}
						isTrusted={
							messageData?.envelope.from[0]?.flags?.trusted?.value === true
						}
					/>
				</div>
			</div>

			{/* Body - flush left so the message uses the full pane width on
			    every viewport. The avatar column is already implied by the
			    header above; an extra avatar-width indent here just wastes
			    horizontal space on desktop (#179). */}
			<div className="mt-2">
				{isLoading ? (
					<div className="animate-pulse space-y-2">
						<div className="h-4 bg-muted rounded w-full" />
						<div className="h-4 bg-muted rounded w-3/4" />
						<div className="h-4 bg-muted rounded w-1/2" />
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
				) : (
					<MessageBody
						html={messageData?.bodyHtml}
						text={messageData?.bodyText || threadMessage.snippet}
						messageId={threadMessage.messageId}
						fromAddressId={messageData?.envelope.from[0]?.addressId}
						isTrusted={
							messageData?.envelope.from[0]?.flags?.trusted?.value === true
						}
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
}: MessageCardProps) => {
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
		/>
	);
};
