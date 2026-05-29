import type { AccountResponse } from "@remit/api-openapi-types";

const now = Date.UTC(2026, 4, 29, 9, 14) / 1000;

/** The signed-in account, typed against the generated AccountResponse. */
export const account: AccountResponse = {
	accountId: "acc_0f9c1a20-7b3e-4d11-9c2a-2e6f0a1b2c3d",
	accountConfigId: "cfg_3a1b9d44-5e2c-4f80-bb01-9d7e6f5a4c12",
	username: "alice@fastmail.example",
	email: "alice@fastmail.example",
	imapHost: "imap.fastmail.example",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	smtpHost: "smtp.fastmail.example",
	smtpPort: 587,
	smtpTls: false,
	smtpStartTls: true,
	smtpUsername: "alice@fastmail.example",
	isActive: true,
	connectionState: "selected",
	lastConnectedAt: now,
	lastSyncAt: now,
	createdAt: Date.UTC(2025, 0, 3) / 1000,
	updatedAt: now,
	signaturePlainText: "Alice Tan\nProduct, Northwind",
};
