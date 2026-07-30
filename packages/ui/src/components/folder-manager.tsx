import type { FolderTreeNode } from "../lib/folder-tree.js";
import { FolderManageActions } from "./folder-manage-actions.js";
import {
	FolderTreePicker,
	type FolderTreePickerLabels,
} from "./folder-tree-picker.js";

export interface ManagedFolder extends FolderTreeNode {
	/** Why this folder can't be deleted; absent means it can. */
	deleteBlockedReason?: string;
}

export interface FolderManagerLabels extends FolderTreePickerLabels {
	rename?: (label: string) => string;
	remove?: (label: string) => string;
}

export interface FolderManagerProps {
	folders: readonly ManagedFolder[];
	onRename: (folder: ManagedFolder) => void;
	onDelete: (folder: ManagedFolder) => void;
	/**
	 * Creating a folder is an IMAP mutation, so this resolves only once the mail
	 * server confirms it. Absent means no create affordance renders.
	 */
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
	/** The provider's hierarchy separator. */
	delimiter?: string;
	labels?: FolderManagerLabels;
}

/**
 * The folders as the account holds them, browsed the same way a destination is
 * picked — open a folder to see what is inside it, filter to narrow, make a new
 * one where you are looking — with rename and delete on each row. Nothing is
 * chosen here, so a row opens and closes and nothing else.
 */
export const FolderManager = ({
	folders,
	onRename,
	onDelete,
	onCreateFolder,
	delimiter,
	labels,
}: FolderManagerProps) => {
	const byId = new Map(folders.map((folder) => [folder.id, folder]));
	return (
		<FolderTreePicker
			folders={folders}
			onCreateFolder={onCreateFolder}
			delimiter={delimiter}
			labels={{
				treeAriaLabel: "Your folders",
				optionLabel: (label) => label,
				...labels,
			}}
			rowActions={(folder) => {
				const managed = byId.get(folder.id);
				if (!managed) return null;
				return (
					<FolderManageActions
						label={managed.label}
						deleteBlockedReason={managed.deleteBlockedReason}
						renameLabel={labels?.rename}
						deleteLabel={labels?.remove}
						onRename={() => onRename(managed)}
						onDelete={() => onDelete(managed)}
					/>
				);
			}}
		/>
	);
};
