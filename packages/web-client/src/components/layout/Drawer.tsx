import {
	cn,
	type OverlayAnswers,
	useModalFocus,
	useOverlayScope,
} from "@remit/ui";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

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

	useOverlayScope({
		id: "drawer",
		open: isOpen,
		answers: { back: onClose, ...answers },
	});

	useModalFocus(drawerRef, isOpen);

	useEffect(() => {
		if (!isOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
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
