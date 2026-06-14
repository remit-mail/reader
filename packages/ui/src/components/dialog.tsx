import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { cn } from "../lib/cn.js";

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	title: string;
	/** Unique ID for aria-labelledby. Defaults to "dialog-title". */
	titleId?: string;
	children: ReactNode;
	className?: string;
}

export function Dialog({
	open,
	onClose,
	title,
	titleId = "dialog-title",
	children,
	className,
}: DialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopImmediatePropagation();
				onClose();
			}
		},
		[onClose],
	);

	useEffect(() => {
		if (!open) return;
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [open, handleKeyDown]);

	useEffect(() => {
		if (!open) return;
		const dialog = dialogRef.current;
		if (!dialog) return;
		const focusable = dialog.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		);
		focusable[0]?.focus();
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center px-4"
			role="presentation"
			onClick={onClose}
		>
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className={cn(
					"relative z-10 w-full max-w-lg overflow-hidden",
					"rounded-md border border-line bg-surface shadow-xl",
					className,
				)}
				onClick={(e) => e.stopPropagation()}
			>
				<h2 id={titleId} className="sr-only">
					{title}
				</h2>
				{children}
			</div>
		</div>
	);
}
