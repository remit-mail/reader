import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	Button,
	Dialog,
	type MoveMailboxOption,
	MoveMailboxPicker,
} from "@remit/ui";
import { AlertTriangle, FolderInput, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useDeleteFolder } from "@/hooks/useDeleteFolder";
import {
	excludeFolder,
	initialStage,
	moveProgressLabel,
} from "@/lib/delete-folder";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";

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

const folderLabel = (folder: RemitImapMailboxResponse): string =>
	folder.displayNameOverride?.trim() || getMailboxDisplayName(folder.fullPath);

const emailCount = (count: number): string =>
	`${count} ${count === 1 ? "email" : "emails"}`;

/**
 * Per-folder delete wizard. An empty folder is a single destructive confirm; a
 * folder with mail first asks what happens to the messages — delete them with
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
	const { createFolder } = useCreateMailbox(accountId);
	const {
		phase,
		progress,
		errorMessage,
		deleteMailbox,
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
		reset();
	}, [open, folder.messageCount, reset]);

	useEffect(() => cancel, [cancel]);

	const handleClose = useCallback(() => {
		cancel();
		onClose();
	}, [cancel, onClose]);

	const destinations = useMemo<MoveMailboxOption[]>(
		() =>
			excludeFolder(
				buildMoveTargets(mailboxes, appointments),
				folder.mailboxId,
			).map((mailbox) => ({
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
				searchValue: mailbox.fullPath,
			})),
		[mailboxes, appointments, folder.mailboxId],
	);

	const handleCreateFolder = async (
		name: string,
		signal?: AbortSignal,
	): Promise<MoveMailboxOption> => {
		const created = await createFolder(name, signal);
		return { id: created.id, label: created.label };
	};

	if (!open) return null;

	const name = folderLabel(folder);
	const title = `Delete ${name}`;

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
							onClick={() => deleteMailbox()}
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
						<p>
							<strong className="text-fg">{name}</strong> holds{" "}
							{emailCount(folder.messageCount)}. What should happen to them?
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
							{emailCount(folder.messageCount)}? The messages are removed from
							the server with the folder and can't be recovered.
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
			<div className="flex h-80 flex-col">
				<p className="px-5 pt-4 text-sm text-fg-muted">
					Move the {emailCount(folder.messageCount)} in{" "}
					<strong className="text-fg">{name}</strong> to:
				</p>
				<div className="min-h-0 flex-1 px-2 py-2">
					<MoveMailboxPicker
						mailboxes={destinations}
						onSelect={(destinationMailboxId) =>
							moveThenDelete(destinationMailboxId)
						}
						onCreateFolder={handleCreateFolder}
						onCancel={() => setStage("choose-fate")}
						labels={{
							searchPlaceholder: "Move emails to…",
							optionLabel: (label) => `Move to ${label}`,
							createLabel: (query) => `Create "${query}"`,
						}}
					/>
				</div>
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
