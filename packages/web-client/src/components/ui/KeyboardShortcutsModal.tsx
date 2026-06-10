import { X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";

interface KeyboardShortcutsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

interface ShortcutSection {
	title: string;
	shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
	{
		title: "Navigation",
		shortcuts: [
			{ keys: ["j", "↓"], description: "Next item" },
			{ keys: ["k", "↑"], description: "Previous item" },
			{ keys: ["Enter", "o"], description: "Open / expand" },
			{ keys: ["u", "Esc"], description: "Go back / close" },
		],
	},
	{
		title: "Search",
		shortcuts: [
			{ keys: ["/"], description: "Focus search" },
			{ keys: ["Esc"], description: "Clear search" },
		],
	},
	{
		title: "Help",
		shortcuts: [{ keys: ["?"], description: "Show this help" }],
	},
];

const ShortcutKey = ({ children }: { children: React.ReactNode }) => (
	<kbd
		className={cn(
			"px-2 py-1 text-xs font-mono",
			"bg-surface-sunken border border-line rounded",
			"min-w-[24px] text-center inline-block",
		)}
	>
		{children}
	</kbd>
);

export const KeyboardShortcutsModal = ({
	isOpen,
	onClose,
}: KeyboardShortcutsModalProps) => {
	// Close on Escape
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		},
		[onClose],
	);

	useEffect(() => {
		if (!isOpen) return;
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, handleKeyDown]);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			onClick={onClose}
			onKeyDown={(e) => e.key === "Escape" && onClose()}
		>
			{/* Backdrop */}
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />

			{/* Modal */}
			<div
				className={cn(
					"relative z-10 w-full max-w-md",
					"bg-surface border border-line rounded-lg shadow-lg",
					"p-6",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
					<button
						type="button"
						onClick={onClose}
						className="p-1 text-fg-muted hover:text-fg transition-colors"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Sections */}
				<div className="space-y-6">
					{SHORTCUT_SECTIONS.map((section) => (
						<div key={section.title}>
							<h3 className="text-sm font-medium text-fg-muted mb-3">
								{section.title}
							</h3>
							<div className="space-y-2">
								{section.shortcuts.map((shortcut) => (
									<div
										key={shortcut.description}
										className="flex items-center justify-between"
									>
										<span className="text-sm">{shortcut.description}</span>
										<div className="flex items-center gap-1">
											{shortcut.keys.map((key, index) => (
												<span key={key} className="flex items-center gap-1">
													{index > 0 && (
														<span className="text-xs text-fg-muted">/</span>
													)}
													<ShortcutKey>{key}</ShortcutKey>
												</span>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				{/* Footer */}
				<div className="mt-6 pt-4 border-t border-line">
					<p className="text-xs text-fg-muted text-center">
						Press <ShortcutKey>Esc</ShortcutKey> to close
					</p>
				</div>
			</div>
		</div>
	);
};
