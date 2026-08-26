import { cn, type OverlayAnswers, useOverlayScope } from "@remit/ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	"a[href], button, input, select, textarea, [tabindex]";

const isTabbable = (element: HTMLElement): boolean => {
	if (element.tabIndex < 0) return false;
	if (element.hasAttribute("disabled")) return false;
	if (element.getAttribute("aria-disabled") === "true") return false;
	if (element.closest("[inert], [hidden], [aria-hidden='true']")) return false;
	const style = getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
};

/**
 * The elements Tab may reach, in the order it reaches them.
 *
 * A modal opened from inside the drawer takes the ring with it: the
 * intelligence pane's reclassify dialog renders under the drawer's own panel,
 * so a ring scoped to the panel puts its Cancel last and leaves every control
 * behind that dialog's backdrop in the cycle — Tab walks onto buttons no
 * pointer can reach, which is the bug the trap exists to prevent.
 */
const tabRing = (panel: HTMLElement): HTMLElement[] => {
	const nested = panel.querySelectorAll<HTMLElement>(
		'[role="dialog"][aria-modal="true"]',
	);
	const root = nested[nested.length - 1] ?? panel;
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		isTabbable,
	);
};

interface DrawerProps {
	isOpen: boolean;
	onClose: () => void;
	children: ReactNode;
	ariaLabel?: string;
	side?: "left" | "right";
	widthClassName?: string;
	/**
	 * Shortcuts the drawer keeps serving while it is up, beyond Escape. The key
	 * that opened it is the one that has to reach it — `i` closes the
	 * intelligence drawer it opened — and everything left undeclared is
	 * contained, so no verb acts on the list behind the scrim.
	 */
	answers?: OverlayAnswers;
}

/**
 * Modal navigation drawer. Slides in from the side with a scrim behind.
 * Dismissed by scrim tap, escape key, or the close button. Focus moves into
 * the drawer on open and returns to the previously focused element on close.
 *
 * Visibility is `isOpen` alone, at every width: the drawer is the intelligence
 * surface wherever the rail has no room, which includes the two-pane desktop
 * band between 1024 and 1280px.
 */
export const Drawer = ({
	isOpen,
	onClose,
	children,
	ariaLabel = "Navigation",
	side = "left",
	widthClassName = "w-[80vw] max-w-[320px]",
	answers,
}: DrawerProps) => {
	const drawerRef = useRef<HTMLDivElement>(null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);

	useOverlayScope({
		id: "drawer",
		open: isOpen,
		answers: { back: onClose, ...answers },
	});

	useEffect(() => {
		if (!isOpen) return;

		previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

		const handleKey = (event: KeyboardEvent) => {
			// Trap Tab inside the drawer's ring: walking off either end cycles
			// round, and focus that is in the drawer but outside the ring — a
			// control behind a nested dialog's backdrop — is pulled in, so Tab
			// never lands where a pointer cannot reach (#747). The trap only
			// applies while the drawer already holds focus; an error banner or
			// the fatal-error overlay above it keeps its own Tab (#970).
			if (event.key !== "Tab" || !drawerRef.current) return;
			const active = document.activeElement;
			if (!(active instanceof HTMLElement)) return;
			if (!drawerRef.current.contains(active)) return;
			const ring = tabRing(drawerRef.current);
			if (ring.length === 0) return;
			const first = ring[0];
			const last = ring[ring.length - 1];
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

		document.addEventListener("keydown", handleKey);

		// Move focus into the drawer
		if (drawerRef.current) tabRing(drawerRef.current)[0]?.focus();

		// Lock body scroll
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", handleKey);
			document.body.style.overflow = previousOverflow;
			previouslyFocusedRef.current?.focus();
		};
	}, [isOpen]);

	if (!isOpen) return null;

	const sideClasses =
		side === "left"
			? "left-0 border-r animate-in slide-in-from-left duration-150"
			: "right-0 border-l animate-in slide-in-from-right duration-150";

	return (
		<div
			className="fixed inset-0 z-50"
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel}
		>
			{/* Scrim */}
			<button
				type="button"
				aria-label="Close menu"
				onClick={onClose}
				className="absolute inset-0 bg-black/40 animate-in fade-in duration-150 cursor-default"
			/>
			{/* Drawer panel */}
			<div
				ref={drawerRef}
				className={cn(
					"safe-area-frame absolute top-0 bottom-0 bg-canvas border-line shadow-xl flex flex-col",
					widthClassName,
					sideClasses,
				)}
			>
				<div className="flex items-center justify-end h-12 px-2 border-b border-line shrink-0">
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-md hover:bg-surface-raised transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
						aria-label="Close menu"
					>
						<X className="size-5" />
					</button>
				</div>
				<div className="flex-1 overflow-y-auto">{children}</div>
			</div>
		</div>
	);
};
