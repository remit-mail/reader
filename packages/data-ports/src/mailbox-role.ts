import { CanonicalMailboxRole } from "@remit/domain-enums";
import { ROLE_NAME_HINTS } from "./folder-role.js";

/**
 * The conventional names for a role, taken from the one table every
 * special-folder lookup shares (`folder-role.ts`). Exported so the SQLite junk
 * repair can spell the same rule; a second list here is how `INBOX/Sent` and
 * `INBOX/Spam` came to be resolvable in one place and not another.
 */
export const JUNK_FOLDER_NAMES: readonly string[] =
	ROLE_NAME_HINTS[CanonicalMailboxRole.Junk] ?? [];

export const TRASH_FOLDER_NAMES: readonly string[] =
	ROLE_NAME_HINTS[CanonicalMailboxRole.Trash] ?? [];
