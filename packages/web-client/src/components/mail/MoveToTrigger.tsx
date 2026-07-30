import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { Button, FolderTreePicker } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { FolderInput } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Drawer } from "vaul";
import { ErrorState } from "@/components/ui/ErrorState";
import { useFolderAppointments } from "@/hooks/useArchiveMailbox";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
	buildMoveOptions,
	folderDelimiter,
	type MoveDestination,
} from "@/lib/move-options";
import { cn } from "@/lib/utils";

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
	"inline-flex items-center justify-center transition-colors";

const ICON_TRIGGER = cn(
	TRIGGER_BASE,
	"min-h-11 min-w-11 rounded hover:bg-surface-raised",
);

const COMPACT_TRIGGER = cn(
	TRIGGER_BASE,
	"min-h-11 gap-1.5 px-3 rounded text-sm font-medium hover:bg-surface-raised",
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
	const [pickedId, setPickedId] = useState<string>();
	const isDesktop = useIsDesktop();
	const containerRef = useRef<HTMLDivElement>(null);
	const triggerLabel = label ?? "Move to folder";
	const popoverId = useId();
	const { t } = useTranslation("mail", { useSuspense: false });
	const translator = useFolderLabelTranslator();

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
	const folderAppointments = useFolderAppointments(accountId);
	const { createFolderIn } = useCreateMailbox(accountId);

	const options = useMemo<MoveDestination[]>(
		() =>
			buildMoveOptions({
				mailboxes: mailboxesResponse?.items ?? [],
				folderAppointments,
				currentMailboxId,
				translator,
			}),
		[
			mailboxesResponse?.items,
			folderAppointments,
			currentMailboxId,
			translator,
		],
	);
	const delimiter = folderDelimiter(mailboxesResponse?.items ?? []);

	const picked = options.find((option) => option.id === pickedId);

	const close = useCallback(() => {
		setIsOpen(false);
		setPickedId(undefined);
	}, []);

	// Tapping a folder both picks it and opens it, so the move waits for a
	// confirmation — otherwise the first tap would fire before the user could
	// reach anything nested inside it.
	const handleMove = useCallback(() => {
		if (!picked) return;
		close();
		onMove(picked.id);
	}, [picked, close, onMove]);

	// Desktop popover: dismiss on outside click + Escape.
	useEffect(() => {
		if (!isOpen || !isDesktop) return;
		const handlePointer = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				close();
			}
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("mousedown", handlePointer);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handlePointer);
			document.removeEventListener("keydown", handleKey);
		};
	}, [isOpen, isDesktop, close]);

	const isTriggerDisabled = disabled || !!disabledHint;

	const TriggerButton = (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				if (isTriggerDisabled) return;
				setIsOpen((prev) => !prev);
			}}
			aria-label={triggerLabel}
			// Mobile opens a vaul Drawer (modal dialog), desktop opens a
			// non-modal popover whose only content is the folder tree. Reflect
			// each surface accurately so screen readers announce the right
			// structure.
			aria-haspopup={isDesktop ? "tree" : "dialog"}
			aria-expanded={isOpen}
			aria-controls={isOpen ? popoverId : undefined}
			title={disabledHint}
			className={variant === "icon-only" ? ICON_TRIGGER : COMPACT_TRIGGER}
		>
			<FolderInput className={variant === "icon-only" ? "size-5" : "size-4"} />
			{variant === "compact" && <span className="hidden sm:inline">Move</span>}
		</button>
	);

	const pickerBody = isLoading ? (
		<div className="px-3 py-5 text-sm text-fg-muted">Loading folders…</div>
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
		<FolderTreePicker
			folders={options}
			selectedId={pickedId}
			delimiter={delimiter}
			onSelect={setPickedId}
			onCreateFolder={createFolderIn}
			onCancel={close}
			labels={{
				filterPlaceholder: t("move_picker_filter_placeholder", {
					defaultValue: "Filter folders…",
				}),
				filterAriaLabel: t("move_picker_filter_label", {
					defaultValue: "Filter folders",
				}),
			}}
		/>
	);

	const confirmBar = picked && (
		<div className="shrink-0 border-t border-line p-2">
			<Button
				variant="primary"
				onClick={handleMove}
				className="h-11 w-full font-semibold"
			>
				{`Move to ${picked.label}`}
			</Button>
		</div>
	);

	if (!isDesktop) {
		return (
			<>
				{TriggerButton}
				<Drawer.Root
					open={isOpen}
					onOpenChange={(next) => (next ? setIsOpen(true) : close())}
				>
					<Drawer.Portal>
						<Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
						<Drawer.Content
							className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-canvas rounded-t-lg"
							style={{ maxHeight: "85dvh" }}
							id={popoverId}
						>
							<Drawer.Handle className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-fg-subtle/30" />
							<Drawer.Title className="px-4 py-2 text-base font-semibold border-b border-line">
								Move to folder
							</Drawer.Title>
							<div className="flex min-h-0 flex-1 overflow-hidden">
								{pickerBody}
							</div>
							{confirmBar}
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
						"bg-surface border border-line rounded-md shadow-lg",
					)}
				>
					{pickerBody}
					{confirmBar}
				</div>
			)}
		</div>
	);
};
