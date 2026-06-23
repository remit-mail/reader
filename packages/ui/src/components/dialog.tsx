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
	/**
	 * Anchor. `"center"` (default) is the centered modal card. `"left"`/`"right"`
	 * are full-height slide-over panels pinned to that edge — same backdrop,
	 * escape and click-away dismissal. `"left"` is the nav drawer at narrow
	 * widths; `"right"` is the mobile intelligence drawer (#854).
	 */
	anchor?: "center" | "left" | "right";
}

export function Dialog({
	open,
	onClose,
	title,
	titleId = "dialog-title",
	children,
	className,
	anchor = "center",
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

	const isLeft = anchor === "left";
	const isRight = anchor === "right";
	const isSlideOver = isLeft || isRight;

	return (
		<div
			className={cn(
				"fixed inset-0 z-50 flex",
				isLeft
					? "items-stretch justify-start"
					: isRight
						? "items-stretch justify-end"
						: "items-center justify-center px-4",
			)}
			role="presentation"
			onClick={onClose}
		>
			<div className={cn("absolute inset-0", !isSlideOver && "bg-canvas/80")} />
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className={cn(
					"relative z-10 overflow-hidden border-line bg-surface shadow-xl",
					isLeft
						? "h-full w-72 max-w-[85vw] border-r"
						: isRight
							? "h-full w-[80vw] max-w-[320px] border-l"
							: "w-full max-w-lg rounded-md border",
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
