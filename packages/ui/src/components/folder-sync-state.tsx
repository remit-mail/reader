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
}

function targetLeaf(pendingPath: string): string {
	const segments = pendingPath.split("/");
	return segments[segments.length - 1] || pendingPath;
}

export function folderSyncState(mailbox: FolderSyncMailbox): FolderSyncState {
	if (mailbox.syncStatus === "pending") {
		return mailbox.pendingPath
			? { kind: "renaming", target: targetLeaf(mailbox.pendingPath) }
			: { kind: "creating" };
	}
	if (mailbox.syncStatus === "deleting") return { kind: "deleting" };
	if (mailbox.syncStatus === "failed") {
		return mailbox.pendingPath
			? { kind: "rename-failed", target: targetLeaf(mailbox.pendingPath) }
			: { kind: "delete-failed" };
	}
	return { kind: "healthy" };
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
