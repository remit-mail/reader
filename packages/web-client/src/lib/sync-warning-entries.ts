import type { RemitImapSyncWarningResponse } from "@remit/api-http-client/types.gen.ts";
import { syncWarningState } from "@remit/data-ports/sync-warning-state";
import {
	canonicalRoleLabel,
	folderLeaf,
	type ResultFolder,
	type SyncWarningEntry,
} from "@remit/ui";

export const UNLISTED_FOLDER_LABEL = "A folder no longer listed";

function folderLabel(folder: ResultFolder | undefined): string {
	if (folder?.role) return canonicalRoleLabel(folder.role);
	if (folder?.providerPath) {
		return folderLeaf(folder.providerPath, folder.hierarchyDelimiter);
	}
	return UNLISTED_FOLDER_LABEL;
}

export function toSyncWarningEntry(
	wire: RemitImapSyncWarningResponse,
	folder: ResultFolder | undefined,
): SyncWarningEntry {
	return {
		syncWarningId: wire.syncWarningId,
		uid: wire.uid,
		stage: wire.stage,
		state: syncWarningState(wire.stage, wire.attempts),
		attempts: wire.attempts,
		createdAt: wire.createdAt,
		folderLabel: folderLabel(folder),
	};
}
