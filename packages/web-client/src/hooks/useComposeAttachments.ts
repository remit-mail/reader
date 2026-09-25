import {
	outboxAttachmentOperationsCompleteOutboxAttachmentMutation,
	outboxDetailOperationsMintOutboxAttachmentMutation,
	outboxDetailOperationsUpdateOutboxMessageMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapOutboxAttachmentRejectionReason,
	RemitImapOutboxAttachmentResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { ComposeAttachmentItem, ComposeAttachmentState } from "@remit/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatErrorDetail } from "../components/ui/error-banners";
import { softErrorMeta } from "../lib/error-classifier";

export type DraftForAttachment =
	| { outcome: "ready"; outboxMessageId: string }
	| { outcome: "refused"; reason: string };

interface Entry extends ComposeAttachmentItem {
	serverId: string | null;
	file: File | null;
}

interface AttachmentRejection {
	code: "attachment_rejected";
	reason: RemitImapOutboxAttachmentRejectionReason;
	message: string;
}

const isRejection = (error: unknown): error is AttachmentRejection =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === "attachment_rejected" &&
	"message" in error &&
	typeof error.message === "string";

/**
 * Refusals about the file itself. Pressing again sends the same file and is
 * refused the same way, so the row offers removal and nothing else.
 */
const FINAL_REASONS: ReadonlySet<RemitImapOutboxAttachmentRejectionReason> =
	new Set([
		"EmptyFile",
		"UnusableFilename",
		"FileTooLarge",
		"TooManyAttachments",
	]);

const UPLOADING: ComposeAttachmentState = { status: "uploading" };
const ATTACHED: ComposeAttachmentState = { status: "attached" };

const failed = (
	reason: string,
	retryable: boolean,
): ComposeAttachmentState => ({
	status: "failed",
	reason,
	retryable,
});

const refusalOf = (
	filename: string,
	error: unknown,
): ComposeAttachmentState => {
	if (isRejection(error)) {
		return failed(error.message, !FINAL_REASONS.has(error.reason));
	}
	return failed(
		`"${filename}" could not be attached: ${formatErrorDetail(error) ?? "the request failed"}. Try again.`,
		true,
	);
};

const fromServer = (attachment: RemitImapOutboxAttachmentResponse): Entry => ({
	key: attachment.outboxAttachmentId,
	serverId: attachment.outboxAttachmentId,
	file: null,
	filename: attachment.filename,
	sizeBytes: attachment.sizeBytes,
	state:
		attachment.state === "Stored"
			? ATTACHED
			: failed(
					`"${attachment.filename}" did not finish uploading. Remove it and attach it again.`,
					false,
				),
});

interface UseComposeAttachmentsOptions {
	ensureDraft: () => Promise<DraftForAttachment>;
	onRemoveFailed: (error: unknown) => void;
}

/**
 * The files on the draft being written, and the three calls that put each one
 * there: reserve room, upload the bytes, confirm them. A file is never dropped
 * quietly — every way one can fail leaves its row in the list saying why.
 */
export const useComposeAttachments = ({
	ensureDraft,
	onRemoveFailed,
}: UseComposeAttachmentsOptions) => {
	const [entries, setEntries] = useState<Entry[]>([]);
	const draftIdRef = useRef<string | undefined>(undefined);
	const generationRef = useRef(0);
	const nextKeyRef = useRef(0);

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

	const patch = useCallback(
		(generation: number, key: string, change: Partial<Entry>) => {
			if (generation !== generationRef.current) return;
			setEntries((current) =>
				current.map((entry) =>
					entry.key === key ? { ...entry, ...change } : entry,
				),
			);
		},
		[],
	);

	const upload = useCallback(
		async (
			generation: number,
			key: string,
			file: File,
			outboxMessageId: string,
		) => {
			const minted = await mintMutation
				.mutateAsync({
					path: { outboxMessageId },
					body: {
						filename: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					},
				})
				.catch((error: unknown) => {
					patch(generation, key, { state: refusalOf(file.name, error) });
					return null;
				});
			if (minted === null) return;
			patch(generation, key, {
				serverId: minted.outboxAttachmentId,
				filename: minted.filename,
			});

			const put = await fetch(minted.uploadUrl, { method: "PUT", body: file })
				.then((response) =>
					response.ok ? null : `the server answered ${response.status}`,
				)
				.catch(
					(error: unknown) =>
						formatErrorDetail(error) ?? "the connection dropped",
				);
			if (put !== null) {
				patch(generation, key, {
					state: failed(
						`"${minted.filename}" did not finish uploading: ${put}. Try again.`,
						true,
					),
				});
				return;
			}

			const completed = await completeMutation
				.mutateAsync({
					path: {
						outboxMessageId,
						outboxAttachmentId: minted.outboxAttachmentId,
					},
				})
				.catch((error: unknown) => {
					patch(generation, key, { state: refusalOf(minted.filename, error) });
					return null;
				});
			if (completed === null) return;
			patch(generation, key, { state: ATTACHED });
		},
		[mintMutation.mutateAsync, completeMutation.mutateAsync, patch],
	);

	const keepOnServer = useCallback(
		(outboxMessageId: string, keep: readonly Entry[]) =>
			updateMutation
				.mutateAsync({
					path: { outboxMessageId },
					body: {
						attachmentIds: keep.flatMap((entry) =>
							entry.serverId === null ? [] : [entry.serverId],
						),
					},
				})
				.then(() => undefined),
		[updateMutation.mutateAsync],
	);

	const attach = useCallback(
		async (files: File[]) => {
			const generation = generationRef.current;
			const added = files.map((file): Entry & { file: File } => {
				nextKeyRef.current += 1;
				return {
					key: `local-${nextKeyRef.current}`,
					serverId: null,
					file,
					filename: file.name,
					sizeBytes: file.size,
					state: UPLOADING,
				};
			});
			setEntries((current) => [...current, ...added]);

			const draft = await ensureDraft();
			if (draft.outcome === "refused") {
				for (const entry of added) {
					patch(generation, entry.key, { state: failed(draft.reason, true) });
				}
				return;
			}
			if (generation !== generationRef.current) return;
			draftIdRef.current = draft.outboxMessageId;

			await Promise.all(
				added.map((entry) =>
					upload(generation, entry.key, entry.file, draft.outboxMessageId),
				),
			);
		},
		[ensureDraft, patch, upload],
	);

	const retry = useCallback(
		async (key: string) => {
			const entry = entries.find((candidate) => candidate.key === key);
			if (!entry || entry.file === null) return;
			const file = entry.file;
			const generation = generationRef.current;
			patch(generation, key, { state: UPLOADING });

			const draft = await ensureDraft();
			if (draft.outcome === "refused") {
				patch(generation, key, { state: failed(draft.reason, true) });
				return;
			}
			draftIdRef.current = draft.outboxMessageId;

			if (entry.serverId !== null) {
				const others = entries.filter((candidate) => candidate.key !== key);
				const dropped = await keepOnServer(draft.outboxMessageId, others).then(
					() => true,
					(error: unknown) => {
						patch(generation, key, { state: refusalOf(file.name, error) });
						return false;
					},
				);
				if (!dropped) return;
				patch(generation, key, { serverId: null });
			}

			await upload(generation, key, file, draft.outboxMessageId);
		},
		[entries, ensureDraft, keepOnServer, patch, upload],
	);

	const remove = useCallback(
		(key: string) => {
			const entry = entries.find((candidate) => candidate.key === key);
			if (!entry) return;
			const remaining = entries.filter((candidate) => candidate.key !== key);
			setEntries(remaining);
			const outboxMessageId = draftIdRef.current;
			if (entry.serverId === null || outboxMessageId === undefined) return;
			keepOnServer(outboxMessageId, remaining).catch(onRemoveFailed);
		},
		[entries, keepOnServer, onRemoveFailed],
	);

	const load = useCallback(
		(
			outboxMessageId: string,
			attachments: readonly RemitImapOutboxAttachmentResponse[],
		) => {
			draftIdRef.current = outboxMessageId;
			setEntries(attachments.map(fromServer));
		},
		[],
	);

	const reset = useCallback((outboxMessageId: string | undefined) => {
		generationRef.current += 1;
		draftIdRef.current = outboxMessageId;
		setEntries([]);
	}, []);

	const blockingReason = useMemo(() => {
		const uploading = entries.find(
			(entry) => entry.state.status === "uploading",
		);
		if (uploading) return `"${uploading.filename}" is still uploading.`;
		const broken = entries.find((entry) => entry.state.status === "failed");
		if (broken) {
			return `"${broken.filename}" is not attached. Try it again or remove it before sending.`;
		}
		return undefined;
	}, [entries]);

	const items: ComposeAttachmentItem[] = useMemo(
		() =>
			entries.map(({ key, filename, sizeBytes, state }) => ({
				key,
				filename,
				sizeBytes,
				state,
			})),
		[entries],
	);

	return { items, attach, retry, remove, load, reset, blockingReason };
};
