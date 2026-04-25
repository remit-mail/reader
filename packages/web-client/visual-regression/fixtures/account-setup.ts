import { test as base } from "@playwright/test";
import {
	base36uuidv5,
	MessageService,
	REMIT_NAMESPACE,
} from "@remit/remit-electrodb-service";

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
 * Visual-regression fixtures. Mailbox + message IDs are derived the
 * same way `smoke/global-setup.ts` derives them so a freshly-seeded
 * test DB produces predictable URLs the suite can navigate to.
 *
 * Override via env vars `REMIT_INBOX_ID` / `REMIT_SAMPLE_MESSAGE_ID`
 * if you need to point at a different backend.
 */

const E2E_EMAIL = "vmail@mailfuzz.local";
const E2E_ACCOUNT_CONFIG_ID = base36uuidv5(
	`e2e:config:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);
const DEFAULT_INBOX_ID = base36uuidv5(`e2e:mailbox:INBOX`, REMIT_NAMESPACE);
const SAMPLE_MESSAGE_ID_HEADER = "<e2e-msg-3@test.local>";
const DEFAULT_SAMPLE_MESSAGE_ID = MessageService.generateId(
	E2E_ACCOUNT_CONFIG_ID,
	SAMPLE_MESSAGE_ID_HEADER,
);

export const test = base.extend<VisualFixture>({
	accountId: "0jgzhrmpc55wveirawi66hoqp",
	backendUrl: BACKEND_URL,
	inboxId: process.env.REMIT_INBOX_ID ?? DEFAULT_INBOX_ID,
	sampleMessageId:
		process.env.REMIT_SAMPLE_MESSAGE_ID ?? DEFAULT_SAMPLE_MESSAGE_ID,
});

export { expect } from "@playwright/test";
