import type { RemitImapOutboxAttachmentResponse } from "@remit/api-http-client/types.gen.ts";
import type { InlineImagePlacement, InlineImages } from "@remit/ui/rich-text";
import { useMemo, useRef } from "react";
import { useAuthProvider } from "@/auth/provider";
import {
	attachmentFailureContent,
	extractAttachmentFailureDetail,
	extractAttachmentFailureReason,
	fetchAttachment,
} from "@/lib/attachment-download";
import type { PushErrorInput } from "../components/ui/error-banners";
import type { StoredContent } from "../lib/compose-attachment-controller";

interface UseInlineImagesOptions {
	attach: (files: File[], placement?: InlineImagePlacement) => Promise<void>;
	owns: (contentId: string) => boolean;
	isLoaded: () => boolean;
	storedContent: (contentId: string) => StoredContent | null;
	refreshLinks: () => Promise<void>;
	onRemoved: (listener: (contentId: string) => void) => () => void;
	draftAttachments: readonly RemitImapOutboxAttachmentResponse[];
	pushError: (input: PushErrorInput) => string;
}

export const useInlineImages = (
	options: UseInlineImagesOptions,
): InlineImages => {
	const { getToken } = useAuthProvider();
	const latest = useRef({ ...options, getToken });
	latest.current = { ...options, getToken };

	return useMemo<InlineImages>(() => {
		const beforeLoad = (contentId: string): StoredContent | null => {
			const current = latest.current;
			if (current.isLoaded()) return null;
			return (
				current.draftAttachments.find(
					(attachment) => attachment.contentId === contentId,
				) ?? null
			);
		};

		const stored = (contentId: string): StoredContent | null =>
			latest.current.storedContent(contentId) ?? beforeLoad(contentId);

		const fetchStored = (content: StoredContent): Promise<string> =>
			fetchAttachment(content.contentUrl, latest.current.getToken).then(
				(blob) =>
					URL.createObjectURL(new Blob([blob], { type: content.contentType })),
			);

		const fetchRenewed = (contentId: string): Promise<string> =>
			latest.current.refreshLinks().then(() => {
				const renewed = stored(contentId);
				if (!renewed) {
					throw new Error("the file is no longer on this draft");
				}
				return fetchStored(renewed);
			});

		return {
			attach: (files, placement) => {
				void latest.current.attach(files, placement);
			},
			owns: (contentId) =>
				latest.current.owns(contentId) || beforeLoad(contentId) !== null,
			onRemoved: (listener) => latest.current.onRemoved(listener),
			resolve: (contentId) => {
				const content = stored(contentId);
				if (!content) return Promise.resolve(null);
				return fetchStored(content)
					.catch((error: unknown) => {
						if (extractAttachmentFailureReason(error) !== "link-expired") {
							throw error;
						}
						return fetchRenewed(contentId);
					})
					.catch((error: unknown) => {
						const reason = extractAttachmentFailureReason(error);
						latest.current.pushError({
							...attachmentFailureContent(
								reason,
								content.filename,
								extractAttachmentFailureDetail(error),
							),
							error: reason === "generic" ? error : undefined,
						});
						return null;
					});
			},
		};
	}, []);
};
