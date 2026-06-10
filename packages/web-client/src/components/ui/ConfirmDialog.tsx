import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
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
 * open, and the confirm/cancel pair is the only focusable content so the focus
 * stays within the dialog.
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
	const cancelRef = useRef<HTMLButtonElement>(null);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				onCancel();
			}
		},
		[onCancel],
	);

	useEffect(() => {
		if (!isOpen) return;
		// Capture phase so Esc closes the dialog before any list-level Esc
		// handler (e.g. clearSelection) also fires on the same keystroke.
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [isOpen, handleKeyDown]);

	useEffect(() => {
		if (isOpen) {
			cancelRef.current?.focus();
		}
	}, [isOpen]);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			role="presentation"
			onClick={onCancel}
		>
			{/* Backdrop */}
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />

			{/* Dialog */}
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className={cn(
					"relative z-10 w-full max-w-sm",
					"bg-surface border border-line rounded-sm shadow-lg",
					"p-6",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold">{title}</h2>
				{description && (
					<p className="mt-2 text-sm text-fg-muted">{description}</p>
				)}

				<div className="mt-6 flex items-center justify-end gap-2">
					<button
						ref={cancelRef}
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
