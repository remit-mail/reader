import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { ConfirmDialog, useOverlayScope } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Drawer } from "vaul";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	useAdoptComposeDraft,
	useCloseCompose,
	useComposeDraftId,
} from "@/routing";
import { ComposeForm } from "./ComposeForm";
import { composeSurfaceTitle } from "./compose-title";

/**
 * Returns true when the draft has meaningful content (subject or body
 * typed by the user). Used to gate drag-to-dismiss with a confirmation.
 */
const useIsDraftDirty = (): (() => boolean) => {
	const dirtyRef = useRef(false);

	// We peek at the DOM: if subject has text or the editor has non-empty
	// text content, the draft is dirty. This avoids threading form state
	// back up — ComposeForm owns the source of truth.
	const check = useCallback((): boolean => {
		const subject =
			document.querySelector<HTMLInputElement>("[data-subject-field]")?.value ??
			"";
		const editorEl = document.querySelector('[data-testid="compose-body"]');
		const bodyText = editorEl?.textContent ?? "";
		// Strip signature separator "-- " to avoid false positives
		const cleaned = bodyText.replace(/--\s*/g, "").trim();
		dirtyRef.current = subject.trim().length > 0 || cleaned.length > 0;
		return dirtyRef.current;
	}, []);

	return check;
};

export const MobileComposeSheet = () => {
	const outboxMessageId = useComposeDraftId();
	const adoptCreatedDraft = useAdoptComposeDraft();
	const closeCompose = useCloseCompose();
	const isDraftDirty = useIsDraftDirty();
	const [showConfirm, setShowConfirm] = useState(false);

	const {
		isError: isConfigError,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (open) return;
			// User is trying to dismiss
			if (isDraftDirty()) {
				setShowConfirm(true);
			} else {
				closeCompose();
			}
		},
		[closeCompose, isDraftDirty],
	);

	const handleConfirmDiscard = useCallback(() => {
		setShowConfirm(false);
		closeCompose();
	}, [closeCompose]);

	const handleCancelDiscard = useCallback(() => {
		setShowConfirm(false);
	}, []);

	// vaul answers Escape itself; declaring the scope is what keeps the rest of
	// the keyboard off the list behind the sheet.
	useOverlayScope({ id: "mobile-compose", open: true });

	return (
		<Drawer.Root
			open
			onOpenChange={handleOpenChange}
			// Don't auto-dismiss on drag when dirty — we intercept via onOpenChange
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
				<Drawer.Content
					className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-lg bg-canvas pb-[env(safe-area-inset-bottom,0px)]"
					style={{ height: "95dvh" }}
				>
					<Drawer.Handle className="mx-auto mt-2 mb-1 h-1.5 w-12 rounded-full bg-fg-muted/30" />

					<Drawer.Title className="px-4 py-2 text-base font-semibold border-b border-line">
						{composeSurfaceTitle(outboxMessageId)}
					</Drawer.Title>

					{isConfigError ? (
						<div className="flex-1 flex items-center justify-center p-4">
							<ErrorState
								title="Couldn't load compose"
								error={configError}
								onRetry={() => {
									refetchConfig();
								}}
							/>
						</div>
					) : (
						<div className="flex-1 overflow-hidden">
							<ComposeForm
								mode="new"
								outboxMessageId={outboxMessageId}
								onDraftCreated={adoptCreatedDraft}
								onClose={closeCompose}
							/>
						</div>
					)}
				</Drawer.Content>
			</Drawer.Portal>

			<ConfirmDialog
				isOpen={showConfirm}
				title="Discard draft?"
				description="Your message has unsaved content. Are you sure you want to discard it?"
				confirmLabel="Discard"
				cancelLabel="Keep editing"
				destructive
				onConfirm={handleConfirmDiscard}
				onCancel={handleCancelDiscard}
			/>
		</Drawer.Root>
	);
};
