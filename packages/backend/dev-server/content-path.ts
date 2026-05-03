import { relative, resolve, sep } from "node:path";

/**
 * Resolve a `/content/*` URL path to an absolute filesystem path under the
 * storage root, or return null if the resolved path would escape the root.
 *
 * The naive `fullPath.startsWith(STORAGE_BASE)` check fails on a sibling
 * directory whose name is a prefix of the base — e.g. `/x/storage` and
 * `/x/storage-evil` — so we use `path.relative` and reject any result that
 * starts with `..` or is itself absolute (#310 review P1). Empty keys are
 * also rejected so the root directory is never served.
 */
export const resolveContentPath = (
	storageBase: string,
	storageKey: string,
): string | null => {
	const fullPath = resolve(storageBase, storageKey);
	const rel = relative(storageBase, fullPath);
	if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
		return null;
	}
	if (resolve(rel) === rel) {
		// `rel` is absolute → escaped the root via an absolute storageKey.
		return null;
	}
	return fullPath;
};
