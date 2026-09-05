import { type RefObject, useEffect } from "react";
import { useOverlayDepth } from "./overlay-scope.js";

const FOCUSABLE_SELECTOR =
	"a[href], button, input, select, textarea, [tabindex]";

function isTabbable(element: HTMLElement): boolean {
	if (element.tabIndex < 0) return false;
	if (element.hasAttribute("disabled")) return false;
	if (element.getAttribute("aria-disabled") === "true") return false;
	if (element.closest("[inert], [hidden], [aria-hidden='true']")) return false;
	const style = getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * The controls Tab may reach inside this surface, in the order it reaches them.
 *
 * A modal opened from inside the surface takes the ring with it: the
 * intelligence pane's reclassify dialog renders under the drawer's own panel,
 * so a ring scoped to the panel puts its Cancel last and leaves every control
 * behind that dialog's backdrop in the cycle — Tab walks onto buttons no
 * pointer can reach, which is the bug the trap exists to prevent (#747).
 */
function tabRing(container: HTMLElement): HTMLElement[] {
	const nested = container.querySelectorAll<HTMLElement>(
		'[role="dialog"][aria-modal="true"]',
	);
	const root = nested[nested.length - 1] ?? container;
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		isTabbable,
	);
}

/** Open traps, by their position in the React tree. See {@link isTopTrap}. */
const openTraps = new Set<number>();

/**
 * Whether this surface is the innermost one trapping focus.
 *
 * Two surfaces can be up over overlapping DOM — the narrow-width nav drawer and
 * a dialog raised over it, a confirmation opened from inside a drawer — and only
 * the top one may answer Tab. Listener order cannot decide that: handlers run in
 * the order their effects registered, so the surface that opened first takes the
 * key and pulls focus out from under the one above it. Depth is the ordering
 * that holds, and `overlay-scope` already hands it out.
 */
function isTopTrap(depth: number): boolean {
	for (const other of openTraps) {
		if (other > depth) return false;
	}
	return true;
}

/**
 * The keyboard contract of an `aria-modal` surface, in one hook: focus moves
 * into `ref` when `open` turns true, Tab stays inside it while it is up, and
 * focus goes back to whatever held it once the surface closes or leaves — the
 * trigger can have gone with it, so the restore is guarded.
 *
 * The trap is a Tab handler rather than `inert` on the background: these
 * surfaces do not portal to the body, so there is no stable set of background
 * nodes to mark. It wraps at the ring's ends and pulls in focus that sits inside
 * the surface but outside the ring, under a nested dialog's backdrop (#973).
 * Focus that is already outside the surface is left alone: an error banner and
 * the fatal-error overlay paint above every modal from outside its subtree, and
 * a trap that reclaims every Tab strands them (#970).
 */
export function useModalFocus(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
): void {
	const depth = useOverlayDepth();

	useEffect(() => {
		if (!open) return;
		openTraps.add(depth);
		return () => {
			openTraps.delete(depth);
		};
	}, [open, depth]);

	useEffect(() => {
		if (!open) return;
		const restoreTo =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const container = ref.current;
		if (container) (tabRing(container)[0] ?? container).focus();
		return () => {
			if (restoreTo?.isConnected) restoreTo.focus();
		};
	}, [open, ref]);

	useEffect(() => {
		if (!open) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || event.defaultPrevented) return;
			if (!isTopTrap(depth)) return;
			const container = ref.current;
			if (!container) return;
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || !container.contains(active)) {
				return;
			}

			const ring = tabRing(container);
			const first = ring[0];
			const last = ring.at(-1);
			if (!first || !last) {
				event.preventDefault();
				return;
			}
			const inside = ring.includes(active);
			if (event.shiftKey) {
				if (!inside || active === first) {
					event.preventDefault();
					last.focus();
				}
				return;
			}
			if (!inside || active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, ref, depth]);
}
