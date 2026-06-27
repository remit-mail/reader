import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ThreadMessageData } from "@remit/ui";
import {
	AddressList,
	CollapsedMessage,
	ExpandedMessage,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Paperclip, Star } from "lucide-react";
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
 * Builds the kit's `ThreadMessageData` view shape from an IMAP thread message.
 * The kit reading rows own the row layout; MessageCard supplies the data and
 * injects its interactivity through slots — so the row rhythm has one source of
 * truth and can't drift from Storybook (#945).
 */
const toThreadMessageData = (
	threadMessage: RemitImapThreadMessageResponse,
	dateLabel: string,
): ThreadMessageData => ({
	id: threadMessage.messageId,
	fromName: threadMessage.fromName ?? threadMessage.fromEmail ?? "?",
	fromEmail: threadMessage.fromEmail ?? "",
	toLabel: "",
	dateLabel,
	snippet: threadMessage.snippet || "",
	bodyHtml: "",
});

const StarButton = ({
	isStarred,
	onToggleStar,
	isStarPending,
	hoverReveal,
}: {
	isStarred: boolean;
	onToggleStar: () => void;
	isStarPending?: boolean;
	hoverReveal?: boolean;
}) => (
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
				: cn(
						"text-fg-subtle hover:text-warning",
						hoverReveal &&
							"opacity-0 group-hover:opacity-100 focus:opacity-100",
					),
			isStarPending && "opacity-50",
		)}
	>
		<Star className={cn("size-3.5", isStarred && "fill-current")} />
	</button>
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
	const date = formatDatePreset(threadMessage.sentDate, "datetime");
	const message = toThreadMessageData(threadMessage, date);

	return (
		<CollapsedMessage
			message={message}
			onClick={onToggle}
			isFocused={isFocused}
			isUnread={!threadMessage.isRead}
			trailing={
				<>
					{threadMessage.hasAttachment && (
						<Paperclip className="size-3 shrink-0 text-fg-subtle" />
					)}
					<StarButton
						isStarred={threadMessage.hasStars}
						onToggleStar={onToggleStar}
						isStarPending={isStarPending}
						hoverReveal
					/>
					<span
						data-testid="message-date"
						className="shrink-0 text-2xs text-fg-subtle tabular-nums"
					>
						{date}
					</span>
				</>
			}
		/>
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
	const date = formatDatePreset(threadMessage.sentDate, "long");
	const isUnread = !threadMessage.isRead;
	const isTrusted =
		messageData?.envelope.from[0]?.flags?.trusted?.value === true;
	const message = toThreadMessageData(threadMessage, date);

	return (
		<ExpandedMessage
			message={message}
			isFocused={isFocused}
			onHeaderClick={onToggle}
			senderBadge={isTrusted ? <TrustedSenderBadge /> : undefined}
			trailing={
				<span data-testid="message-date" className="text-2xs text-fg-subtle">
					{date}
				</span>
			}
			to={
				messageData ? (
					<AddressList label="To" addresses={messageData.envelope.to} />
				) : null
			}
			indicators={
				<div className="flex items-center gap-1 mt-0.5">
					<div className="flex items-center justify-end gap-1">
						<StarButton
							isStarred={threadMessage.hasStars}
							onToggleStar={onToggleStar}
							isStarPending={isStarPending}
						/>
						{threadMessage.hasAttachment && (
							<span className="text-fg-subtle p-0.5">
								<Paperclip className="size-3.5" />
							</span>
						)}
					</div>
					{isUnread && (
						<span
							className="size-1.5 rounded-full bg-accent"
							aria-label="Unread"
						/>
					)}
				</div>
			}
			actionMenu={
				<MessageActionMenu
					messageId={threadMessage.messageId}
					threadId={threadMessage.threadId}
					mailboxId={threadMessage.mailboxId}
					isRead={threadMessage.isRead}
					accountId={accountId}
					fromAddressId={messageData?.envelope.from[0]?.addressId}
					isTrusted={isTrusted}
					showRaw={showRaw}
					onToggleRaw={onToggleRaw}
				/>
			}
			body={
				isLoading ? (
					<div className="mt-3 animate-pulse space-y-2">
						<div className="h-4 bg-surface-sunken rounded w-full" />
						<div className="h-4 bg-surface-sunken rounded w-3/4" />
						<div className="h-4 bg-surface-sunken rounded w-1/2" />
					</div>
				) : isError && isMessageNotFoundError(error) ? (
					<div className="mt-3">
						<EmptyState message="This message has been deleted" />
					</div>
				) : isError ? (
					<div className="mt-3">
						<ErrorState
							variant="inline"
							title="Couldn't load this message"
							error={error}
							onRetry={onRetry}
						/>
					</div>
				) : showRaw ? (
					<div className="mt-3">
						<RawMessageView messageId={threadMessage.messageId} />
					</div>
				) : (
					<div className="mt-3">
						<MessageBody
							bodyParts={messageData?.bodyParts}
							messageId={threadMessage.messageId}
							fromAddressId={messageData?.envelope.from[0]?.addressId}
							isTrusted={isTrusted}
							category={threadMessage.category}
						/>
					</div>
				)
			}
		/>
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
