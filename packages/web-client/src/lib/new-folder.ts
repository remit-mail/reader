export interface FolderTarget {
	fullPath: string;
	hierarchyDelimiter: string;
}

/**
 * The full path of a new folder: the leaf name on its own for a root folder, or
 * the parent's path joined to the name by the parent's hierarchy delimiter.
 */
export function composeFolderPath(name: string, parent?: FolderTarget): string {
	const trimmed = name.trim();
	if (!parent) return trimmed;
	return `${parent.fullPath}${parent.hierarchyDelimiter}${trimmed}`;
}

/**
 * IMAP treats the INBOX root case-insensitively; every other path segment is
 * exact. Canonicalizing only a leading `inbox` segment lets the collision check
 * match `inbox/x` against `INBOX/x` without folding case anywhere else.
 */
const canonicalizePath = (path: string, delimiter: string): string => {
	const parts = delimiter.length === 0 ? [path] : path.split(delimiter);
	if (parts[0]?.toLowerCase() === "inbox") parts[0] = "INBOX";
	return parts.join(delimiter);
};

/**
 * Why the folder can't be created, or `undefined` when the name is valid. A
 * name must be non-empty, must not contain the hierarchy delimiter (nesting is
 * expressed by the parent select, not by typing a path), and must not collide
 * with an existing folder — INBOX compared case-insensitively, everything else
 * exactly. A server that reports no delimiter has a flat namespace, so there is
 * no separator to forbid and every name would otherwise contain it.
 */
export function validateNewFolderName({
	name,
	delimiter,
	parent,
	existingPaths,
}: {
	name: string;
	delimiter: string;
	parent?: FolderTarget;
	existingPaths: readonly string[];
}): string | undefined {
	const trimmed = name.trim();
	if (trimmed === "") return "Enter a folder name.";
	if (delimiter.length > 0 && trimmed.includes(delimiter))
		return `A folder name can't contain "${delimiter}".`;
	const candidate = canonicalizePath(
		composeFolderPath(trimmed, parent),
		delimiter,
	);
	const collides = existingPaths.some(
		(path) => canonicalizePath(path, delimiter) === candidate,
	);
	if (collides) return "A folder with that name already exists.";
	return undefined;
}
