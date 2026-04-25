import {
	messageOperationsDescribeMessageOptions,
	messageOperationsUpdateMessageFlagsMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MessageBody } from "./MessageBody";
import { MessageHeader } from "./MessageHeader";

interface MessageDetailProps {
	messageId?: string;
	snippet?: string;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse">
		<div className="border-b border-border p-4">
			<div className="h-6 bg-muted rounded w-3/4 mb-3" />
			<div className="space-y-2">
				<div className="h-4 bg-muted rounded w-48" />
				<div className="h-4 bg-muted rounded w-64" />
				<div className="h-4 bg-muted rounded w-40" />
			</div>
		</div>
		<div className="p-4 space-y-2">
			<div className="h-4 bg-muted rounded w-full" />
			<div className="h-4 bg-muted rounded w-full" />
			<div className="h-4 bg-muted rounded w-3/4" />
		</div>
	</div>
);

export const MessageDetail = ({ messageId, snippet }: MessageDetailProps) => {
	const queryClient = useQueryClient();

	const {
		data: messageData,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...messageOperationsDescribeMessageOptions({
			path: { messageId: messageId ?? "" },
		}),
		enabled: !!messageId,
	});

	const updateFlags = useMutation({
		...messageOperationsUpdateMessageFlagsMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey[0] !== null &&
					typeof query.queryKey[0] === "object" &&
					"_id" in query.queryKey[0] &&
					query.queryKey[0]._id === "threadOperationsListThreads",
			});
		},
	});

	useEffect(() => {
		if (messageId && messageData && !messageData.flags.includes("\\Seen")) {
			updateFlags.mutate({
				path: { messageId },
				body: { isRead: true },
			});
		}
	}, [messageId, messageData]);

	if (!messageId) {
		return (
			<div className="flex h-full items-center justify-center">
				<EmptyState message="Select a message to read" />
			</div>
		);
	}

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorState
					title="Couldn't load this message"
					error={error}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	if (!messageData) {
		return (
			<div className="flex h-full items-center justify-center">
				<EmptyState message="Message not found" />
			</div>
		);
	}

	return (
		<article>
			<MessageHeader envelope={messageData.envelope} />
			<MessageBody
				html={messageData.bodyHtml}
				text={messageData.bodyText || snippet}
			/>
		</article>
	);
};
