import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { FolderInput } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Drawer } from "vaul";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { MoveToMailboxPicker } from "./MoveToMailboxPicker";

interface MoveToTriggerProps {
	accountId: string;
	currentMailboxId: string;
	onMove: (destinationMailboxId: string) => void;
	disabled?: boolean;
	/**
	 * When set, replaces the default `Move to folder` label with a hint and
	 * disables the trigger. Used by the bulk-action toolbar to surface the
	 * cross-account selection guard inline.
	 */
	disabledHint?: string;
	/**
	 * Render style for the trigger. `icon-only` renders a 44px icon button
	 * (mobile selection top bar / per-message overflow), `compact` renders
	 * a small label+icon button (desktop bulk toolbar).
	 */
	variant?: "icon-only" | "compact";
	/**
	 * Optional accessible label override for the trigger button.
	 */
	label?: string;
}

const TRIGGER_BASE =
	"inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const ICON_TRIGGER = cn(
	TRIGGER_BASE,
	"min-h-11 min-w-11 rounded hover:bg-accent",
);

const COMPACT_TRIGGER = cn(
	TRIGGER_BASE,
	"min-h-11 gap-1.5 px-3 rounded text-sm font-medium hover:bg-accent",
);

export const MoveToTrigger = ({
	accountId,
	currentMailboxId,
	onMove,
	disabled = false,
	disabledHint,
	variant = "icon-only",
	label,
}: MoveToTriggerProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const isDesktop = useIsDesktop();
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerLabel = label ?? "Move to folder";
	const popoverId = useId();

	const {
		data: mailboxesResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		// Same staleTime as the sidebar query — mailboxes change rarely and
		// invalidations are explicit, so we share the cache entry rather than
		// triggering a fresh fetch every time the picker opens.
		staleTime: Infinity,
		enabled: isOpen,
	});

	const mailboxes = mailboxesResponse?.items ?? [];

	const handleSelect = useCallback(
		(destinationMailboxId: string) => {
			setIsOpen(false);
			onMove(destinationMailboxId);
		},
		[onMove],
	);

	// Desktop popover: dismiss on outside click + Escape.
	useEffect(() => {
		if (!isOpen || !isDesktop) return;
		const handlePointer = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsOpen(false);
		};
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("keydown", handleKey);
		};
	}, [isOpen, isDesktop]);

	const isTriggerDisabled = disabled || !!disabledHint;

	const TriggerButton = (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				if (isTriggerDisabled) return;
				setIsOpen((prev) => !prev);
			}}
			disabled={isTriggerDisabled}
			aria-label={triggerLabel}
			// Mobile opens a vaul Drawer (modal dialog), desktop opens a
			// non-modal popover whose only content is the listbox of
			// destinations. Reflect each surface accurately so screen readers
			// announce the right structure.
			aria-haspopup={isDesktop ? "listbox" : "dialog"}
			aria-expanded={isOpen}
			aria-controls={isOpen ? popoverId : undefined}
			title={disabledHint}
			className={variant === "icon-only" ? ICON_TRIGGER : COMPACT_TRIGGER}
		>
			<FolderInput className="size-4" />
			{variant === "compact" && <span className="hidden sm:inline">Move</span>}
		</button>
	);

	const pickerBody = isLoading ? (
		<div className="px-3 py-6 text-sm text-muted-foreground">
			Loading folders…
		</div>
	) : isError ? (
		<div className="p-3">
			<ErrorState
				variant="inline"
				title="Couldn't load folders"
				error={error}
				onRetry={() => refetch()}
			/>
		</div>
	) : (
		<MoveToMailboxPicker
			mailboxes={mailboxes}
			currentMailboxId={currentMailboxId}
			onSelect={handleSelect}
			onCancel={() => setIsOpen(false)}
			autoFocus={!isDesktop}
		/>
	);

	if (!isDesktop) {
		return (
			<>
				{TriggerButton}
				<Drawer.Root open={isOpen} onOpenChange={setIsOpen}>
					<Drawer.Portal>
						<Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
						<Drawer.Content
							className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background rounded-t-2xl"
							style={{ maxHeight: "85dvh" }}
							id={popoverId}
						>
							<Drawer.Handle className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
							<Drawer.Title className="px-4 py-2 text-base font-semibold border-b border-border">
								Move to folder
							</Drawer.Title>
							<div className="flex-1 overflow-hidden">{pickerBody}</div>
						</Drawer.Content>
					</Drawer.Portal>
				</Drawer.Root>
			</>
		);
	}

	return (
		<div ref={containerRef} className="relative inline-block">
			{TriggerButton}
			{isOpen && (
				<div
					id={popoverId}
					className={cn(
						"absolute right-0 mt-1 z-50 w-72 max-h-96 flex flex-col",
						"bg-popover border border-border rounded-md shadow-lg",
					)}
				>
					{pickerBody}
				</div>
			)}
		</div>
	);
};
