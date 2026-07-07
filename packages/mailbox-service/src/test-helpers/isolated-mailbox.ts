import { randomUUID } from "node:crypto";
import type { ImapFlowConnection } from "../imapflow-connection.js";

/**
 * Per-file mailbox isolation for the mailfuzz e2e suite (#508).
 *
 * The e2e files share one Dovecot account. INBOX is the seeded corpus and is
 * treated as read-only: any test that APPENDs or mutates flags does so in its
 * own uniquely-named mailbox instead, so two files can run in parallel without
 * contending on the same message set. This is what lets `test:e2e` drop
 * `--test-concurrency=1`.
 */

export const uniqueMailboxName = (prefix: string): string =>
	`${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;

const seedMessage = (index: number): string =>
	[
		"From: seed@example.com",
		"To: vmail@localhost",
		`Subject: Isolated seed message ${index}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <seed-${index}-${randomUUID()}@test.example.com>`,
		"",
		`Isolated seed body ${index}`,
	].join("\r\n");

/**
 * Create `mailbox` and APPEND `count` deterministic messages into it. Returns
 * the appended UIDs in insertion order.
 */
export const seedMailbox = async (
	connection: ImapFlowConnection,
	mailbox: string,
	count: number,
): Promise<number[]> => {
	await connection.createMailbox(mailbox);
	const uids: number[] = [];
	for (let index = 0; index < count; index++) {
		const { uid } = await connection.append(mailbox, seedMessage(index));
		uids.push(uid);
	}
	return uids;
};
