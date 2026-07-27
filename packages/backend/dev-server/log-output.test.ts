import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// This file is the backend image's entrypoint, so its stdout IS the container's
// log stream. deploy/vps/README.md ("Logs") promises one JSON object per line
// on it, and a log-shipping pipeline written against that contract breaks on
// the first line it cannot parse — which is why this runs the real server
// rather than asserting against a mocked writer.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const freePort = (): Promise<number> =>
	new Promise((resolveWith, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				probe.close();
				reject(new Error("could not reserve a port"));
				return;
			}
			probe.close(() => resolveWith(address.port));
		});
	});

type Line = Record<string, unknown>;

let stdout = "";
let port = 0;

// The child's stdout reaches this process asynchronously, so a request that has
// already been answered is not yet a line here. Wait for the line rather than
// for a duration, and only once stdout ends on a newline, so no assertion ever
// runs against half of one.
const waitForStdout = (contains: string): Promise<void> =>
	new Promise((resolveWith, reject) => {
		const settled = () => stdout.includes(contains) && stdout.endsWith("\n");
		if (settled()) {
			resolveWith();
			return;
		}
		const timer = setTimeout(() => {
			stopWaiting();
			reject(new Error(`stdout never carried ${contains}: ${stdout}`));
		}, 10_000);
		const onData = () => {
			if (!settled()) return;
			stopWaiting();
			resolveWith();
		};
		const stopWaiting = () => {
			clearTimeout(timer);
			listeners.delete(onData);
		};
		listeners.add(onData);
	});

const listeners = new Set<() => void>();

const parsedLines = (): Line[] =>
	stdout
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line, index) => {
			try {
				return JSON.parse(line) as Line;
			} catch {
				throw new assert.AssertionError({
					message: `stdout line ${index + 1} is not JSON, so a log pipeline drops it: ${line}`,
				});
			}
		});

describe("the backend entrypoint's stdout", () => {
	let server: ReturnType<typeof spawn>;

	before(async () => {
		port = await freePort();

		server = spawn(
			process.execPath,
			["--import", "tsx", "dev-server/server.ts"],
			{
				cwd: packageRoot,
				stdio: ["ignore", "pipe", "pipe", "ipc"],
				env: {
					...process.env,
					SERVER_PORT: String(port),
					LOG_LEVEL: "debug",
					REMIT_SERVICE_NAME: "backend",
					NODE_OPTIONS: "",
				},
			},
		);

		server.stdout?.setEncoding("utf8");
		server.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
			for (const listener of [...listeners]) listener();
		});

		await new Promise<void>((resolveWith, reject) => {
			server.on("message", (message) => {
				if (message === "ready") resolveWith();
			});
			server.on("exit", (code) =>
				reject(new Error(`server exited before listening (code ${code})`)),
			);
		});

		// A request the router answers without touching a data backend, so the
		// invocation's own lines — the ones withTelemetry writes around the
		// handler — are on stdout by the time this suite reads it.
		await fetch(`http://127.0.0.1:${port}/no-such-route`);
		await waitForStdout("Request received");
	});

	after(() => {
		server.kill("SIGKILL");
	});

	it("is JSON on every line", () => {
		const lines = parsedLines();
		assert.ok(lines.length > 0, "expected the server to have written a line");
		for (const line of lines) {
			assert.equal(typeof line.level, "string");
			assert.equal(typeof line.time, "string");
			assert.equal(line.service, "backend");
			assert.equal(typeof line.msg, "string");
		}
	});

	it("reports what it is listening on as fields, not a banner", () => {
		const listening = parsedLines().find(
			(line) => line.msg === "Backend listening",
		);
		assert.ok(listening, "expected a startup line");
		assert.equal(listening.port, port);
		assert.equal(listening.level, "info");
	});

	it("correlates the whole invocation under one requestId", () => {
		const lines = parsedLines().filter(
			(line) => line.msg === "Lambda invocation started" || line.path,
		);
		assert.ok(lines.length >= 2, "expected the invocation to have logged");
		const requestIds = new Set(lines.map((line) => line.requestId));
		assert.equal(requestIds.size, 1);
		assert.equal([...requestIds][0] === undefined, false);
	});
});
