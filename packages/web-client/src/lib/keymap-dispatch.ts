import type { TriageAction } from "./keymap.js";

/**
 * Pure dispatch core for the global triage keyboard layer (#429).
 *
 * The React hook (`useTriageKeyboard`) owns DOM wiring and the handler table;
 * this module owns the *decision* — given a normalized keystroke and the
 * current sequence-prefix state, which {@link TriageAction} (if any) fires, and
 * what the next sequence-prefix state is. Keeping it pure makes the routing,
 * input suppression and `g`-prefix sequencing unit-testable without JSDOM.
 */

/** The subset of a KeyboardEvent the dispatcher reads. */
export interface KeyStroke {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	/** Whether the event originated inside an editable surface. */
	inEditable: boolean;
}

/** Pending sequence-prefix state. `"g"` means a `g` was pressed recently. */
export type SequencePrefix = null | "g";

export interface DispatchResult {
	/** The action to run, or null when the stroke maps to nothing actionable. */
	action: TriageAction | null;
	/** The sequence-prefix state to carry into the next stroke. */
	nextPrefix: SequencePrefix;
	/** Whether the host should preventDefault on this stroke. */
	preventDefault: boolean;
}

const NONE: DispatchResult = {
	action: null,
	nextPrefix: null,
	preventDefault: false,
};

/**
 * Second key of a `g …` go-to sequence → action. Keys are lowercased; `,`
 * stays as-is.
 */
const GO_TO_SEQUENCE: Record<string, TriageAction> = {
	b: "goBrief",
	i: "goInbox",
	s: "goSent",
	f: "goFlagged",
	",": "goSettings",
};

/**
 * Plain single-key bindings (no meta, no `g` prefix). `shift` here means the
 * binding *requires* shift; absence means shift must be absent.
 */
interface PlainBinding {
	action: TriageAction;
	requireShift?: boolean;
}

/**
 * Lowercased key → binding. `event.key` is lowercased before lookup, so the
 * shifted variants (`#`, `!`, `?`) are matched by their produced character, and
 * letter keys ignore caps. Shift-j/k extend selection and are handled before
 * this table.
 */
const PLAIN_BINDINGS: Record<string, PlainBinding> = {
	j: { action: "focusNext" },
	k: { action: "focusPrevious" },
	enter: { action: "openFocused" },
	u: { action: "toggleRead" },
	x: { action: "toggleSelect" },
	r: { action: "reply" },
	a: { action: "replyAll" },
	f: { action: "forward" },
	e: { action: "archive" },
	"#": { action: "delete" },
	s: { action: "toggleStar" },
	m: { action: "muteSender" },
	b: { action: "blockSender" },
	v: { action: "vipSender" },
	"!": { action: "markJunk" },
	i: { action: "toggleIntelligence" },
	d: { action: "toggleDensity" },
	"/": { action: "focusSearch" },
	c: { action: "compose" },
	"?": { action: "help" },
};

/**
 * Resolve a keystroke into an action and the next sequence-prefix state. Pure:
 * no DOM, no side effects.
 *
 * Rules:
 * - In an editable surface only `Esc` fires (clears any pending prefix).
 * - `⌘N` / `Ctrl+N` → compose (the only meta combo we own).
 * - A pending `g` prefix consumes the next key as a go-to sequence; an
 *   unmatched second key cancels the prefix and is otherwise inert.
 * - `g` (no modifiers) arms the prefix.
 * - `Shift+J` / `Shift+K` extend the selection.
 * - Otherwise a plain single-key binding fires.
 * - Any non-Esc keystroke clears a stale prefix.
 */
export function dispatchKey(
	stroke: KeyStroke,
	prefix: SequencePrefix,
): DispatchResult {
	const lower = stroke.key.toLowerCase();
	const meta = stroke.metaKey || stroke.ctrlKey;

	// Editable surfaces: the layer is fully inert. Even Esc is left to the
	// focused field's own handler (SearchBar clears the query / blurs on Esc);
	// emitting `back` here would double-fire — clearing search AND closing the
	// open thread on one keypress. We still clear any pending `g` prefix so a
	// stray sequence can't leak across a focus change into the field.
	if (stroke.inEditable) {
		return { ...NONE, nextPrefix: prefix === "g" ? null : prefix };
	}

	// ⌘N / Ctrl+N → compose. Checked before the prefix/plain tables so the
	// browser's "new window" is the only thing we intercept among meta combos.
	if (meta && lower === "n") {
		return { action: "compose", nextPrefix: null, preventDefault: true };
	}

	// Any other meta/ctrl combo is left to the browser/OS.
	if (meta) return { ...NONE, nextPrefix: prefix === "g" ? null : prefix };

	// Esc: back/close. Always clears the prefix.
	if (lower === "escape") {
		return { action: "back", nextPrefix: null, preventDefault: false };
	}

	// Resolve a pending `g …` sequence.
	if (prefix === "g") {
		const seqKey = lower === "," ? "," : lower;
		const action = GO_TO_SEQUENCE[seqKey] ?? null;
		// Consume the second key whether or not it matched; the prefix resets.
		return { action, nextPrefix: null, preventDefault: action !== null };
	}

	// Arm the `g` prefix (no shift, no modifiers).
	if (lower === "g" && !stroke.shiftKey) {
		return { action: null, nextPrefix: "g", preventDefault: true };
	}

	// Shift+J / Shift+K extend the selection.
	if (stroke.shiftKey && (lower === "j" || lower === "k")) {
		return {
			action: lower === "j" ? "extendSelectDown" : "extendSelectUp",
			nextPrefix: null,
			preventDefault: true,
		};
	}

	// Plain single-key bindings.
	const binding = PLAIN_BINDINGS[lower];
	if (binding) {
		const needsShift = binding.requireShift === true;
		// `?`, `#`, `!` are produced with Shift on most layouts; their entries
		// are keyed by the produced character so we don't gate on shift here.
		// Plain letter bindings must NOT fire when shift is held (e.g. Shift+R).
		const isPunctuation = lower.length === 1 && !/[a-z0-9]/.test(lower);
		if (!needsShift && stroke.shiftKey && !isPunctuation) {
			return NONE;
		}
		return { action: binding.action, nextPrefix: null, preventDefault: true };
	}

	return NONE;
}

/**
 * Whether a DOM event target is an editable surface (input/textarea/select/
 * contenteditable). Exposed so the hook and tests share one definition.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	);
}
