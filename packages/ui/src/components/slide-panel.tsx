import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { useOverlayScope } from "../lib/overlay-scope.js";

/* ------------------------------------------------------------------ */
/* SlidePanel: right-edge slide-over for a focused sub-task (editing   */
/* an account) without leaving the screen behind it. Full width on     */
/* phones, a fixed-width column from `sm` up.                          */
/*                                                                     */
/* A closed panel stays mounted so it can animate, so it must be inert */
/* in every sense that is not visual: no pointer events, out of the    */
/* tab order, hidden from assistive technology.                        */
/* ------------------------------------------------------------------ */

export interface SlidePanelProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}

export function SlidePanel({
	isOpen,
	onClose,
	title,
	children,
	footer,
}: SlidePanelProps) {
	// Escape closes the panel from anywhere inside it, which is what a dialog
	// owes the keyboard, and nothing behind it sees the press. The scrim is a
	// pointer affordance only.
	useOverlayScope({
		id: "slide-panel",
		open: isOpen,
		handlers: { back: onClose },
	});

	return (
		<>
			{/* Click-to-dismiss scrim: a pointer shortcut for the header's Close
			    button, never the only way out, so it stays out of the tab order and
			    the a11y tree rather than posing as a control. */}
			<div
				className={cn(
					"fixed inset-0 z-40 bg-black/30 transition-opacity",
					isOpen ? "opacity-100" : "pointer-events-none opacity-0",
				)}
				onClick={onClose}
				aria-hidden="true"
			/>

			<div
				className={cn(
					"safe-area-frame fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l border-line bg-canvas shadow-xl sm:w-[400px] sm:max-w-[90vw]",
					"transform transition-transform duration-200 ease-out",
					isOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
				)}
				role="dialog"
				aria-modal="true"
				aria-hidden={!isOpen}
				inert={!isOpen}
				aria-labelledby="slide-panel-title"
			>
				<div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
					<h2 id="slide-panel-title" className="font-semibold">
						{title}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 transition-colors hover:bg-surface-raised"
						aria-label="Close"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* The body takes what the header leaves, from the layout rather than
				    from arithmetic over the header's height: a computed height puts
				    the box on a fractional pixel and drifts the moment the header
				    does. */}
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="flex-1 overflow-auto p-4">{children}</div>
					{footer && (
						<div className="flex justify-end gap-3 border-t border-line bg-canvas p-4">
							{footer}
						</div>
					)}
				</div>
			</div>
		</>
	);
}
