import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";

export type FolderMutationPhase =
	| { kind: "waiting" }
	| { kind: "timed-out" }
	| { kind: "failed"; serverMessage: string }
	| { kind: "conflict" };

export interface FolderMutationDialogProps {
	open: boolean;
	intent: "rename" | "delete";
	folderName: string;
	targetName?: string;
	phase: FolderMutationPhase;
	onRetry: () => void;
	onRefresh: () => void;
	onClose: () => void;
}

function dialogTitle(
	intent: "rename" | "delete",
	phase: FolderMutationPhase,
): string {
	if (phase.kind === "conflict") return "Already in progress";
	if (intent === "rename") {
		if (phase.kind === "waiting") return "Renaming folder";
		if (phase.kind === "timed-out") return "Still renaming";
		return "Rename failed";
	}
	if (phase.kind === "waiting") return "Deleting folder";
	if (phase.kind === "timed-out") return "Still deleting";
	return "Delete failed";
}

function dialogBody(
	intent: "rename" | "delete",
	folderName: string,
	targetName: string | undefined,
	phase: FolderMutationPhase,
): string {
	if (phase.kind === "waiting") {
		return intent === "rename"
			? `Renaming “${folderName}” to “${targetName}” on the mail server…`
			: `Deleting “${folderName}” and everything in it from the mail server…`;
	}
	if (phase.kind === "timed-out") {
		return intent === "rename"
			? `“${folderName}” is still being renamed. It will finish on its own — you can close this and keep working. The folder shows “Renaming…” until it does.`
			: `“${folderName}” is still being deleted. It will finish on its own — you can close this. The folder shows “Deleting…” until it does.`;
	}
	if (phase.kind === "failed") {
		return intent === "rename"
			? `Couldn’t rename “${folderName}”. The mail server refused: ${phase.serverMessage}. The folder is unchanged.`
			: `Couldn’t delete “${folderName}”. The mail server refused: ${phase.serverMessage}. Nothing was deleted.`;
	}
	return intent === "rename"
		? `Something else is already renaming or deleting “${folderName}”. Refresh to see where it got to.`
		: `Something else is already deleting or renaming “${folderName}”. Refresh to see where it got to.`;
}

export function FolderMutationDialog({
	open,
	intent,
	folderName,
	targetName,
	phase,
	onRetry,
	onRefresh,
	onClose,
}: FolderMutationDialogProps) {
	if (!open) return null;

	const title = dialogTitle(intent, phase);
	const body = dialogBody(intent, folderName, targetName, phase);
	const icon =
		phase.kind === "waiting" ? (
			<Loader2 className="size-4 shrink-0 animate-spin text-accent-2" />
		) : phase.kind === "failed" || phase.kind === "conflict" ? (
			<AlertTriangle className="size-4 shrink-0 text-danger" />
		) : null;

	return (
		<Dialog open={open} onClose={onClose} title={title}>
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				{icon}
				<span className="flex-1 text-sm font-semibold text-fg">{title}</span>
			</header>
			<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
				<p>{body}</p>
			</div>
			<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				{phase.kind === "failed" && (
					<Button variant="secondary" size="sm" onClick={onRetry}>
						Try again
					</Button>
				)}
				{phase.kind === "conflict" ? (
					<Button variant="primary" size="sm" onClick={onRefresh}>
						Refresh
					</Button>
				) : (
					<Button variant="secondary" size="sm" onClick={onClose}>
						Close
					</Button>
				)}
			</footer>
		</Dialog>
	);
}
