import { test as base } from "@playwright/test";
import {
	E2E_ACCOUNT_ID,
	INBOX_ID,
	SAMPLE_MESSAGE_ID,
} from "../../smoke/seed-constants";

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
 * Visual-regression fixtures. IDs are sourced from the smoke seeder
 * (`smoke/global-setup.ts`) so a freshly-seeded test DB produces
 * predictable URLs the suite can navigate to.
 *
 * Override via env vars `REMIT_INBOX_ID` / `REMIT_SAMPLE_MESSAGE_ID`
 * if you need to point at a different backend.
 */

export const test = base.extend<VisualFixture>({
	accountId: E2E_ACCOUNT_ID,
	backendUrl: BACKEND_URL,
	inboxId: process.env.REMIT_INBOX_ID ?? INBOX_ID,
	sampleMessageId: process.env.REMIT_SAMPLE_MESSAGE_ID ?? SAMPLE_MESSAGE_ID,
});

export { expect } from "@playwright/test";
