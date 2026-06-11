import { Kbd } from "@remit/ui";
import { X } from "lucide-react";
import { Fragment, useCallback, useEffect } from "react";
import { KEY_HINT_GROUPS } from "@/lib/keymap";
import { cn } from "@/lib/utils";

interface KeyboardShortcutsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

/**
 * The `?` help overlay (#429). Renders the full triage key map from the single
 * source of truth (`@/lib/keymap`) using the remit-ui `Kbd` component, so the
 * displayed bindings can never drift from what the dispatcher actually routes.
 */
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
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
		>
			{/* Backdrop */}
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />

			{/* Modal */}
			<div
				className={cn(
					"relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto",
					"rounded-lg border border-line bg-surface shadow-lg",
					"p-6",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
					<button
						type="button"
						onClick={onClose}
						className="p-1 text-fg-muted transition-colors hover:text-fg"
						aria-label="Close"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Sections — two columns on wider modals */}
				<div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
					{KEY_HINT_GROUPS.map((group) => (
						<div key={group.title}>
							<h3 className="mb-3 text-sm font-medium text-fg-muted">
								{group.title}
							</h3>
							<div className="space-y-2">
								{group.hints.map((hint) => (
									<div
										key={`${hint.action}-${hint.keys.join("+")}`}
										className="flex items-center justify-between gap-4"
									>
										<span className="text-sm">{hint.description}</span>
										<span className="flex shrink-0 items-center gap-1">
											{hint.keys.map((key, index) => (
												<Fragment key={key}>
													{index > 0 && hint.keys[0] === "g" && (
														<span className="text-2xs text-fg-subtle">
															then
														</span>
													)}
													<Kbd>{key}</Kbd>
												</Fragment>
											))}
										</span>
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				{/* Footer */}
				<div className="mt-6 border-t border-line pt-4">
					<p className="text-center text-xs text-fg-muted">
						Press <Kbd>Esc</Kbd> to close
					</p>
				</div>
			</div>
		</div>
	);
};
