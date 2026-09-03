/**
 * Regression test for issue #1120.
 *
 * A sync triggered for an account that stores no credential used to fail the
 * batch item, so the poller left the message undeleted for its whole
 * visibility timeout. `remit-mailboxes.fifo` groups by accountId and a FIFO
 * queue never delivers past an in-flight message in a group, so the account
 * was fenced from every later sync — including the one the user asks for right
 * after saving the password.
 *
 * Runs against the real QueueStore and the real queue definition the stack
 * ships, with the poller's own contract modelled around it: ack deletes the
 * message, a batch item failure leaves it in flight.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSyncMailboxesCommand } from "@remit/backend/trigger-sync";
import type { AccountItem } from "@remit/data-ports";
import { ConnectionState } from "@remit/domain-enums";
import {
	bootstrapQueues,
	loadQueuesConfig,
	QueueStore,
} from "@remit/queue-sidecar";
import { DEFAULT_VISIBILITY_TIMEOUT_SECONDS } from "@remit/sqs-client/poller";
import {
	type OAuthLifecycleDeps,
	withOAuthLifecycle,
} from "./with-oauth-lifecycle.js";

const QUEUE_NAME = "remit-mailboxes.fifo";
const QUEUE_URL = `http://localhost:9324/000000000000/${QUEUE_NAME}`;
const ACCOUNT_ID = "acct_imported";
const T0 = 1_700_000_000_000;

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const tmpRoot = join(here, "..", ".tmp", "credential-less-sync-fence");

const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	trace: () => {},
	fatal: () => {},
	child: () => silentLogger,
} as never;

/** The account the import wizard lands: no password until its owner types one. */
const importedAccount = {
	accountId: ACCOUNT_ID,
	accountConfigId: "acfg_1",
	username: "alice@example.com",
	email: "alice@example.com",
	authType: "password",
	imapHost: "imap.example.com",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	isActive: true,
	connectionState: ConnectionState.CredentialsMissing,
	createdAt: T0,
	updatedAt: T0,
} as unknown as AccountItem;

const enqueueSync = (store: QueueStore, now: number): void => {
	const command = buildSyncMailboxesCommand({
		queueUrl: QUEUE_URL,
		accountId: ACCOUNT_ID,
	});
	store.sendMessage({
		queueName: QUEUE_NAME,
		body: command.input.MessageBody ?? "",
		groupId: command.input.MessageGroupId,
		deduplicationId: command.input.MessageDeduplicationId,
		now,
	});
};

describe("a credential-less sync trigger (issue #1120)", () => {
	after(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("is acked, leaving the account's queue group deliverable", async () => {
		mkdirSync(tmpRoot, { recursive: true });
		const store = new QueueStore(
			join(mkdtempSync(join(tmpRoot, "store-")), "queue.db"),
		);
		bootstrapQueues(
			store,
			loadQueuesConfig(join(repoRoot, "deploy/vps/queues.json")),
		);

		const stateUpdates: string[] = [];
		const deps: OAuthLifecycleDeps = {
			secrets: {
				decrypt: async () => "",
				encrypt: async () => ({}) as never,
			},
			tokenService: { getAccessToken: async () => ({}) as never },
			persistRotatedToken: async () => {},
			updateConnectionState: async (_accountId, state) => {
				stateUpdates.push(state);
			},
		};

		// The GET /config poll while the user is still typing the password.
		enqueueSync(store, T0);

		const [received] = store.receiveMessages({
			queueName: QUEUE_NAME,
			maxMessages: 1,
			visibilityTimeoutSeconds: DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
			now: T0,
		});
		assert.ok(received, "the trigger is on the queue");

		// The poller's contract: an ack deletes the message, a batch item failure
		// leaves it in flight until the visibility timeout expires.
		let batchItemFailure: unknown;
		await withOAuthLifecycle(deps, importedAccount, silentLogger, async () => {
			throw new Error("IMAP work must not run without a credential");
		}).then(
			() => store.deleteMessage(QUEUE_NAME, received.receiptHandle),
			(err: unknown) => {
				batchItemFailure = err;
			},
		);

		assert.equal(
			batchItemFailure,
			undefined,
			"the event is acked, not retried",
		);
		assert.deepEqual(stateUpdates, [ConnectionState.CredentialsMissing]);

		// The refresh the user presses after saving the password.
		enqueueSync(store, T0 + 2_000);
		const deliverable = store.receiveMessages({
			queueName: QUEUE_NAME,
			maxMessages: 10,
			now: T0 + 3_000,
		});

		assert.equal(
			deliverable.length,
			1,
			"the account's group must stay deliverable, not fenced for the visibility timeout",
		);
	});
});
