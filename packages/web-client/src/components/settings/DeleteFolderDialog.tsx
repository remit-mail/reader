import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	Button,
	Dialog,
	type FolderTreeNode,
	FolderTreePicker,
} from "@remit/ui";
import { AlertTriangle, FolderInput, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useDeleteFolder } from "@/hooks/useDeleteFolder";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import { initialStage, moveProgressLabel } from "@/lib/delete-folder";
import { buildMailboxRoleMap, labelForMailbox } from "@/lib/folder-roles";
import { buildMoveOptions } from "@/lib/move-options";

interface DeleteFolderDialogProps {
	open: boolean;
	accountId: string;
	folder: RemitImapMailboxResponse;
	mailboxes: readonly RemitImapMailboxResponse[];
	appointments: readonly RemitImapFolderAppointment[];
	onClose: () => void;
}

type FateStage =
	| "confirm-empty"
	| "choose-fate"
	| "confirm-delete-all"
	| "pick-destination";

const emailCount = (count: number): string =>
	`${count} ${count === 1 ? "email" : "emails"}`;

/**
 * Per-folder delete wizard. An empty folder is a single destructive confirm,
 * settled against a fresh server read rather than the folder's last synced
 * count; a folder with mail first asks what happens to the messages — delete them with
 * the folder, or move them elsewhere (batched, with visible progress) before
 * the now-empty folder is removed. Closing mid-move keeps already-moved mail
 * moved; re-opening enumerates what's left and continues.
 */
export function DeleteFolderDialog({
	open,
	accountId,
	folder,
	mailboxes,
	appointments,
	onClose,
}: DeleteFolderDialogProps) {
	const [stage, setStage] = useState<FateStage>(() =>
		initialStage(folder.messageCount),
	);
	const [arrivedSinceSync, setArrivedSinceSync] = useState<number>();
	const [destinationId, setDestinationId] = useState<string>();
	const { createFolderIn } = useCreateMailbox(accountId);
	const translator = useFolderLabelTranslator();
	const {
		phase,
		progress,
		errorMessage,
		deleteMailbox,
		deleteIfEmpty,
		moveThenDelete,
		cancel,
		reset,
	} = useDeleteFolder({
		accountId,
		mailboxId: folder.mailboxId,
		onDeleted: onClose,
	});

	useEffect(() => {
		if (!open) return;
		setStage(initialStage(folder.messageCount));
		setArrivedSinceSync(undefined);
		reset();
	}, [open, folder.messageCount, reset]);

	useEffect(() => {
		if (!open) return;
		setDestinationId(undefined);
	}, [open]);

	useEffect(() => cancel, [cancel]);

	const handleClose = useCallback(() => {
		cancel();
		onClose();
	}, [cancel, onClose]);

	const handleDeleteEmpty = useCallback(async () => {
		const outcome = await deleteIfEmpty();
		if (!outcome.blocked) return;
		setArrivedSinceSync(outcome.messageCount);
		setStage("choose-fate");
	}, [deleteIfEmpty]);

	const destinations = useMemo<FolderTreeNode[]>(
		() =>
			buildMoveOptions({
				mailboxes,
				folderAppointments: appointments,
				excludeMailboxId: folder.mailboxId,
				translator,
			}),
		[mailboxes, appointments, folder.mailboxId, translator],
	);

	const destination = destinations.find(
		(option) => option.id === destinationId,
	);

	const name = useMemo(
		() =>
			labelForMailbox(
				folder,
				buildMailboxRoleMap(appointments).get(folder.mailboxId),
				translator,
			),
		[folder, appointments, translator],
	);

	if (!open) return null;

	const title = `Delete ${name}`;
	const messageCount = arrivedSinceSync ?? folder.messageCount;

	const body = (() => {
		if (phase === "moving") {
			return (
				<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
					<Loader2 className="size-8 animate-spin text-accent-2" />
					<p className="text-sm font-medium text-fg">Moving emails…</p>
					<p className="text-xs text-fg-muted" role="status" aria-live="polite">
						{progress ? moveProgressLabel(progress) : "Moved 0 of 0"}
					</p>
				</div>
			);
		}

		if (phase === "checking") {
			return (
				<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
					<Loader2 className="size-8 animate-spin text-accent-2" />
					<p className="text-sm font-medium text-fg">Checking the folder…</p>
				</div>
			);
		}

		if (phase === "deleting" || phase === "done") {
			return (
				<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
					<Loader2 className="size-8 animate-spin text-accent-2" />
					<p className="text-sm font-medium text-fg">Deleting folder…</p>
				</div>
			);
		}

		if (phase === "error") {
			return (
				<div className="space-y-4 px-5 py-4">
					<Banner tone="danger" variant="soft">
						{errorMessage ?? "Something went wrong. Please try again."}
					</Banner>
					{progress && (
						<p className="text-xs text-fg-muted">
							{moveProgressLabel(progress)}. Already-moved emails stay moved —
							re-open delete to continue with the rest.
						</p>
					)}
					<div className="flex justify-end">
						<Button variant="secondary" size="sm" onClick={handleClose}>
							Close
						</Button>
					</div>
				</div>
			);
		}

		if (stage === "confirm-empty") {
			return (
				<>
					<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
						<p>
							Delete <strong className="text-fg">{name}</strong>? This folder is
							empty and will be removed from the server.
						</p>
					</div>
					<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
						<Button variant="secondary" size="sm" onClick={handleClose}>
							Cancel
						</Button>
						<Button
							variant="danger"
							size="sm"
							icon={<Trash2 className="size-3.5" />}
							onClick={() => handleDeleteEmpty()}
						>
							Delete folder
						</Button>
					</footer>
				</>
			);
		}

		if (stage === "choose-fate") {
			return (
				<>
					<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
						{arrivedSinceSync !== undefined && (
							<Banner tone="warning" variant="soft">
								{`This folder is not empty: ${emailCount(arrivedSinceSync)} arrived since it was last synced. Nothing was deleted.`}
							</Banner>
						)}
						<p>
							<strong className="text-fg">{name}</strong> holds{" "}
							{emailCount(messageCount)}. What should happen to them?
						</p>
						<div className="space-y-2">
							<button
								type="button"
								onClick={() => setStage("confirm-delete-all")}
								className="flex w-full items-center gap-3 rounded-sm border border-line px-3 py-2.5 text-left hover:bg-surface-raised"
							>
								<Trash2 className="size-4 shrink-0 text-danger" />
								<span className="flex-1">
									<span className="block text-sm font-medium text-fg">
										Delete them with the folder
									</span>
									<span className="block text-xs text-fg-muted">
										The emails are removed from the server and can't be
										recovered.
									</span>
								</span>
							</button>
							<button
								type="button"
								onClick={() => setStage("pick-destination")}
								className="flex w-full items-center gap-3 rounded-sm border border-line px-3 py-2.5 text-left hover:bg-surface-raised"
							>
								<FolderInput className="size-4 shrink-0 text-accent-2" />
								<span className="flex-1">
									<span className="block text-sm font-medium text-fg">
										Move them to another folder
									</span>
									<span className="block text-xs text-fg-muted">
										Keep the emails, then delete the emptied folder.
									</span>
								</span>
							</button>
						</div>
					</div>
					<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
						<Button variant="secondary" size="sm" onClick={handleClose}>
							Cancel
						</Button>
					</footer>
				</>
			);
		}

		if (stage === "confirm-delete-all") {
			return (
				<>
					<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
						<p>
							Delete <strong className="text-fg">{name}</strong> and its{" "}
							{emailCount(messageCount)}? The messages are removed from the
							server with the folder and can't be recovered.
						</p>
					</div>
					<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setStage("choose-fate")}
						>
							Back
						</Button>
						<Button
							variant="danger"
							size="sm"
							icon={<Trash2 className="size-3.5" />}
							onClick={() => deleteMailbox()}
						>
							Delete folder and emails
						</Button>
					</footer>
				</>
			);
		}

		return (
			<div className="flex h-[26rem] flex-col">
				<p className="px-5 pt-4 text-sm text-fg-muted">
					Move the {emailCount(messageCount)} in{" "}
					<strong className="text-fg">{name}</strong> to:
				</p>
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<FolderTreePicker
						folders={destinations}
						selectedId={destinationId}
						delimiter={mailboxes[0]?.hierarchyDelimiter ?? "/"}
						onSelect={setDestinationId}
						onCreateFolder={createFolderIn}
						onCancel={() => {
							setDestinationId(undefined);
							setStage("choose-fate");
						}}
						labels={{ filterPlaceholder: "Move emails to…" }}
					/>
				</div>
				{/* Tapping a folder both picks it and opens it, so the move and the
				delete wait for this confirmation — otherwise the first tap on the way
				to a nested destination would empty the folder and remove it, with no
				undo. */}
				{destination && (
					<footer className="shrink-0 border-t border-line p-2">
						<Button
							variant="danger"
							onClick={() => moveThenDelete(destination.id)}
							className="h-11 w-full font-semibold"
						>
							<span className="truncate">
								{`Move ${emailCount(messageCount)} to ${destination.label}`}
							</span>
						</Button>
					</footer>
				)}
			</div>
		);
	})();

	return (
		<Dialog open={open} onClose={handleClose} title={title}>
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<AlertTriangle className="size-4 shrink-0 text-danger" />
				<span className="flex-1 text-sm font-semibold text-fg">{title}</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					onClick={handleClose}
					aria-label="Cancel"
				/>
			</header>
			{body}
		</Dialog>
	);
}
