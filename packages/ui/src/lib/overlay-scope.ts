/**
 * The live overlay stack — the runtime half of the shortcut tree's leaf.
 *
 * `shortcut-tree` already states the rule: the top overlay frame either answers
 * an action or contains it, and a key pressed over an overlay never reaches the
 * surface behind it. Nothing enforced that at runtime, so every overlay grew its
 * own answer — a capture-phase window listener here, a document-phase
 * `stopPropagation` there, a `blocksKeyboard` flag threaded up through a pane —
 * and the surfaces that grew none let Escape close the conversation underneath
 * (#958) while `c` opened compose out from under a modal (#959).
 *
 * A mounted overlay declares itself here for as long as it is on screen, with
 * the handlers it answers for, and the rest follows from that one declaration:
 *
 * - Escape is answered by one listener, shared by every overlay. It sits on
 *   `window` in the capture phase, ahead of the triage layers and of every other
 *   window listener the app binds, runs the top frame's `back` and swallows the
 *   key. A control inside an overlay with something of its own to close marks
 *   itself `[data-escape-owner]` and keeps Escape while it holds focus.
 * - Every other action is contained rather than swallowed: `useTriageKeyboard`
 *   resolves through {@link resolveAgainstOverlays} and declines to run a handler
 *   the top frame does not serve, so the key is inert instead of racing.
 *
 * An overlay that answers nothing — the selection wizard, which has its own Back
 * and Close and wants Escape to do neither — passes no handlers and still
 * contains the keyboard while it is up.
 *
 * The stack is module state rather than a React context on purpose: a window
 * listener is global, so the register it answers from is too, and an overlay
 * rendered through a portal or mounted in a Storybook story needs no provider
 * above it to be seen.
 */
import { useEffect, useRef } from "react";
import type { TriageAction } from "./keymap.js";
import {
	type OverlayFrame,
	type Resolution,
	resolveOverlays,
} from "./shortcut-tree.js";

/** What an overlay answers, keyed by the action it answers. */
export type OverlayHandlers = Partial<Record<TriageAction, () => void>>;

interface ScopeEntry {
	frame: OverlayFrame;
	run: () => OverlayHandlers;
}

const ESCAPE_OWNER_SELECTOR = "[data-escape-owner]";

let entries: ScopeEntry[] = [];

/** The frames on screen, root first — the tree's `overlays`. */
export function overlayStack(): readonly OverlayFrame[] {
	return entries.map((entry) => entry.frame);
}

/**
 * How the open overlays answer this action, or null when none is up. A layer
 * with a window-level keyboard consults this before running a handler of its
 * own: any answer at all means the action belongs to the overlay.
 */
export function resolveAgainstOverlays(
	action: TriageAction,
): Resolution | null {
	return resolveOverlays(action, overlayStack());
}

function onEscape(event: KeyboardEvent): void {
	if (event.key !== "Escape") return;
	const top = entries.at(-1);
	if (!top) return;
	const back = top.run().back;
	if (!back) return;
	// A suggestion list, an inline draft form, a correction menu: the control has
	// its own thing to close, so Escape closes that and the next press reaches
	// the overlay.
	const focused = document.activeElement;
	if (focused instanceof Element && focused.closest(ESCAPE_OWNER_SELECTOR)) {
		return;
	}
	event.preventDefault();
	event.stopImmediatePropagation();
	back();
}

function setEntries(next: ScopeEntry[]): void {
	const wasEmpty = entries.length === 0;
	entries = next;
	if (wasEmpty === (next.length === 0)) return;
	if (next.length > 0) {
		window.addEventListener("keydown", onEscape, true);
		return;
	}
	window.removeEventListener("keydown", onEscape, true);
}

export interface OverlayScopeOptions {
	/** Names the frame in the stack; only has to tell it from its neighbours. */
	id: string;
	/** On screen. A closed overlay leaves the stack and contains nothing. */
	open: boolean;
	/**
	 * What this overlay answers. `back` is Escape, and dismissing is what a
	 * modal, a drawer and a menu all want it to mean. Every action outside the
	 * table is contained: inert for the surfaces underneath, never forwarded.
	 */
	handlers?: OverlayHandlers;
}

/**
 * Put this overlay on the stack while it is open. One call replaces a
 * hand-rolled Escape listener, and hands the rest of the keyboard back to the
 * surfaces underneath only once the overlay is gone.
 */
export function useOverlayScope({
	id,
	open,
	handlers = {},
}: OverlayScopeOptions): void {
	// Read at keystroke time so a re-rendered handler never re-registers the
	// frame — a frame that leaves and rejoins the stack loses its place in it.
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	const served = Object.keys(handlers).sort().join(",");

	useEffect(() => {
		if (!open) return;
		const entry: ScopeEntry = {
			frame: {
				id,
				handles: served === "" ? [] : (served.split(",") as TriageAction[]),
			},
			run: () => handlersRef.current,
		};
		setEntries([...entries, entry]);
		return () => {
			setEntries(entries.filter((candidate) => candidate !== entry));
		};
	}, [id, open, served]);
}
