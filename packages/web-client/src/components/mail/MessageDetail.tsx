import {
	messageOperationsDescribeMessageOptions,
	messageOperationsUpdateMessageFlagsMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { MessageHeader } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	formatErrorDetail,
	isMessageNotFoundError,
} from "@/components/ui/error-banners";
import { toDisplayCategory } from "@/lib/display-category";
import { formatDatePreset } from "@/lib/format";
import { MessageBody } from "./MessageBody";

interface MessageDetailProps {
	messageId?: string;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse">
		<div className="border-b border-line p-4">
			<div className="h-6 bg-surface-sunken rounded w-3/4 mb-3" />
			<div className="space-y-2">
				<div className="h-4 bg-surface-sunken rounded w-48" />
				<div className="h-4 bg-surface-sunken rounded w-64" />
				<div className="h-4 bg-surface-sunken rounded w-40" />
			</div>
		</div>
		<div className="p-4 space-y-2">
			<div className="h-4 bg-surface-sunken rounded w-full" />
			<div className="h-4 bg-surface-sunken rounded w-full" />
			<div className="h-4 bg-surface-sunken rounded w-3/4" />
		</div>
	</div>
);

export const MessageDetail = ({ messageId }: MessageDetailProps) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

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
		// A 404 (row deleted / mid-refresh) renders the inline "deleted" empty
		// state below — opt it out of the global fatal overlay. A 5xx still
		// escalates globally (meta.softError is ignored for 5xx — #1059).
		meta: { softError: true },
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
		onError: (error) => {
			pushError({
				title: "Couldn't mark message as read",
				detail: formatErrorDetail(error),
				error,
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
	}, [messageId, messageData, updateFlags.mutate]);

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
		if (isMessageNotFoundError(error)) {
			return (
				<div className="flex h-full items-center justify-center">
					<EmptyState message="This message has been deleted" />
				</div>
			);
		}
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

	const fromAddress = messageData.envelope.from[0];
	const isTrusted = fromAddress?.flags?.trusted?.value === true;

	return (
		<article>
			<MessageHeader
				subject={messageData.envelope.subject}
				from={messageData.envelope.from}
				to={messageData.envelope.to}
				cc={messageData.envelope.cc}
				date={formatDatePreset(messageData.envelope.date, "full")}
				category={toDisplayCategory(messageData.envelope.category)}
				senderTrust={messageData.envelope.senderTrust}
			/>
			<MessageBody
				bodyParts={messageData.bodyParts}
				messageId={messageId}
				fromAddressId={fromAddress?.addressId}
				isTrusted={isTrusted}
				category={toDisplayCategory(messageData.envelope.category)}
				className="p-4"
			/>
		</article>
	);
};
