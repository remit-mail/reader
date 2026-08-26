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
 * what it answers for, and the rest follows from that one declaration:
 *
 * - What the top frame answers is run by one listener, shared by every overlay.
 *   It sits on `window` in the capture phase, ahead of the triage layers and of
 *   every other window listener the app binds, and swallows the key it ran —
 *   Escape for a dismissal, and `i` for the drawer that key opened. A control
 *   inside an overlay with something of its own to close marks itself
 *   `[data-escape-owner]` and keeps Escape while it holds focus.
 * - Everything else is contained rather than swallowed: `useTriageKeyboard`
 *   resolves through {@link resolveAgainstOverlays} and declines to run a handler
 *   the top frame does not serve, so the key is inert instead of racing.
 *
 * An overlay that answers nothing — the selection wizard, which has its own Back
 * and Close and wants Escape to do neither — declares no answers and still
 * contains the keyboard while it is up.
 *
 * The stack is ordered by where each overlay sits in the React tree, taken once
 * at its first render: an overlay is above every overlay it renders inside. That
 * is the invariant a nested pair needs — a confirmation raised from inside a
 * drawer is the one Escape reaches — and it holds however the two came to be
 * open, including a remount that mounts both in one commit. Registration order
 * cannot state it: React runs a child's effects before its parent's, so
 * registering on mount puts the inner overlay underneath the one containing it.
 *
 * The stack is module state rather than a React context on purpose: a window
 * listener is global, so the register it answers from is too, and an overlay
 * rendered through a portal or mounted in a Storybook story needs no provider
 * above it to be seen.
 */
import { useEffect, useRef, useState } from "react";
import type { TriageAction } from "./keymap.js";
import {
	dispatchKey,
	isControlTarget,
	isEditableTarget,
} from "./keymap-dispatch.js";
import {
	type OverlayFrame,
	type Resolution,
	resolveOverlays,
} from "./shortcut-tree.js";

/** What an overlay answers, keyed by the action it answers. */
export type OverlayAnswers = Partial<Record<TriageAction, () => void>>;

interface ScopeEntry {
	id: string;
	/** Position in the React tree, ascending outward-in. See the module note. */
	depth: number;
	run: () => OverlayAnswers;
}

const ESCAPE_OWNER_SELECTOR = "[data-escape-owner]";

let entries: ScopeEntry[] = [];

/** Handed out by `useState` during render, so parents are numbered before children. */
let renderedOverlays = 0;
const nextDepth = (): number => ++renderedOverlays;

const byDepth = (a: ScopeEntry, b: ScopeEntry): number => a.depth - b.depth;

/**
 * The frames on screen, root first — the tree's `overlays`.
 *
 * Built on demand rather than stored, so an overlay that gains or loses an
 * answer while it is open says so without leaving the stack and rejoining it at
 * the top.
 */
export function overlayStack(): readonly OverlayFrame[] {
	return [...entries].sort(byDepth).map((entry) => ({
		id: entry.id,
		handles: Object.entries(entry.run())
			.filter(([, answer]) => answer)
			.map(([action]) => action as TriageAction),
	}));
}

/** The innermost overlay on screen — the leaf that answers first. */
function topEntry(): ScopeEntry | undefined {
	let top: ScopeEntry | undefined;
	for (const entry of entries) {
		if (!top || entry.depth > top.depth) top = entry;
	}
	return top;
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

/**
 * What this keystroke means to an overlay. Escape reaches one from anywhere
 * inside it, a focused field included — unless a control in there has its own
 * thing to close, which takes the press and leaves the next one for the overlay.
 * Every other key goes through the ordinary dispatch, so `i` typed into a field
 * inside a drawer is a letter and not a dismissal. A `g …` sequence is never an
 * overlay's to answer, so the prefix state is not carried here.
 */
function overlayAction(event: KeyboardEvent): TriageAction | null {
	if (event.key === "Escape") {
		const focused = document.activeElement;
		if (focused instanceof Element && focused.closest(ESCAPE_OWNER_SELECTOR)) {
			return null;
		}
		return "back";
	}
	return dispatchKey(
		{
			key: event.key,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			inEditable: isEditableTarget(event.target),
			onControl: isControlTarget(event.target),
		},
		null,
	).action;
}

function onOverlayKey(event: KeyboardEvent): void {
	const top = topEntry();
	if (!top) return;
	const action = overlayAction(event);
	if (!action) return;
	const answer = top.run()[action];
	if (!answer) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	answer();
}

function setEntries(next: ScopeEntry[]): void {
	const wasEmpty = entries.length === 0;
	entries = next;
	if (wasEmpty === (next.length === 0)) return;
	if (next.length > 0) {
		window.addEventListener("keydown", onOverlayKey, true);
		return;
	}
	window.removeEventListener("keydown", onOverlayKey, true);
}

export interface OverlayScopeOptions {
	/** Names the frame in the stack; only has to tell it from its neighbours. */
	id: string;
	/** On screen. A closed overlay leaves the stack and contains nothing. */
	open: boolean;
	/**
	 * What this overlay answers, run by the shared listener before any layer
	 * underneath sees the key. `back` is Escape, and dismissing is what a modal,
	 * a drawer and a menu all want it to mean. Every action outside the table is
	 * contained: inert for the surfaces underneath, never forwarded.
	 */
	answers?: OverlayAnswers;
}

/**
 * Put this overlay on the stack while it is open. One call replaces a
 * hand-rolled Escape listener, and hands the rest of the keyboard back to the
 * surfaces underneath only once the overlay is gone.
 */
export function useOverlayScope({
	id,
	open,
	answers = {},
}: OverlayScopeOptions): void {
	// Read at keystroke time, so neither a re-rendered answer nor a changed set
	// of them re-registers the frame.
	const answersRef = useRef(answers);
	answersRef.current = answers;

	// Numbered during the first render, where React is still going parent before
	// child — the one moment nesting is legible from inside a hook.
	const [depth] = useState(nextDepth);

	useEffect(() => {
		if (!open) return;
		const entry: ScopeEntry = { id, depth, run: () => answersRef.current };
		setEntries([...entries, entry]);
		return () => {
			setEntries(entries.filter((candidate) => candidate !== entry));
		};
	}, [id, open, depth]);
}
