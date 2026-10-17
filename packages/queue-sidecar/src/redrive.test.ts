import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bootstrapQueues, loadQueuesConfig } from "./queues-config.js";
import { runRedriveCli } from "./redrive.js";
import { createSidecarServer } from "./server.js";
import { QueueStore } from "./store.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const tmpRoot = join(here, "..", ".tmp", "redrive");

describe("remit redrive, against the shipped queue definitions", () => {
	let store: QueueStore;
	let server: Server;
	let port: number;

	before(async () => {
		mkdirSync(tmpRoot, { recursive: true });
		store = new QueueStore(join(mkdtempSync(join(tmpRoot, "q-")), "q.db"));
		bootstrapQueues(
			store,
			loadQueuesConfig(join(here, "..", "..", "..", "deploy/vps/queues.json")),
		);
		server = createSidecarServer({ store });
		port = await new Promise((resolve) =>
			server.listen(0, "127.0.0.1", () =>
				resolve((server.address() as AddressInfo).port),
			),
		);
	});

	after(async () => {
		await new Promise((resolve) => server.close(resolve));
		store.close();
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	const cli = async (args: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await runRedriveCli(args, {
			env: { QUEUE_SIDECAR_PORT: String(port) },
			out: (text) => out.push(text),
			err: (text) => err.push(text),
		});
		return { code, out: out.join(""), err: err.join("") };
	};

	it("returns a body dead-letter queue to the body queue", async () => {
		store.sendMessage({ queueName: "remit-body-dlq", body: "batch-1" });
		store.sendMessage({ queueName: "remit-body-dlq", body: "batch-2" });

		const result = await cli(["remit-body-dlq"]);

		assert.equal(result.code, 0);
		assert.match(result.out, /Moved 2 message\(s\) from remit-body-dlq/);
		assert.deepEqual(
			store
				.receiveMessages({ queueName: "remit-body", maxMessages: 10 })
				.map((message) => message.body),
			["batch-1", "batch-2"],
		);
	});

	it("refuses the send dead-letter queue, leaving it where it is", async () => {
		store.sendMessage({ queueName: "remit-smtp-dlq", body: "send" });

		const result = await cli(["remit-smtp-dlq"]);

		assert.equal(result.code, 2);
		assert.match(result.err, /resend|deliver mail/);
		assert.equal(
			store.receiveMessages({ queueName: "remit-smtp", maxMessages: 10 })
				.length,
			0,
		);
	});

	it("points a sync dead-letter queue at a purge instead", async () => {
		const result = await cli(["remit-mailboxes-dlq.fifo"]);

		assert.equal(result.code, 2);
		assert.match(result.err, /Purge it instead/);
	});

	it("names the queues it redrives for any other name", async () => {
		const result = await cli(["remit-body"]);

		assert.equal(result.code, 2);
		assert.match(result.err, /it redrives remit-body-dlq/);
	});

	it("takes exactly one queue", async () => {
		assert.equal((await cli([])).code, 2);
		assert.equal(
			(await cli(["remit-body-dlq", "remit-flags-dlq.fifo"])).code,
			2,
		);
	});
});
