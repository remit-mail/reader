import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	ReceiveMessageCommand,
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import { AwsQueryProtocol } from "@aws-sdk/core/protocols";

const here = fileURLToPath(new URL(".", import.meta.url));
const tmpRoot = join(here, "..", ".tmp", "crash");
const mainEntry = join(here, "main.ts");

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const freePort = (): Promise<number> =>
	new Promise((resolve) => {
		const probe = createServer();
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});

const httpOk = (url: string): Promise<boolean> =>
	new Promise((resolve) => {
		const req = get(url, (res) => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on("error", () => resolve(false));
	});

const waitForHealth = async (port: number): Promise<void> => {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await httpOk(`http://127.0.0.1:${port}/health`)) return;
		await delay(200);
	}
	throw new Error("sidecar child did not become healthy in time");
};

const spawnSidecar = async (
	port: number,
	dbPath: string,
	configPath: string,
): Promise<ChildProcess> => {
	const child = spawn(process.execPath, ["--import", "tsx", mainEntry], {
		env: {
			...process.env,
			QUEUE_SIDECAR_HOST: "127.0.0.1",
			QUEUE_SIDECAR_PORT: String(port),
			QUEUE_SIDECAR_DB: dbPath,
			QUEUE_SIDECAR_QUEUES_CONFIG: configPath,
		},
		stdio: "ignore",
	});
	await waitForHealth(port);
	return child;
};

const waitForExit = (child: ChildProcess): Promise<void> =>
	new Promise((resolve) => child.on("exit", () => resolve()));

describe("crash recovery (SIGKILL, no graceful close)", () => {
	after(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("recovers a committed send after the process is killed uncleanly", async () => {
		mkdirSync(tmpRoot, { recursive: true });
		const dbPath = join(tmpRoot, "queue.db");
		const configPath = join(tmpRoot, "queues.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				queues: [{ name: "outbox", visibilityTimeoutSeconds: 30 }],
			}),
		);

		const port = await freePort();
		const client = new SQSClient({
			endpoint: `http://127.0.0.1:${port}`,
			protocol: AwsQueryProtocol,
			region: "local",
			credentials: { accessKeyId: "local", secretAccessKey: "local" },
			maxAttempts: 1,
		});
		const queueUrl = `http://127.0.0.1:${port}/000000000000/outbox`;

		const first = await spawnSidecar(port, dbPath, configPath);
		// The send resolves only after the sidecar has committed it — under
		// synchronous=FULL that commit is fsync'd to the WAL before the response.
		await client.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: "unsent-mail",
			}),
		);

		// Kill -9: no SIGTERM handler runs, no graceful close, no WAL
		// checkpoint. This is the host-crash / power-loss case, not a clean
		// restart — the recovery path the outbox durability requirement is about.
		first.kill("SIGKILL");
		await waitForExit(first);

		const second = await spawnSidecar(port, dbPath, configPath);
		const received = await client.send(
			new ReceiveMessageCommand({
				QueueUrl: queueUrl,
				MaxNumberOfMessages: 10,
				WaitTimeSeconds: 2,
			}),
		);
		second.kill("SIGKILL");
		await waitForExit(second);

		assert.equal(received.Messages?.length, 1);
		assert.equal(received.Messages?.[0].Body, "unsent-mail");
	});
});
