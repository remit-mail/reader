import { useEffect, useRef } from "react";
import type { TriageAction } from "@/lib/keymap";
import {
	dispatchKey,
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
 * Routing is intentionally NOT fully unified yet: this hook owns the action
 * verbs + go-to keys, while the list-local navigation keys (j/k/x/Enter/d,
 * Shift+arrow, Delete/Backspace) are still routed by MessageList's legacy
 * `useKeyboardNavigation`, `/` by SearchBar, and `?` by the mail layout — three
 * separate window listeners, each with its own (consistent) input-guard. The
 * `@/lib/keymap` module is the single source of truth for the DISPLAYED
 * bindings (the `?` overlay + tooltips), but not yet for routing. Consolidating
 * every binding through `dispatchKey` is a follow-up; see #429.
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
