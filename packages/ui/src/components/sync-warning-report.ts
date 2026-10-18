export type SyncWarningStage = "Header" | "Body";

/**
 * Derived, never stored: body sync stops retrying at the attempt ceiling, and
 * a surfaced row has reached it, so a `Body` row has given up. A `Header` row
 * holds the cursor and is retried every round.
 */
export type SyncWarningState = "Retrying" | "GaveUp";

/**
 * A message that failed to sync and was not set aside.
 *
 * `folderLabel` is resolved on screen from the account's mailbox list and
 * never travels in the report: a folder name can be personal.
 */
export interface SyncWarningEntry {
	syncWarningId: string;
	uid: number;
	stage: SyncWarningStage;
	attempts: number;
	createdAt: number;
	folderLabel: string;
}

export function syncWarningState(stage: SyncWarningStage): SyncWarningState {
	return stage === "Body" ? "GaveUp" : "Retrying";
}

const summaries: Record<SyncWarningStage, string> = {
	Header: "The message could not be saved. Remit tries again every sync.",
	Body: "The message body could not be downloaded. Remit has stopped trying.",
};

export function syncWarningSummary(stage: SyncWarningStage): string {
	return summaries[stage];
}

export const SYNC_WARNING_REPORT_DISCLAIMER =
	"_No message content, addresses, subject, folder name or error text are included._";

export function formatSyncWarningReport(entry: SyncWarningEntry): string {
	return [
		`### Message failed to sync at \`${entry.stage}\``,
		"",
		`- **State**: \`${syncWarningState(entry.stage)}\``,
		`- **Attempts**: ${entry.attempts}`,
		"",
		SYNC_WARNING_REPORT_DISCLAIMER,
	].join("\n");
}

export function syncWarningIssueTitle(entry: SyncWarningEntry): string {
	return `Message failed to sync: ${syncWarningState(entry.stage)} at ${entry.stage}`;
}
