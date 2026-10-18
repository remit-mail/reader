import type { SyncWarningEntry } from "./sync-warning-report.js";

export const syncWarningDemoEntries: readonly SyncWarningEntry[] = [
	{
		syncWarningId: "w-1",
		uid: 51_002,
		stage: "Body",
		state: "GaveUp",
		attempts: 3,
		createdAt: Date.parse("2026-10-17T08:12:00Z"),
		folderLabel: "Inbox",
	},
	{
		syncWarningId: "w-2",
		uid: 50_874,
		stage: "Header",
		state: "Retrying",
		attempts: 7,
		createdAt: Date.parse("2026-10-16T21:40:00Z"),
		folderLabel: "Receipts",
	},
];
