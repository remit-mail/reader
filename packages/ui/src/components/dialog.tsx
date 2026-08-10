import { type ReactNode, useRef } from "react";
import { cn } from "../lib/cn.js";
import { useModalSurface } from "../lib/use-modal-surface.js";

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
	const overlayRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);

	useModalSurface({
		open,
		onClose,
		surfaceRef: dialogRef,
		boundaryRef: overlayRef,
	});

	if (!open) return null;

	const isLeft = anchor === "left";
	const isRight = anchor === "right";

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: outer overlay closes dialog on click; role=presentation lets inner role=dialog own the AT semantics
		<div
			ref={overlayRef}
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
			<div className="absolute inset-0 bg-canvas/80" />
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dialog-title"
				tabIndex={-1}
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
				onKeyDown={(e) => e.stopPropagation()}
			>
				<h2 id="dialog-title" className="sr-only">
					{title}
				</h2>
				{children}
			</div>
		</div>
	);
}
