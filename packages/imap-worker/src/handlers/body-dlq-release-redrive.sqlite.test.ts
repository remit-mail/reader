import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
	bootstrapQueues,
	loadQueuesConfig,
	QueueStore,
	redriveOnRelease,
} from "@remit/queue-sidecar";
import { mockClient } from "aws-sdk-client-mock";
import { resetBodySyncGateCache } from "../body-sync-gate.js";
import type { SyncMessageBodyEvent } from "../events.js";
import { openStore } from "../test-helpers/test-world.js";
import { syncMessageBody } from "./sync-message-body.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const queueRoot = join(here, "..", "..", ".tmp", "body-dlq-release-redrive");

const ssm = mockClient(SSMClient);

let store: Awaited<ReturnType<typeof openStore>>;
let queues: QueueStore;

before(async () => {
	store = await openStore();
});

after(() => {
	store.close();
	rmSync(queueRoot, { recursive: true, force: true });
});

beforeEach(() => {
	ssm.reset();
	resetBodySyncGateCache();
	ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "true" } });
	mkdirSync(queueRoot, { recursive: true });
	queues = new QueueStore(join(mkdtempSync(join(queueRoot, "q-")), "q.db"));
	bootstrapQueues(
		queues,
		loadQueuesConfig(
			join(here, "..", "..", "..", "..", "deploy/vps/queues.json"),
		),
	);
});

afterEach(() => {
	queues.close();
	resetBodySyncGateCache();
});

describe("a body batch dead-lettered by an earlier release", () => {
	it("is fetched and stored once the next release starts", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const message = await w.message(inbox);
		const event: SyncMessageBodyEvent = {
			type: "SYNC_MESSAGE_BODY",
			eventId: `evt-${message.messageId}`,
			timestamp: Date.now(),
			accountId: w.account.accountId,
			mailboxId: inbox.mailboxId,
			messageIds: [message.messageId],
			messages: [{ messageId: message.messageId, uid: message.uid }],
		};
		queues.sendMessage({
			queueName: "remit-body-dlq",
			body: JSON.stringify(event),
		});

		redriveOnRelease(queues, "v1.5.0");

		const [redelivered] = queues.receiveMessages({
			queueName: "remit-body",
			maxMessages: 10,
		});
		assert.ok(redelivered, "the batch is back on the body queue");
		await syncMessageBody(
			JSON.parse(redelivered.body) as SyncMessageBodyEvent,
			w.log,
			redelivered.receiveCount,
			w.scope,
		);

		assert.ok((await w.row(message.messageId))?.bodyStorageKey);
	});
});
