import {
	outboxDetailOperationsUpdateOutboxMessageMutation,
	outboxOperationsCreateOutboxMessageMutation,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type ImmediateSave =
	| { outcome: "saved"; outboxMessageId: string }
	| { outcome: "failed"; error: unknown };

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

const settled = (promise: Promise<unknown>): Promise<void> =>
	promise.then(
		() => undefined,
		() => undefined,
	);

export const useSaveDraft = ({
	outboxMessageId,
	onDraftCreated,
}: UseSaveDraftOptions) => {
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [saveError, setSaveError] = useState<unknown>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const closedIdsRef = useRef<Set<string>>(new Set());
	const queryClient = useQueryClient();

	// The entry a save writes to. That is the prop, except between a save
	// creating the draft and the id arriving back as the prop — reading the prop
	// in that window creates the same draft a second time and strands one of the
	// two in the outbox.
	const propIdRef = useRef(outboxMessageId);
	const targetIdRef = useRef(outboxMessageId);
	if (propIdRef.current !== outboxMessageId) {
		// A write waiting out the debounce holds the document that has just been
		// left, aimed at whatever entry is current when it fires. Leaving one is
		// therefore dropping it: otherwise it lands on the next draft, or — with
		// no entry to land on at all — creates one holding the last message's
		// content, which is what a second Compose press used to do.
		//
		// Adoption is the exception, as it is everywhere: the id arriving is this
		// session's own draft coming back, and a save scheduled while it was in
		// flight is still the right content for it.
		const leavingADocument = propIdRef.current !== undefined;
		propIdRef.current = outboxMessageId;
		targetIdRef.current = outboxMessageId;
		if (leavingADocument && timerRef.current) clearTimeout(timerRef.current);
	}

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

			const targetId = targetIdRef.current;
			if (targetId) {
				const result = await updateMutation.mutateAsync({
					path: { outboxMessageId: targetId },
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
			targetIdRef.current = result.outboxMessageId;
			onDraftCreated(result.outboxMessageId);
			setSaveStatus("saved");
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesOptions().queryKey,
			});
			return result;
		},
		[createMutation, updateMutation, onDraftCreated, queryClient],
	);

	// One entry takes one write at a time. Overlapping writes settle in whatever
	// order the network gives them, so an older body can land last — and two of
	// them racing while the draft has no id yet each create one.
	const writesRef = useRef<Promise<void>>(Promise.resolve());
	const enqueueSave = useCallback(
		(data: DraftData) => {
			const write = writesRef.current.then(() => executeSave(data));
			writesRef.current = settled(write);
			return write;
		},
		[executeSave],
	);

	const saveDraft = useCallback(
		(data: DraftData) => {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				const targetId = targetIdRef.current;
				if (targetId && closedIdsRef.current.has(targetId)) return;
				// Keep the real error, not just a vague "error" status — the caller
				// surfaces its detail in a banner. A fatal 5xx additionally escalates
				// through the global MutationCache.onError sink.
				enqueueSave(data).catch((error: unknown) => {
					setSaveError(error);
					setSaveStatus("error");
				});
			}, 2000);
		},
		[enqueueSave],
	);

	// Whoever asks for this is acting on the draft right now and owns the
	// outcome, so the failure is returned rather than thrown and `saveError` is
	// left alone — the caller's own message is the accurate one, and setting
	// `saveError` would raise a second "Couldn't save draft" banner beside it.
	const saveImmediately = useCallback(
		(data: DraftData): Promise<ImmediateSave> => {
			if (timerRef.current) clearTimeout(timerRef.current);
			return enqueueSave(data)
				.then(
					(result): ImmediateSave => ({
						outcome: "saved",
						outboxMessageId: result.outboxMessageId,
					}),
				)
				.catch((error: unknown): ImmediateSave => {
					setSaveStatus("error");
					return { outcome: "failed", error };
				});
		},
		[enqueueSave],
	);

	// Called with an id, the entry is closed to autosave for good. Sending and
	// discarding both take the entry out of draft, and the compose effect that
	// schedules autosaves re-runs on every mutation settling — so dropping the
	// pending timer alone leaves the next render free to schedule another write
	// against an entry the server will refuse (#604).
	const stopAutoSave = useCallback((closedOutboxMessageId?: string) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		if (closedOutboxMessageId) closedIdsRef.current.add(closedOutboxMessageId);
	}, []);

	return { saveStatus, saveError, saveDraft, saveImmediately, stopAutoSave };
};
