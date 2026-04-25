import {
	base36uuidv5,
	MessageService,
	REMIT_NAMESPACE,
} from "@remit/remit-electrodb-service";

/**
 * Seeded test-data constants. Imported by both the seeder
 * (`smoke/global-setup.ts`) and the Playwright fixtures so the test
 * suite navigates to the same IDs the seeder writes.
 *
 * Pure module — no side effects on import.
 */

export const E2E_EMAIL = "vmail@mailfuzz.local";
export const E2E_IMAP_PASSWORD = "testpass123";

export const E2E_USER_ID = base36uuidv5(`e2e:${E2E_EMAIL}`, REMIT_NAMESPACE);
export const E2E_ACCOUNT_CONFIG_ID = base36uuidv5(
	`e2e:config:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);
export const E2E_ACCOUNT_ID = base36uuidv5(
	`e2e:account:${E2E_EMAIL}`,
	REMIT_NAMESPACE,
);

export const INBOX_ID = base36uuidv5("e2e:mailbox:INBOX", REMIT_NAMESPACE);
export const SENT_ID = base36uuidv5("e2e:mailbox:Sent", REMIT_NAMESPACE);
export const TRASH_ID = base36uuidv5("e2e:mailbox:Trash", REMIT_NAMESPACE);

export const SAMPLE_MESSAGE_ID_HEADER = "<e2e-msg-3@test.local>";
export const SAMPLE_MESSAGE_ID = MessageService.generateId(
	E2E_ACCOUNT_CONFIG_ID,
	SAMPLE_MESSAGE_ID_HEADER,
);
