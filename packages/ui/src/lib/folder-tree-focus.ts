import { type FolderTreeRow, folderParent } from "./folder-tree.js";

/** Every folder can hold a new one, so every row but a context row can open. */
export const isFocusable = (row: FolderTreeRow | undefined): boolean =>
	row !== undefined && !row.context;

export const isSelectable = (row: FolderTreeRow | undefined): boolean =>
	row !== undefined && !row.folder.isCurrent && !row.context;

export const findFirstFocusable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = 0; i < rows.length; i += 1) {
		if (isFocusable(rows[i])) return i;
	}
	return -1;
};

export const findLastFocusable = (rows: readonly FolderTreeRow[]): number => {
	for (let i = rows.length - 1; i >= 0; i -= 1) {
		if (isFocusable(rows[i])) return i;
	}
	return -1;
};

export const findNextFocusable = (
	rows: readonly FolderTreeRow[],
	from: number,
	step: 1 | -1,
): number => {
	const count = rows.length;
	if (count <= 0) return -1;
	const start = from < 0 ? (step === 1 ? -1 : count) : from;
	for (let offset = 1; offset <= count; offset += 1) {
		const candidate = (((start + step * offset) % count) + count) % count;
		if (isFocusable(rows[candidate])) return candidate;
	}
	return -1;
};

export const findParentRow = (
	rows: readonly FolderTreeRow[],
	from: number,
	delimiter: string,
): number => {
	const child = rows[from];
	if (!child) return -1;
	const parent = folderParent(child.folder.path, delimiter);
	if (!parent) return -1;
	for (let i = from - 1; i >= 0; i -= 1) {
		if (rows[i]?.folder.path === parent) return isFocusable(rows[i]) ? i : -1;
	}
	return -1;
};
