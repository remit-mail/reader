import type { SyncWarningStage, SyncWarningState } from "@remit/domain-enums";

export interface SyncWarningEntry {
	syncWarningId: string;
	uid: number;
	stage: (typeof SyncWarningStage)[keyof typeof SyncWarningStage];
	state: (typeof SyncWarningState)[keyof typeof SyncWarningState];
	attempts: number;
	createdAt: number;
	folderLabel: string;
}

const summaries: Record<SyncWarningEntry["state"], string> = {
	Retrying: "The message could not be synced. Remit tries again every sync.",
	GaveUp: "The message body could not be downloaded. Remit has stopped trying.",
};

export function syncWarningSummary(entry: SyncWarningEntry): string {
	return summaries[entry.state];
}

const SYNC_WARNING_REPORT_DISCLAIMER =
	"_No message content, addresses, subject, folder name or error text are included._";

export function formatSyncWarningReport(entry: SyncWarningEntry): string {
	return [
		`### Message failed to sync at \`${entry.stage}\``,
		"",
		`- **State**: \`${entry.state}\``,
		`- **Attempts**: ${entry.attempts}`,
		"",
		SYNC_WARNING_REPORT_DISCLAIMER,
	].join("\n");
}

export function syncWarningIssueTitle(entry: SyncWarningEntry): string {
	return `Message failed to sync: ${entry.state} at ${entry.stage}`;
}
