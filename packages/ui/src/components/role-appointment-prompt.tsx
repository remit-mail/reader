import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FolderTreeNode } from "../lib/folder-tree.js";
import { Banner } from "./banner.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import {
	FolderTreePicker,
	type FolderTreePickerProps,
} from "./folder-tree-picker.js";

/* ------------------------------------------------------------------ */
/* The appointment ceremony at a refused action (#887, #847). The       */
/* refusal and its repair are one surface: the confirm both appoints    */
/* the folder and completes the action that was stopped.                */
/* ------------------------------------------------------------------ */

/** Why the action was refused. Never re-derived from live state while open. */
export type PromptReason = "none" | "stale" | "unconfirmed";

/** What the confirm completes. Decides the verb and the count in every label. */
export type PromptAction =
	| { kind: "delete"; count: number }
	| { kind: "emptyTrash" };

export type PromptPhase =
	| { kind: "choosing" }
	| { kind: "appointing" }
	| { kind: "acting" }
	| { kind: "appoint-failed"; cause: "generic" | "mailbox-pending" };

export interface RoleAppointmentPromptCopy {
	title: string;
	description: string;
	pickerPrompt: string;
	confirmLabel: string;
	cancelLabel: string;
}

export interface RoleAppointmentPromptCopyContext {
	/** `unconfirmed`: the folder reader guessed from its name. */
	trashFolderLabel?: string;
	/** `stale`: the folder that vanished from the mail server. */
	staleFolderLabel?: string;
	/** The chosen folder's message count, so the confirm re-words with it. */
	selectedCount?: number;
}

const plural = (count: number): string =>
	count === 1 ? "message" : "messages";

const quantified = (count: number): string =>
	`${count.toLocaleString()} ${plural(count)}`;

/**
 * What the confirm completes. Empty Trash names a count only where the user is
 * confirming a guess — that is the framing whose confirm expunges, and the
 * count moves with the row they picked.
 */
const actionSuffix = (
	action: PromptAction,
	selectedCount: number | undefined,
): string => {
	if (action.kind === "delete") return `delete ${quantified(action.count)}`;
	if (selectedCount === undefined) return "empty it";
	return `empty ${quantified(selectedCount)}`;
};

/** "Nothing changed", in the tense of the verb that was refused. */
const nothingHappened = (action: PromptAction): string =>
	action.kind === "delete"
		? "Nothing has been deleted."
		: "Nothing has been emptied.";

/**
 * Every word the prompt says, as a pure function of the refusal — mirroring
 * `deleteConfirmationCopy`, so the stories render what the app renders and each
 * branch is testable without a DOM.
 */
export const roleAppointmentPromptCopy = (
	reason: PromptReason,
	action: PromptAction,
	context: RoleAppointmentPromptCopyContext = {},
): RoleAppointmentPromptCopy => {
	const { trashFolderLabel, staleFolderLabel, selectedCount } = context;
	const stopped = nothingHappened(action);

	if (reason === "none") {
		return {
			title: "No folder is set as Trash",
			description: `${stopped} reader files deleted mail in the folder you set as Trash, and this account has none.`,
			pickerPrompt: "Which folder does this account use for deleted mail?",
			confirmLabel: `Set as Trash and ${actionSuffix(action, undefined)}`,
			cancelLabel: "Cancel",
		};
	}

	if (reason === "stale") {
		return {
			title: "The Trash folder you chose is gone",
			description: staleFolderLabel
				? `${stopped} You set ${staleFolderLabel} as this account's Trash and it is no longer on the mail server — another mail app may have renamed or removed it.`
				: `${stopped} The folder you set as this account's Trash is no longer on the mail server — another mail app may have renamed or removed it.`,
			pickerPrompt: "Which folder should reader use instead?",
			confirmLabel: `Set as Trash and ${actionSuffix(action, undefined)}`,
			cancelLabel: "Cancel",
		};
	}

	const irreversible =
		"Emptying a folder erases everything in it from the mail server, and that cannot be restored.";
	return {
		title: "Confirm this account's Trash folder",
		description: trashFolderLabel
			? `${stopped} reader files this account's deleted mail in ${trashFolderLabel} because of its name — you never chose it, and the mail server doesn't mark it as Trash. ${irreversible}`
			: `${stopped} reader files this account's deleted mail in a folder it matched by name — you never chose it, and the mail server doesn't mark it as Trash. ${irreversible}`,
		pickerPrompt: trashFolderLabel
			? `Confirm ${trashFolderLabel}, or pick the folder this account really uses.`
			: "Pick the folder this account really uses for deleted mail.",
		confirmLabel: `Set as Trash and ${actionSuffix(action, selectedCount)}`,
		cancelLabel: "Cancel",
	};
};

interface PendingCopy {
	headline: string;
	status: string;
}

const pendingCopy = (
	phase: PromptPhase,
	action: PromptAction,
	folderLabel: string,
): PendingCopy => {
	if (phase.kind === "appointing") {
		return { headline: "Setting the Trash folder…", status: folderLabel };
	}
	if (action.kind === "delete") {
		return {
			headline: `Deleting ${action.count} ${plural(action.count)}…`,
			status: `Moving them to ${folderLabel}`,
		};
	}
	return {
		headline: `Emptying ${folderLabel}…`,
		status: "This can't be undone.",
	};
};

const failureCopy = (
	cause: "generic" | "mailbox-pending",
	action: PromptAction,
	folderLabel: string,
): string =>
	cause === "mailbox-pending"
		? `${folderLabel} is still being created on the mail server. Wait for it to finish, then try again.`
		: `Couldn't set that folder as Trash. ${nothingHappened(action)} Please try again.`;

export interface RoleAppointmentPromptProps {
	open: boolean;
	reason: PromptReason;
	action: PromptAction;
	/** The account's real folders, with counts — a real Trash is told from an empty look-alike by its count. */
	folders: readonly FolderTreeNode[];
	delimiter: string;
	/** `unconfirmed`: the folder reader guessed from its name. */
	trashFolderLabel?: string;
	/** `stale`: the folder that vanished from the mail server. */
	staleFolderLabel?: string;
	/** Only on instances holding more than one account. */
	accountEmail?: string;
	phase: PromptPhase;
	selectedId?: string;
	onSelect: (mailboxId: string) => void;
	/** Wired for `none` only: a repair must not make a second empty Trash. */
	onCreateFolder?: FolderTreePickerProps["onCreateFolder"];
	onConfirm: (mailboxId: string) => void;
	onCancel: () => void;
}

/**
 * The refused action's own dialog: it says what stopped and that nothing
 * changed, offers the account's real folders with their counts, and completes
 * the original action from the same confirm that appoints the folder.
 *
 * Controlled — the app owns both writes. The confirm mounts only once a folder
 * is chosen, so a confirm is never on screen disabled; Cancel is always there,
 * so there is always a way out that changes nothing.
 */
export const RoleAppointmentPrompt = ({
	open,
	reason,
	action,
	folders,
	delimiter,
	trashFolderLabel,
	staleFolderLabel,
	accountEmail,
	phase,
	selectedId,
	onSelect,
	onCreateFolder,
	onConfirm,
	onCancel,
}: RoleAppointmentPromptProps) => {
	const pendingRef = useRef<HTMLDivElement>(null);
	const pending = phase.kind === "appointing" || phase.kind === "acting";

	// Escape must not unmount a dialog whose write has already left. Dialog
	// yields Escape to `[data-escape-owner]`, which only holds while the focus
	// is inside it — so the pending body takes the focus the footer gave up.
	useEffect(() => {
		if (!pending) return;
		pendingRef.current?.focus();
	}, [pending]);

	const selected = folders.find((folder) => folder.id === selectedId);
	const copy = roleAppointmentPromptCopy(reason, action, {
		trashFolderLabel,
		staleFolderLabel,
		selectedCount: selected?.messageCount,
	});
	const expunges = action.kind === "emptyTrash";

	if (!open) return null;

	if (pending) {
		const words = pendingCopy(phase, action, selected?.label ?? "");
		return (
			<Dialog open={open} onClose={() => {}} title={copy.title}>
				<div
					ref={pendingRef}
					data-escape-owner
					tabIndex={-1}
					className="flex flex-col items-center gap-3 px-5 py-10 text-center outline-none"
				>
					<Loader2 className="size-8 animate-spin text-accent-2" />
					<p className="text-sm font-medium text-fg">{words.headline}</p>
					<p className="text-xs text-fg-muted" role="status" aria-live="polite">
						{words.status}
					</p>
				</div>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onClose={onCancel} title={copy.title}>
			{/* No header dismiss: the footer's Cancel is the way out, which leaves
			    the picker's filter field as the dialog's first focusable — initial
			    focus belongs there, never on a confirm that erases mail. */}
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<AlertTriangle
					className={`size-4 shrink-0 ${expunges ? "text-danger" : "text-warning"}`}
				/>
				<span className="flex-1 text-sm font-semibold text-fg">
					{copy.title}
				</span>
			</header>
			<div className="flex max-h-[70vh] flex-col">
				<div className="space-y-1 px-5 py-4">
					<p className="text-sm text-fg-muted">{copy.description}</p>
					{accountEmail && (
						<p className="text-xs text-fg-subtle">{accountEmail}</p>
					)}
				</div>
				{phase.kind === "appoint-failed" && (
					<div className="px-5 pb-3">
						<Banner tone="danger" variant="soft">
							{failureCopy(
								phase.cause,
								action,
								selected?.label ?? "That folder",
							)}
						</Banner>
					</div>
				)}
				<p className="px-5 pb-2 text-sm text-fg-muted">{copy.pickerPrompt}</p>
				<div className="flex h-[26rem] min-h-0 flex-1 overflow-hidden">
					<FolderTreePicker
						folders={folders}
						selectedId={selectedId}
						delimiter={delimiter}
						onSelect={onSelect}
						onCreateFolder={reason === "none" ? onCreateFolder : undefined}
						onCancel={onCancel}
						labels={{
							treeAriaLabel: "Folders on this account",
							optionLabel: (folder) =>
								`Set ${folder.label}${
									folder.messageCount === undefined
										? ""
										: `, ${folder.messageCount} messages`
								}, as Trash`,
						}}
					/>
				</div>
			</div>
			<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				<Button variant="secondary" size="sm" onClick={onCancel}>
					{copy.cancelLabel}
				</Button>
				{selected && (
					<Button
						variant={expunges ? "danger" : "primary"}
						size="sm"
						onClick={() => onConfirm(selected.id)}
					>
						<span className="truncate">{copy.confirmLabel}</span>
					</Button>
				)}
			</footer>
		</Dialog>
	);
};
