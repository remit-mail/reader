import { folderLeaf } from "../lib/folder-tree.js";
import { Badge } from "./badge.js";

export type FolderSyncState =
	| { kind: "healthy" }
	| { kind: "creating" }
	| { kind: "renaming"; target: string }
	| { kind: "deleting" }
	| { kind: "rename-failed"; target: string }
	| { kind: "delete-failed" };

export interface FolderSyncMailbox {
	syncStatus: string;
	pendingPath?: string;
	hierarchyDelimiter: string;
}

export function folderSyncState(mailbox: FolderSyncMailbox): FolderSyncState {
	if (mailbox.syncStatus === "pending") {
		return mailbox.pendingPath
			? {
					kind: "renaming",
					target: folderLeaf(mailbox.pendingPath, mailbox.hierarchyDelimiter),
				}
			: { kind: "creating" };
	}
	if (mailbox.syncStatus === "deleting") return { kind: "deleting" };
	if (mailbox.syncStatus === "failed") {
		return mailbox.pendingPath
			? {
					kind: "rename-failed",
					target: folderLeaf(mailbox.pendingPath, mailbox.hierarchyDelimiter),
				}
			: { kind: "delete-failed" };
	}
	return { kind: "healthy" };
}

export function folderSyncAriaLabel(
	folderName: string,
	state: FolderSyncState,
): string {
	switch (state.kind) {
		case "healthy":
			return folderName;
		case "creating":
			return `${folderName} — creating`;
		case "renaming":
			return `${folderName} — renaming to ${state.target}`;
		case "deleting":
			return `${folderName} — deleting`;
		case "rename-failed":
			return `${folderName} — rename failed`;
		case "delete-failed":
			return `${folderName} — delete failed`;
	}
}

export function isFolderSyncNavigable(state: FolderSyncState): boolean {
	return (
		state.kind === "healthy" ||
		state.kind === "renaming" ||
		state.kind === "rename-failed" ||
		state.kind === "delete-failed"
	);
}

export interface FolderSyncBadgeProps {
	state: FolderSyncState;
}

export function FolderSyncBadge({ state }: FolderSyncBadgeProps) {
	switch (state.kind) {
		case "healthy":
			return null;
		case "creating":
			return <Badge tone="neutral">Creating…</Badge>;
		case "renaming":
			return <Badge tone="neutral">{`Renaming to “${state.target}”…`}</Badge>;
		case "deleting":
			return <Badge tone="neutral">Deleting…</Badge>;
		case "rename-failed":
			return <Badge tone="danger">Rename failed</Badge>;
		case "delete-failed":
			return <Badge tone="danger">Delete failed</Badge>;
	}
}
