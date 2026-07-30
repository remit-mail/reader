import { Pencil, Trash2 } from "lucide-react";
import { Button } from "./button.js";

export interface FolderManageActionsProps {
	/** The folder as it reads on the row, so each control names its own target. */
	label: string;
	onRename: () => void;
	onDelete: () => void;
	/** Why this folder can't be deleted; absent means it can. */
	deleteBlockedReason?: string;
	renameLabel?: (label: string) => string;
	deleteLabel?: (label: string) => string;
}

/**
 * What a folder row offers beyond opening: rename it, or delete it. A folder
 * the account depends on states why it stays — as the control's own name, so
 * the reason is announced rather than only hovered.
 */
export const FolderManageActions = ({
	label,
	onRename,
	onDelete,
	deleteBlockedReason,
	renameLabel = (name) => `Rename ${name}`,
	deleteLabel = (name) => `Delete ${name}`,
}: FolderManageActionsProps) => {
	const deleteName = deleteBlockedReason
		? `${deleteLabel(label)} — ${deleteBlockedReason}`
		: deleteLabel(label);
	return (
		<span className="flex shrink-0 items-center gap-0.5 pr-2">
			<Button
				variant="ghost"
				size="sm"
				icon={<Pencil className="size-3.5" />}
				aria-label={renameLabel(label)}
				onClick={onRename}
			/>
			{/* The title sits on the wrapper: a disabled button takes no pointer
			    events, so a tooltip on it never shows. */}
			<span title={deleteBlockedReason}>
				<Button
					variant="ghost"
					size="sm"
					icon={<Trash2 className="size-3.5" />}
					aria-label={deleteName}
					disabled={deleteBlockedReason !== undefined}
					onClick={onDelete}
				/>
			</span>
		</span>
	);
};
