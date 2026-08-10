import { type RefObject, useEffect } from "react";

const FOCUSABLE_SELECTOR =
	"a[href], button, input, select, textarea, [tabindex]";

export function tabbablesWithin(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	).filter(
		(el) =>
			el.tabIndex >= 0 &&
			!el.hasAttribute("disabled") &&
			!el.hasAttribute("inert"),
	);
}

export interface ModalSurfaceOptions {
	open: boolean;
	onClose: () => void;
	/** The element carrying `role="dialog"`. Focus lands in it and stays in it. */
	surfaceRef: RefObject<HTMLElement | null>;
	/**
	 * Outermost element of the modal — scrim included. Everything outside it
	 * goes inert while the modal is open. Defaults to the surface.
	 */
	boundaryRef?: RefObject<HTMLElement | null>;
}

/**
 * Modal behaviour shared by every dialog surface in the kit: Escape to close,
 * focus moved in on open and handed back to the trigger on close, Tab kept
 * inside, and the rest of the page inert while it is up.
 */
export function useModalSurface({
	open,
	onClose,
	surfaceRef,
	boundaryRef,
}: ModalSurfaceOptions): void {
	useEffect(() => {
		if (!open) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// A control inside the surface can own Escape while it has something
				// of its own to close — an open suggestion list. Escape closes that
				// first; the next Escape closes the surface.
				const focused = document.activeElement;
				if (focused instanceof Element && focused.closest("[data-escape-owner]"))
					return;
				e.preventDefault();
				e.stopImmediatePropagation();
				onClose();
				return;
			}
			if (e.key !== "Tab") return;
			const surface = surfaceRef.current;
			if (!surface) return;
			const tabbables = tabbablesWithin(surface);
			const active = document.activeElement;
			if (tabbables.length === 0) {
				e.preventDefault();
				surface.focus();
				return;
			}
			const first = tabbables[0];
			const last = tabbables[tabbables.length - 1];
			if (!(active instanceof HTMLElement) || !surface.contains(active)) {
				e.preventDefault();
				first.focus();
				return;
			}
			if (e.shiftKey && active === first) {
				e.preventDefault();
				last.focus();
				return;
			}
			if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [open, onClose, surfaceRef]);

	useEffect(() => {
		if (!open) return;
		const boundary = (boundaryRef ?? surfaceRef).current;
		if (!boundary) return;
		const hidden: HTMLElement[] = [];
		let node: HTMLElement | null = boundary;
		while (node?.parentElement) {
			for (const sibling of Array.from(node.parentElement.children)) {
				if (sibling === node || !(sibling instanceof HTMLElement)) continue;
				if (sibling.hasAttribute("inert")) continue;
				sibling.setAttribute("inert", "");
				hidden.push(sibling);
			}
			node = node.parentElement;
		}
		return () => {
			for (const el of hidden) el.removeAttribute("inert");
		};
	}, [open, surfaceRef, boundaryRef]);

	// Declared after the inert pass so its cleanup runs second: the trigger is
	// interactive again by the time focus is handed back to it.
	useEffect(() => {
		if (!open) return;
		const surface = surfaceRef.current;
		if (!surface) return;
		const trigger = document.activeElement;
		(tabbablesWithin(surface)[0] ?? surface).focus();
		return () => {
			if (!(trigger instanceof HTMLElement)) return;
			if (trigger === document.body || !trigger.isConnected) return;
			trigger.focus();
		};
	}, [open, surfaceRef]);
}
