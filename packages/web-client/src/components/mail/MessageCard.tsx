import { messageOperationsDescribeMessageOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapDescribeMessageResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatDatePreset } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MessageBody } from "./MessageBody";

interface MessageCardProps {
	threadMessage: RemitImapThreadMessageResponse;
	isExpanded: boolean;
	isFocused?: boolean;
	onToggle: () => void;
}

const CollapsedCard = ({
	threadMessage,
	isFocused,
	onToggle,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	isFocused?: boolean;
	onToggle: () => void;
}) => {
	const senderName =
		threadMessage.fromName || threadMessage.fromEmail || "Unknown";
	const date = formatDatePreset(threadMessage.sentDate, "datetime");
	const snippet = threadMessage.snippet || "";

	return (
		<button
			type="button"
			onClick={onToggle}
			className={cn(
				"w-full text-left border rounded-lg p-3",
				"bg-card hover:bg-accent/50 transition-colors",
				"cursor-pointer",
				isFocused && "ring-2 ring-ring ring-offset-2 ring-offset-background",
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-sm text-foreground truncate">
					{senderName}
				</span>
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-xs text-muted-foreground">{date}</span>
					<ChevronRight className="size-4 text-muted-foreground" />
				</div>
			</div>
			{snippet && (
				<div className="text-sm text-muted-foreground truncate mt-1">
					{snippet}
				</div>
			)}
		</button>
	);
};

const ExpandedCard = ({
	threadMessage,
	messageData,
	isLoading,
	isFocused,
	onToggle,
}: {
	threadMessage: RemitImapThreadMessageResponse;
	messageData?: RemitImapDescribeMessageResponse;
	isLoading: boolean;
	isFocused?: boolean;
	onToggle: () => void;
}) => {
	const senderName =
		threadMessage.fromName || threadMessage.fromEmail || "Unknown";
	const date = formatDatePreset(threadMessage.sentDate, "long");

	return (
		<div
			className={cn(
				"border rounded-lg bg-card overflow-hidden",
				isFocused && "ring-2 ring-ring ring-offset-2 ring-offset-background",
			)}
		>
			{/* Header - clickable to collapse */}
			<button
				type="button"
				onClick={onToggle}
				className={cn(
					"w-full text-left p-4 border-b border-border",
					"hover:bg-accent/30 transition-colors cursor-pointer",
				)}
			>
				<div className="flex items-start justify-between gap-2">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 mb-1">
							<span className="font-medium text-foreground">{senderName}</span>
						</div>
						{messageData && (
							<div className="text-sm text-muted-foreground">
								To:{" "}
								{messageData.envelope.to
									.map((addr) => addr.displayName || addr.normalizedEmail)
									.join(", ")}
							</div>
						)}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span className="text-xs text-muted-foreground">{date}</span>
						<ChevronDown className="size-4 text-muted-foreground" />
					</div>
				</div>
			</button>

			{/* Body */}
			<div className="p-4">
				{isLoading ? (
					<div className="animate-pulse space-y-2">
						<div className="h-4 bg-muted rounded w-full" />
						<div className="h-4 bg-muted rounded w-3/4" />
						<div className="h-4 bg-muted rounded w-1/2" />
					</div>
				) : (
					<MessageBody
						html={messageData?.bodyHtml}
						text={messageData?.bodyText || threadMessage.snippet}
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
}: MessageCardProps) => {
	const { data: messageData, isLoading } = useQuery({
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
			/>
		);
	}

	return (
		<ExpandedCard
			threadMessage={threadMessage}
			messageData={messageData}
			isLoading={isLoading}
			isFocused={isFocused}
			onToggle={onToggle}
		/>
	);
};
