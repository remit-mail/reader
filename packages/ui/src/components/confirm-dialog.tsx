import { useRef } from "react";
import { cn } from "../lib/cn.js";
import { useOverlayScope } from "../lib/overlay-scope.js";
import { useModalFocus } from "../lib/use-modal-focus.js";
import { DialogBackdrop } from "./dialog-backdrop.js";

export interface ConfirmDialogProps {
	isOpen: boolean;
	title: string;
	/** Optional supporting line under the title. */
	description?: string;
	confirmLabel: string;
	cancelLabel?: string;
	/** Style the confirm button as a destructive action. */
	destructive?: boolean;
	/** Disable the confirm button (e.g. while a mutation is in flight). */
	isBusy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Minimal accessible confirmation dialog. No existing Dialog/ConfirmDialog
 * primitive ships in the web client (only the bespoke KeyboardShortcutsModal
 * and SlidePanel), so this is a small reusable one matching their Tailwind +
 * overlay conventions. Esc cancels, the backdrop cancels, Cancel is focused on
 * open, and Tab stays inside the dialog.
 */
export const ConfirmDialog = ({
	isOpen,
	title,
	description,
	confirmLabel,
	cancelLabel = "Cancel",
	destructive = false,
	isBusy = false,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) => {
	const dialogRef = useRef<HTMLDivElement>(null);

	useOverlayScope({
		id: "confirm-dialog",
		open: isOpen,
		answers: { back: onCancel },
	});

	// Cancel is the first control in the dialog, so the shared trap opens on it —
	// a confirmation asks before it acts. Whoever opened the dialog gets the
	// focus back when it closes.
	useModalFocus(dialogRef, isOpen);

	if (!isOpen) return null;

	return (
		// Above every other overlay, the mobile compose sheet included: a
		// confirmation is the decision blocking whatever is under it, and a drawer
		// portalled to the body at the same level would cover it.
		<div className="fixed inset-0 z-[60] flex items-center justify-center">
			<DialogBackdrop
				label="Dismiss confirmation"
				onDismiss={onCancel}
				className="backdrop-blur-sm"
			/>

			{/* Dialog */}
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className={cn(
					"relative z-10 w-full max-w-sm",
					"bg-surface border border-line rounded-sm shadow-lg",
					"p-6",
				)}
			>
				<h2 className="text-lg font-semibold">{title}</h2>
				{description && (
					<p className="mt-2 text-sm text-fg-muted">{description}</p>
				)}

				<div className="mt-6 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className={cn(
							"min-h-11 inline-flex items-center justify-center px-4 rounded text-sm font-medium transition-colors",
							"border border-line hover:bg-surface-raised",
						)}
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						disabled={isBusy}
						className={cn(
							"min-h-11 inline-flex items-center justify-center px-4 rounded text-sm font-medium transition-colors",
							destructive
								? "bg-danger text-canvas hover:bg-danger/90"
								: "bg-accent text-accent-fg hover:bg-accent-hover",
							"disabled:opacity-50 disabled:cursor-not-allowed",
						)}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
};
