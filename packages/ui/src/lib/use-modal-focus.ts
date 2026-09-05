import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function tabbablesWithin(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	).filter(
		(el) =>
			el.tabIndex >= 0 &&
			!el.hasAttribute("disabled") &&
			el.getAttribute("aria-hidden") !== "true" &&
			el.closest("[inert]") === null,
	);
}

/**
 * The keyboard contract of an `aria-modal` surface, in one hook: focus moves
 * into `ref` when `open` turns true, Tab stays inside it while it is up, and
 * focus goes back to whatever held it once `open` turns false again — guarded,
 * since the trigger can have left the DOM while the surface was open.
 *
 * The trap is a Tab handler rather than `inert` on the background: neither
 * surface portals to the body, so there is no stable set of background nodes to
 * mark. It listens on the document, so focus that has already escaped is pulled
 * back on the next Tab, and stands down once a surface nested inside this one
 * has answered the key.
 */
export function useModalFocus(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
): void {
	const restoreTo = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) {
			const previous = restoreTo.current;
			restoreTo.current = null;
			if (previous && document.contains(previous)) previous.focus();
			return;
		}
		restoreTo.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const container = ref.current;
		if (!container) return;
		tabbablesWithin(container)[0]?.focus();
	}, [open, ref]);

	useEffect(() => {
		if (!open) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || event.defaultPrevented) return;
			const container = ref.current;
			if (!container) return;

			const tabbables = tabbablesWithin(container);
			const [first] = tabbables;
			const last = tabbables.at(-1);
			if (!first || !last) {
				event.preventDefault();
				return;
			}
			const active = document.activeElement;

			if (!(active instanceof HTMLElement) || !container.contains(active)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
				return;
			}
			if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
				return;
			}
			if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, ref]);
}
