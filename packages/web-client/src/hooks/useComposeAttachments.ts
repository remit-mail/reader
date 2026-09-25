import {
	outboxAttachmentOperationsCompleteOutboxAttachmentMutation,
	outboxDetailOperationsMintOutboxAttachmentMutation,
	outboxDetailOperationsUpdateOutboxMessageMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState, useSyncExternalStore } from "react";
import {
	type AttachmentTransport,
	ComposeAttachmentController,
	type DraftForAttachment,
} from "../lib/compose-attachment-controller";
import { softErrorMeta } from "../lib/error-classifier";

export type { DraftForAttachment };

const putFile = (
	uploadUrl: string,
	file: File,
	signal: AbortSignal,
): Promise<void> =>
	fetch(uploadUrl, { method: "PUT", body: file, signal }).then((response) => {
		if (!response.ok) {
			throw new Error(`the server answered ${response.status}`);
		}
	});

interface UseComposeAttachmentsOptions {
	ensureDraft: () => Promise<DraftForAttachment>;
}

/** The composer's side of `ComposeAttachmentController`, over the app's API. */
export const useComposeAttachments = ({
	ensureDraft,
}: UseComposeAttachmentsOptions) => {
	const mintMutation = useMutation({
		...outboxDetailOperationsMintOutboxAttachmentMutation(),
		meta: softErrorMeta,
	});
	const completeMutation = useMutation({
		...outboxAttachmentOperationsCompleteOutboxAttachmentMutation(),
		meta: softErrorMeta,
	});
	const updateMutation = useMutation({
		...outboxDetailOperationsUpdateOutboxMessageMutation(),
		meta: softErrorMeta,
	});

	const transportRef = useRef<AttachmentTransport | null>(null);
	transportRef.current = {
		mint: (outboxMessageId, file) =>
			mintMutation.mutateAsync({
				path: { outboxMessageId },
				body: {
					filename: file.name,
					contentType: file.type || "application/octet-stream",
					sizeBytes: file.size,
				},
			}),
		put: putFile,
		complete: (outboxMessageId, outboxAttachmentId) =>
			completeMutation
				.mutateAsync({ path: { outboxMessageId, outboxAttachmentId } })
				.then(() => undefined),
		keep: (outboxMessageId, attachmentIds) =>
			updateMutation
				.mutateAsync({
					path: { outboxMessageId },
					body: { attachmentIds },
				})
				.then(() => undefined),
	};
	const ensureDraftRef = useRef(ensureDraft);
	ensureDraftRef.current = ensureDraft;

	const [controller] = useState(
		() =>
			new ComposeAttachmentController({
				transport: () => {
					const transport = transportRef.current;
					if (!transport) throw new Error("attachment transport not ready");
					return transport;
				},
				ensureDraft: () => ensureDraftRef.current(),
			}),
	);

	const items = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);

	return {
		items,
		attach: controller.attach,
		retry: controller.retry,
		remove: controller.remove,
		load: controller.load,
		reset: controller.reset,
		blockingReason: items.length > 0 ? controller.blockingReason() : undefined,
	};
};
