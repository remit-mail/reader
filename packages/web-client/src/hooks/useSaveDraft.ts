import {
	outboxDetailOperationsUpdateOutboxMessageMutation,
	outboxOperationsCreateOutboxMessageMutation,
	outboxOperationsListOutboxMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { ComposeSaveState } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { softErrorMeta } from "../lib/error-classifier";

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

/**
 * A draft with no To address yet has nothing the create endpoint will accept —
 * `CreateOutboxMessageInput.toAddresses` carries `@minItems(1)`, so the request
 * comes back 400. Cc and Bcc do not stand in for it; the constraint names
 * `toAddresses` and nothing else. Forward opens in exactly that state, with a
 * subject and a quote and no address, and it is a normal place to be while
 * writing rather than a failure to report. The update endpoint has no such
 * constraint, so only a draft that does not exist yet is held back.
 *
 * The send guard in `outbox-queue.ts` counts Cc and Bcc, and is right to: a
 * Bcc-only envelope is real mail. It answers a different question — whether
 * this message has anywhere to go — from this one, which is only whether the
 * create schema will take it.
 */
const nothingToCreateYet = (
	targetId: string | undefined,
	data: DraftData,
): boolean => targetId === undefined && data.toAddresses.length === 0;

/**
 * Held back, and naming what is actually missing. "A recipient" was a lie to
 * anyone who had filled in Cc: they had one, and were being told to add what
 * they could see on screen.
 *
 * Module scope, not a literal built in the render: this is set from inside the
 * autosave effect, and a fresh object each time would be a new state on every
 * render with the effect re-running on each of them.
 */
const NOT_SAVED_WITHOUT_A_TO_ADDRESS: ComposeSaveState = {
	status: "unsaved",
	reason: "Not saved — add a To address to keep this draft.",
};

const IDLE: ComposeSaveState = { status: "idle" };
const SAVING: ComposeSaveState = { status: "saving" };
const SAVED: ComposeSaveState = { status: "saved" };
const SAVE_FAILED: ComposeSaveState = { status: "error" };

const settled = (promise: Promise<unknown>): Promise<void> =>
	promise.then(
		() => undefined,
		() => undefined,
	);

export const useSaveDraft = ({
	outboxMessageId,
	onDraftCreated,
}: UseSaveDraftOptions) => {
	const [saveState, setSaveState] = useState<ComposeSaveState>(IDLE);
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

	// A write that fails belongs in the composer's banner beside the message it
	// could not save, never on the full-screen page that unmounts the composer
	// and the message with it. A 5xx still escalates.
	const createMutation = useMutation({
		...outboxOperationsCreateOutboxMessageMutation(),
		meta: softErrorMeta,
	});
	const updateMutation = useMutation({
		...outboxDetailOperationsUpdateOutboxMessageMutation(),
		meta: softErrorMeta,
	});

	const executeSave = useCallback(
		async (data: DraftData) => {
			setSaveState(SAVING);
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
				setSaveState(SAVED);
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
			setSaveState(SAVED);
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesOptions().queryKey,
			});
			return result;
		},
		[
			createMutation.mutateAsync,
			updateMutation.mutateAsync,
			onDraftCreated,
			queryClient,
		],
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
			// Said now rather than two seconds from now: the composer is holding
			// text nothing is going to persist, and the moment it starts holding it
			// is the moment the user has to be able to see that.
			if (nothingToCreateYet(targetIdRef.current, data)) {
				setSaveState(NOT_SAVED_WITHOUT_A_TO_ADDRESS);
				return;
			}
			// The sentence goes the moment its reason does, rather than standing
			// for the two seconds until the write it is no longer true about
			// lands. Only that sentence is cleared: a "Draft saved" from the
			// previous write is still the truth about this document.
			setSaveState((current) =>
				current.status === "unsaved" ? IDLE : current,
			);
			timerRef.current = setTimeout(() => {
				const targetId = targetIdRef.current;
				if (targetId && closedIdsRef.current.has(targetId)) return;
				// Keep the real error, not just a vague "error" status — the caller
				// surfaces its detail in a banner. A fatal 5xx additionally escalates
				// through the global MutationCache.onError sink.
				enqueueSave(data).catch((error: unknown) => {
					setSaveError(error);
					setSaveState(SAVE_FAILED);
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
					setSaveState(SAVE_FAILED);
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

	return { saveState, saveError, saveDraft, saveImmediately, stopAutoSave };
};
