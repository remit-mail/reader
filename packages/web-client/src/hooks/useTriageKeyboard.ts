import { useEffect, useRef } from "react";
import type { TriageAction } from "@/lib/keymap";
import {
	dispatchKey,
	isControlTarget,
	isEditableTarget,
	type SequencePrefix,
} from "@/lib/keymap-dispatch";

/** Map of action → handler. Omitted actions are inert (no-op). */
export type TriageHandlers = Partial<Record<TriageAction, () => void>>;

interface UseTriageKeyboardOptions {
	handlers: TriageHandlers;
	/** Disable the whole layer (e.g. a blocking modal owns the keyboard). */
	enabled?: boolean;
	/**
	 * Reset window (ms) for a pending `g …` sequence prefix. After this with no
	 * second key, the prefix is dropped. ~1s per the spec.
	 */
	sequenceTimeoutMs?: number;
}

/**
 * Global keydown handler for the triage layer's VERBS (#429). Routes keystrokes
 * through the pure {@link dispatchKey} core to the supplied handler table,
 * staying fully inert while focus is in an editable surface (input/textarea/CE;
 * even Esc is left to the focused field's own handler) and carrying the `g …`
 * go-to sequence prefix across keystrokes with a timeout.
 *
 * This is the only listener that routes list navigation and selection: the
 * message list publishes its commands upward (see `MessageListCommands`) and
 * the route wires them into the handler table, so `@/lib/keymap` is the single
 * source of truth for both the displayed bindings and the routed ones. A second
 * listener claiming the same keys is what made Enter unusable on every focused
 * button in the app (#43).
 *
 * Per-action targeting (focused row vs selection) and the actual mutations live
 * in the handlers the caller passes in — this hook only dispatches.
 */
export function useTriageKeyboard({
	handlers,
	enabled = true,
	sequenceTimeoutMs = 1000,
}: UseTriageKeyboardOptions): void {
	// Latest handlers without re-subscribing the listener every render.
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	const prefixRef = useRef<SequencePrefix>(null);
	const prefixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!enabled) return;

		const clearPrefixTimer = () => {
			if (prefixTimerRef.current !== null) {
				clearTimeout(prefixTimerRef.current);
				prefixTimerRef.current = null;
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			const result = dispatchKey(
				{
					key: event.key,
					shiftKey: event.shiftKey,
					metaKey: event.metaKey,
					ctrlKey: event.ctrlKey,
					altKey: event.altKey,
					inEditable: isEditableTarget(event.target),
					onControl: isControlTarget(event.target),
				},
				prefixRef.current,
			);

			// Update the pending prefix and (re)arm / clear its reset timer.
			clearPrefixTimer();
			prefixRef.current = result.nextPrefix;
			if (result.nextPrefix !== null) {
				prefixTimerRef.current = setTimeout(() => {
					prefixRef.current = null;
					prefixTimerRef.current = null;
				}, sequenceTimeoutMs);
			}

			if (result.action === null) return;

			const handler = handlersRef.current[result.action];
			if (!handler) return;

			if (result.preventDefault) event.preventDefault();
			handler();
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			clearPrefixTimer();
			prefixRef.current = null;
		};
	}, [enabled, sequenceTimeoutMs]);
}
