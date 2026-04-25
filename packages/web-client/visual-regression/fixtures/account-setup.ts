import { test as base } from "@playwright/test";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5433";

interface VisualFixture {
	accountId: string;
	backendUrl: string;
	/** Stable inbox ID from the seeded test backend. */
	inboxId: string;
	/** Stable message ID from the seeded test backend. */
	sampleMessageId: string;
}

/**
 * Visual-regression fixtures. The IDs are placeholders — when bootstrapping
 * baselines on a new machine, set them to known-good values from the
 * seeded backend (or override via env vars `REMIT_INBOX_ID`,
 * `REMIT_SAMPLE_MESSAGE_ID`).
 */
export const test = base.extend<VisualFixture>({
	accountId: "0jgzhrmpc55wveirawi66hoqp",
	backendUrl: BACKEND_URL,
	inboxId: process.env.REMIT_INBOX_ID ?? "REPLACE_WITH_REAL_INBOX_ID",
	sampleMessageId:
		process.env.REMIT_SAMPLE_MESSAGE_ID ?? "REPLACE_WITH_REAL_MESSAGE_ID",
});

export { expect } from "@playwright/test";
