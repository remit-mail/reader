import {
	outboxDetailOperationsUpdateOutboxMessageMutation,
	outboxOperationsCreateOutboxMessageMutation,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface DraftData {
	accountId: string;
	toAddresses: string[];
	ccAddresses?: string[];
	bccAddresses?: string[];
	subject?: string;
	textBody?: string;
	htmlBody?: string;
	inReplyTo?: string;
	references?: string[];
}

interface UseSaveDraftOptions {
	outboxMessageId?: string;
	onDraftCreated: (id: string) => void;
}

export const useSaveDraft = ({
	outboxMessageId,
	onDraftCreated,
}: UseSaveDraftOptions) => {
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [saveError, setSaveError] = useState<unknown>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const queryClient = useQueryClient();

	const createMutation = useMutation(
		outboxOperationsCreateOutboxMessageMutation(),
	);
	const updateMutation = useMutation(
		outboxDetailOperationsUpdateOutboxMessageMutation(),
	);

	const executeSave = useCallback(
		async (data: DraftData) => {
			setSaveStatus("saving");
			setSaveError(null);

			if (outboxMessageId) {
				const result = await updateMutation.mutateAsync({
					path: { outboxMessageId },
					body: {
						toAddresses: data.toAddresses,
						ccAddresses: data.ccAddresses,
						bccAddresses: data.bccAddresses,
						subject: data.subject,
						textBody: data.textBody,
						htmlBody: data.htmlBody,
						inReplyTo: data.inReplyTo,
						references: data.references,
					},
				});
				setSaveStatus("saved");
				return result;
			}

			const result = await createMutation.mutateAsync({
				body: {
					...data,
					sendImmediately: false,
				},
			});
			onDraftCreated(result.outboxMessageId);
			setSaveStatus("saved");
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesOptions().queryKey,
			});
			return result;
		},
		[
			outboxMessageId,
			createMutation,
			updateMutation,
			onDraftCreated,
			queryClient,
		],
	);

	const saveDraft = useCallback(
		(data: DraftData) => {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				// Keep the real error, not just a vague "error" status — the caller
				// surfaces its detail in a banner. A fatal 5xx additionally escalates
				// through the global MutationCache.onError sink.
				executeSave(data).catch((error: unknown) => {
					setSaveError(error);
					setSaveStatus("error");
				});
			}, 2000);
		},
		[executeSave],
	);

	const saveImmediately = useCallback(
		(data: DraftData) => {
			if (timerRef.current) clearTimeout(timerRef.current);
			return executeSave(data);
		},
		[executeSave],
	);

	const cancelAutoSave = useCallback(() => {
		if (timerRef.current) clearTimeout(timerRef.current);
	}, []);

	return { saveStatus, saveError, saveDraft, saveImmediately, cancelAutoSave };
};
