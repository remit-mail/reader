import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface EventEditorPaneProps {
	/** What the pane is doing: "New event", "Edit event". */
	title: string;
	/** The one line of context the title cannot carry — which day, which series. */
	subtitle?: string;
	onClose: () => void;
	children: ReactNode;
	className?: string;
}

/**
 * Writing an event happens in the pane the event is read in, at the width that
 * pane has. A form floating over the grid has to stay small enough not to bury
 * it, which is how the fields got crushed; the pane is already where the reader
 * looks after clicking something, it grows with the window, and it can be
 * dragged wider when the form is the work.
 */
export function EventEditorPane({
	title,
	subtitle,
	onClose,
	children,
	className,
}: EventEditorPaneProps) {
	return (
		<section
			className={cn("flex h-full w-full flex-col bg-surface", className)}
		>
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
				<h2 className="shrink-0 text-xs font-medium text-fg">{title}</h2>
				{subtitle !== undefined && subtitle !== "" && (
					<span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
						{subtitle}
					</span>
				)}
				<button
					type="button"
					aria-label="Close editor"
					onClick={onClose}
					className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle outline-none hover:bg-surface-sunken hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X className="size-4" />
				</button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-row-inset py-5">
				<div className="mx-auto w-full max-w-2xl">{children}</div>
			</div>
		</section>
	);
}
