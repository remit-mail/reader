import { messageOperationsDescribeMessageQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapBodyPartResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type AttachmentDownloadState, AttachmentList } from "@remit/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuthProvider } from "@/auth/provider";
import {
	attachmentFailureContent,
	attachmentReportUrl,
	extractAttachmentFailureDetail,
	extractAttachmentFailureReason,
	fetchAttachment,
	isRepairableByRefetch,
	saveBlob,
} from "@/lib/attachment-download";
import {
	type MessageAttachment,
	selectMessageAttachments,
} from "@/lib/message-attachments";

interface MessageAttachmentsProps {
	messageId: string;
	/** Body parts from `describeMessage`; absent while the message is loading. */
	bodyParts?: readonly RemitImapBodyPartResponse[];
	/** The thread row's server-side attachment flag. */
	hasAttachment?: boolean;
	className?: string;
}

const IDLE: AttachmentDownloadState = { status: "idle" };

/**
 * The attachments carried by an open message, and the download behind each row.
 *
 * Download state is per row and lives here rather than in a query: a download is
 * a one-shot user action with no cached result to hold, and the bytes are handed
 * to the browser rather than rendered.
 */
export const MessageAttachments = ({
	messageId,
	bodyParts,
	hasAttachment = false,
	className,
}: MessageAttachmentsProps) => {
	const { getToken } = useAuthProvider();
	const queryClient = useQueryClient();
	const [downloads, setDownloads] = useState<
		Record<string, AttachmentDownloadState>
	>({});

	const attachments = useMemo(
		() => selectMessageAttachments(bodyParts ?? []),
		[bodyParts],
	);

	const describeKey = messageOperationsDescribeMessageQueryKey({
		path: { messageId },
	});

	/**
	 * A stale signature and an unmaterialized part are both repaired by re-reading
	 * the message: `describeMessage` re-signs every `contentUrl`, and it
	 * materializes the deferred per-part objects on its way through. Re-hitting
	 * the same URL alone cannot fix either (remit-mail/remit#1240), so the retry
	 * goes through the read path and then uses the URL it just minted.
	 */
	const fetchThroughRefreshedDescribe = (
		attachment: MessageAttachment,
	): Promise<Blob> =>
		fetchAttachment(attachment.contentUrl, getToken).catch(
			(error: unknown): Promise<Blob> => {
				if (!isRepairableByRefetch(extractAttachmentFailureReason(error))) {
					throw error;
				}
				return queryClient
					.refetchQueries({ queryKey: describeKey })
					.then(() => {
						const refreshed =
							queryClient.getQueryData<RemitImapDescribeMessageResponse>(
								describeKey,
							);
						const renewed = refreshed
							? selectMessageAttachments(refreshed.bodyParts).find(
									(candidate) => candidate.bodyPartId === attachment.bodyPartId,
								)
							: undefined;
						return fetchAttachment(
							renewed?.contentUrl ?? attachment.contentUrl,
							getToken,
						);
					});
			},
		);

	const setState = (id: string, state: AttachmentDownloadState) =>
		setDownloads((current) => ({ ...current, [id]: state }));

	const download = (bodyPartId: string) => {
		const attachment = attachments.find(
			(candidate) => candidate.bodyPartId === bodyPartId,
		);
		if (!attachment) {
			throw new Error(
				`No attachment part ${bodyPartId} on message ${messageId}`,
			);
		}

		setState(bodyPartId, { status: "downloading" });
		fetchThroughRefreshedDescribe(attachment)
			.then((blob) => {
				saveBlob(blob, attachment.filename);
				setState(bodyPartId, IDLE);
			})
			.catch((error: unknown) => {
				const reason = extractAttachmentFailureReason(error);
				const fallback = extractAttachmentFailureDetail(error);
				const { title, detail } = attachmentFailureContent(
					reason,
					attachment.filename,
					fallback,
				);
				setState(bodyPartId, {
					status: "failed",
					title,
					detail,
					reportUrl: attachmentReportUrl(reason, attachment.filename, fallback),
				});
			});
	};

	// Only claim an attachment is unaccounted for once the parts have arrived;
	// while `describeMessage` is in flight there is nothing to contradict.
	const hasUnlistedAttachment =
		hasAttachment && bodyParts !== undefined && attachments.length === 0;

	return (
		<AttachmentList
			className={className}
			attachments={attachments.map((attachment) => ({
				attachmentId: attachment.bodyPartId,
				filename: attachment.filename,
				typeLabel: attachment.typeLabel,
				sizeOctets: attachment.sizeOctets,
				download: downloads[attachment.bodyPartId] ?? IDLE,
			}))}
			onDownload={download}
			hasUnlistedAttachment={hasUnlistedAttachment}
		/>
	);
};
