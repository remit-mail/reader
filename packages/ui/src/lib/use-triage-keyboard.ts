import { useEffect, useRef } from "react";
import type { TriageHandlers } from "./keymap.js";
import {
	dispatchKey,
	isControlTarget,
	isEditableTarget,
	type SequencePrefix,
} from "./keymap-dispatch.js";
import { resolveAgainstOverlays } from "./overlay-scope.js";

interface UseTriageKeyboardOptions {
	handlers: TriageHandlers;
	/** Disable the whole layer (e.g. a blocking modal owns the keyboard). */
	enabled?: boolean;
	/**
	 * The element the layer listens on. Omitted, the layer is the page's and
	 * takes the window — the app's. A layer belonging to one mounted surface
	 * passes that surface's element, so several of them on a page (a Storybook
	 * docs page carrying every list story) each answer only the keys pressed
	 * inside their own; `null` until that element is up, and inert until then.
	 */
	target?: HTMLElement | null;
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
 * List navigation and selection route through here and nowhere else: the list
 * publishes its commands upward and its host wires them into the handler
 * table, so `keymap.ts` is the source of truth for both the displayed bindings
 * and the routed ones. Every surface that mounts a list — the app and the
 * Storybook prototype — drives it from here, so the interaction reviewed in
 * Storybook is the one users get. The list used to run a second window listener
 * claiming the same keys, which is what made Enter unusable on every focused
 * button in the app (#43).
 *
 * Other window-level keydown listeners still exist for keys this layer does not
 * own — `?` at the mail layout, `/` in SearchBar, Esc in the compose and
 * conversation views. They bind disjoint keys; only the list's competing
 * listener was removed.
 *
 * An open overlay pre-empts the whole layer. Every mounted modal, drawer and
 * menu declares itself through `overlay-scope`, and each action is resolved
 * against that stack before a handler runs, so no layer acts through a surface
 * the reader has on top of it.
 *
 * Per-action targeting (focused row vs selection) and the actual mutations live
 * in the handlers the caller passes in — this hook only dispatches.
 */
export function useTriageKeyboard({
	handlers,
	enabled = true,
	target,
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

			// An overlay is the leaf of the shortcut tree: while one is on screen it
			// answers what it serves — through `overlay-scope`'s own listener, which
			// has already run and swallowed the key — and contains the rest. Either
			// way this layer stays out of the way rather than acting through the
			// modal (#959). A contained key is left undefaulted; it was never ours.
			if (resolveAgainstOverlays(result.action) !== null) return;

			const handler = handlersRef.current[result.action];
			if (!handler) return;

			if (result.preventDefault) event.preventDefault();
			handler();
		};

		const element: EventTarget | null = target === undefined ? window : target;
		if (element === null) return;

		element.addEventListener("keydown", onKeyDown as EventListener);
		return () => {
			element.removeEventListener("keydown", onKeyDown as EventListener);
			clearPrefixTimer();
			prefixRef.current = null;
		};
	}, [enabled, sequenceTimeoutMs, target]);
}
