import { type ReactNode, useRef } from "react";
import { cn } from "../lib/cn.js";
import { useOverlayScope } from "../lib/overlay-scope.js";
import { useModalFocus } from "../lib/use-modal-focus.js";
import { DialogBackdrop } from "./dialog-backdrop.js";

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children?: ReactNode;
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
	children,
	className,
	anchor = "center",
}: DialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);

	useOverlayScope({ id: "dialog", open, answers: { back: onClose } });
	useModalFocus(dialogRef, open);

	if (!open) return null;

	const isLeft = anchor === "left";
	const isRight = anchor === "right";

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
		>
			<DialogBackdrop label="Dismiss dialog" onDismiss={onClose} />
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dialog-title"
				className={cn(
					"relative z-10 overflow-hidden border-line bg-surface shadow-xl",
					// The edge-anchored panels reach the device edges; the centered
					// card floats clear of them.
					isLeft
						? "safe-area-frame h-full w-72 max-w-[85vw] border-r"
						: isRight
							? "safe-area-frame h-full w-[80vw] max-w-[320px] border-l"
							: "w-full max-w-lg rounded-md border",
					className,
				)}
			>
				<h2 id="dialog-title" className="sr-only">
					{title}
				</h2>
				{children}
			</div>
		</div>
	);
}
