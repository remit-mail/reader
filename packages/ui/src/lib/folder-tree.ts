export interface FolderTreeNode {
	/** Stable identity passed back to the surface that owns the choice. */
	id: string;
	/**
	 * What the row reads as. An appointed folder is labelled by its role, so
	 * `Deleted Messages` shows as "Trash" while still nesting under its real
	 * path — which is why the label is not derived from the path.
	 */
	label: string;
	/** The provider path. Nesting, indentation and filtering all read this. */
	path: string;
	/**
	 * Where the messages live now. A "you are here" marker: never a target, and
	 * rendered as a marker rather than a disabled control.
	 */
	isCurrent?: boolean;
	/**
	 * How much mail the folder holds. A folder named `Trash` may be an empty
	 * look-alike beside the real one, and the count is the only thing that tells
	 * them apart. Absent means the surface has no count, not zero.
	 */
	messageCount?: number;
}

export interface FolderTreeRow {
	folder: FolderTreeNode;
	depth: number;
	/**
	 * On screen only to keep a match below it in place. It reads as the branch
	 * it is, not as an answer to what was typed.
	 */
	context: boolean;
	/** Its children and its create action are on screen. */
	expanded: boolean;
}

export type FolderTreeDisplayRow =
	| { kind: "folder"; row: FolderTreeRow; index: number }
	| { kind: "create"; parent: FolderTreeNode; depth: number };

// A server that reports no delimiter has a flat namespace: the path is its own
// leaf and every folder is a root. Splitting on "" would return single
// characters, and `"Inbox".lastIndexOf("")` is 5 rather than -1, so each of
// these answers the flat case before it touches the path.
export const folderPathSegments = (
	path: string,
	delimiter: string,
): string[] => (delimiter.length === 0 ? [path] : path.split(delimiter));

export const folderLeaf = (path: string, delimiter: string): string => {
	const parts = folderPathSegments(path, delimiter);
	return parts[parts.length - 1] || path;
};

export const folderParent = (path: string, delimiter: string): string => {
	if (delimiter.length === 0) return "";
	const cut = path.lastIndexOf(delimiter);
	return cut === -1 ? "" : path.slice(0, cut);
};

export const folderDepth = (path: string, delimiter: string): number =>
	folderPathSegments(path, delimiter).length - 1;

// Every step up is strictly shorter than the path below it, so the walk is
// bounded by the length of the path whatever a parent comes back as.
export const folderAncestors = (path: string, delimiter: string): string[] => {
	const out: string[] = [];
	let child = path;
	let parent = folderParent(child, delimiter);
	while (parent && parent.length < child.length) {
		out.push(parent);
		child = parent;
		parent = folderParent(child, delimiter);
	}
	return out;
};

/**
 * Puts every child straight after its parent so the list reads as a tree, while
 * leaving the order of unrelated folders alone. A folder whose parent is absent
 * from the list renders as a root rather than disappearing.
 */
export const orderFolderNodes = (
	folders: readonly FolderTreeNode[],
	delimiter: string,
): FolderTreeNode[] => {
	const present = new Set(folders.map((folder) => folder.path));
	const emitted = new Set<string>();
	const out: FolderTreeNode[] = [];

	const emit = (folder: FolderTreeNode) => {
		if (emitted.has(folder.path)) return;
		emitted.add(folder.path);
		out.push(folder);
		for (const candidate of folders) {
			if (folderParent(candidate.path, delimiter) === folder.path) {
				emit(candidate);
			}
		}
	};

	for (const folder of folders) {
		const parent = folderParent(folder.path, delimiter);
		if (parent && present.has(parent)) continue;
		emit(folder);
	}
	return out;
};

export const matchesQuery = (folder: FolderTreeNode, query: string): boolean =>
	folder.label.toLowerCase().includes(query) ||
	folder.path.toLowerCase().includes(query);

/**
 * The ancestors a query has to open for its matches to be on screen. Held apart
 * from what the user opened by hand, so clearing the filter puts the list back
 * the way they left it.
 */
export const queryExpandedPaths = (
	folders: readonly FolderTreeNode[],
	query: string,
	delimiter: string,
): Set<string> => {
	const out = new Set<string>();
	if (!query) return out;
	for (const folder of folders) {
		if (!matchesQuery(folder, query)) continue;
		for (const ancestor of folderAncestors(folder.path, delimiter)) {
			out.add(ancestor);
		}
	}
	return out;
};

/**
 * The rows a filtered tree shows: every match, plus the ancestors holding it on
 * screen. Depth still comes from the path, so a match stays indented under the
 * branch it belongs to.
 */
export const filterFolderTree = (
	ordered: readonly FolderTreeNode[],
	query: string,
	delimiter: string,
	expanded: ReadonlySet<string> = new Set(),
): FolderTreeRow[] => {
	const row = (folder: FolderTreeNode, context: boolean): FolderTreeRow => ({
		folder,
		depth: folderDepth(folder.path, delimiter),
		context,
		expanded: expanded.has(folder.path),
	});
	if (!query) return ordered.map((folder) => row(folder, false));

	const matched = new Set<string>();
	for (const folder of ordered) {
		if (matchesQuery(folder, query)) matched.add(folder.path);
	}
	const visible = new Set(matched);
	for (const path of matched) {
		for (const ancestor of folderAncestors(path, delimiter)) {
			visible.add(ancestor);
		}
	}
	return ordered
		.filter((folder) => visible.has(folder.path))
		.map((folder) => row(folder, !matched.has(folder.path)));
};

/**
 * The unfiltered list: roots always, and a child only while every ancestor it
 * has on screen is open. A folder whose parent is absent from the list is a
 * root, so it never hides behind something that was never there.
 */
export const collapseFolderTree = (
	ordered: readonly FolderTreeNode[],
	expanded: ReadonlySet<string>,
	delimiter: string,
): FolderTreeRow[] => {
	const present = new Set(ordered.map((folder) => folder.path));
	return ordered
		.filter((folder) =>
			folderAncestors(folder.path, delimiter).every(
				(ancestor) => !present.has(ancestor) || expanded.has(ancestor),
			),
		)
		.map((folder) => ({
			folder,
			depth: folderDepth(folder.path, delimiter),
			context: false,
			expanded: expanded.has(folder.path),
		}));
};

/**
 * Drops a create action at the end of every open folder's children, so "New
 * folder" reads as the last folder inside the one you opened. A flat namespace
 * has no inside, so it gets the rows on their own and creates at the top level.
 */
export const withCreateRows = (
	rows: readonly FolderTreeRow[],
	delimiter: string,
): FolderTreeDisplayRow[] => {
	if (delimiter.length === 0)
		return rows.map((row, index) => ({ kind: "folder", row, index }));

	const out: FolderTreeDisplayRow[] = [];
	const open: FolderTreeRow[] = [];

	const closeDownTo = (path: string | null) => {
		while (open.length > 0) {
			const last = open[open.length - 1];
			if (!last) break;
			if (path?.startsWith(`${last.folder.path}${delimiter}`)) break;
			open.pop();
			out.push({
				kind: "create",
				parent: last.folder,
				depth: last.depth + 1,
			});
		}
	};

	rows.forEach((row, index) => {
		closeDownTo(row.folder.path);
		out.push({ kind: "folder", row, index });
		if (row.expanded) open.push(row);
	});
	closeDownTo(null);
	return out;
};
