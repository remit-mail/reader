import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SlidePanelProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	footer?: ReactNode;
}

export const SlidePanel = ({
	isOpen,
	onClose,
	title,
	children,
	footer,
}: SlidePanelProps) => (
	<>
		{/* Backdrop overlay */}
		<div
			className={cn(
				"fixed inset-0 bg-black/30 z-40 transition-opacity",
				isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
			)}
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
			role="button"
			tabIndex={0}
			aria-label="Close panel"
		/>

		{/* Slide-in panel */}
		<div
			className={cn(
				"fixed top-0 right-0 h-full w-[400px] bg-background border-l border-border shadow-xl z-50",
				"transform transition-transform duration-200 ease-out",
				isOpen ? "translate-x-0" : "translate-x-full",
			)}
			role="dialog"
			aria-modal="true"
			aria-labelledby="slide-panel-title"
		>
			{/* Panel header */}
			<div className="flex items-center justify-between px-4 h-14 border-b border-border">
				<h2 id="slide-panel-title" className="font-semibold">
					{title}
				</h2>
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-md hover:bg-accent transition-colors"
					aria-label="Close"
				>
					<X className="size-5" />
				</button>
			</div>

			{/* Panel content */}
			<div className="h-[calc(100%-3.5rem)] flex flex-col">
				<div className="flex-1 overflow-auto p-4">{children}</div>
				{footer && (
					<div className="flex justify-end gap-3 p-4 border-t border-border bg-background">
						{footer}
					</div>
				)}
			</div>
		</div>
	</>
);
