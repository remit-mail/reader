import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Auth } from "./auth.js";
import { CLIENT_IP_HEADER, createAuth } from "./auth.js";

/**
 * #441: better-auth answers a rate-limited request from inside its own router,
 * so the stack log stayed completely silent while an instance was throttled.
 * This drives the real handler until it really answers 429 and reads the line
 * off the real logger — a stub handler would prove nothing about the seam the
 * server actually mounts.
 */

process.env.LOG_LEVEL = "info";
process.env.REMIT_SERVICE_NAME = "auth-service-test";

const originalWrite = process.stdout.write.bind(process.stdout);
const written: string[] = [];
let capturing = false;

// pino writes to `process.stdout` only when its `write` has been replaced, and
// to the raw fd otherwise, so the hook must be installed before the module
// under test imports the logger. Writes pass through while nothing is
// capturing, so the test runner's own output still reaches the terminal.
process.stdout.write = ((
	chunk: string | Uint8Array,
	...rest: unknown[]
): boolean => {
	if (capturing && typeof chunk === "string") {
		written.push(chunk);
		return true;
	}
	return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

const { withRateLimitLogging } = await import("./rate-limit-log.js");

const SIGN_IN_MAX = 2;
const MIGRATIONS = resolve(
	import.meta.dirname,
	"../../../deploy/vps/migrations-sqlite/auth",
);

type Line = Record<string, unknown>;

// better-auth writes its own advisories through console, so the captured
// stream is not all pino JSON; only the structured lines are of interest here.
const asJsonObject = (line: string): Line | null => {
	try {
		const parsed: unknown = JSON.parse(line);
		return parsed !== null && typeof parsed === "object"
			? (parsed as Line)
			: null;
	} catch {
		return null;
	}
};

const captured = (): Line[] =>
	written
		.join("")
		.split("\n")
		.map(asJsonObject)
		.filter((line): line is Line => line !== null);

const capture = async (emit: () => Promise<void>): Promise<Line[]> => {
	written.length = 0;
	capturing = true;
	try {
		await emit();
	} finally {
		capturing = false;
	}
	return captured();
};

const createDatabase = async (dir: string, name: string): Promise<string> => {
	const path = join(dir, `${name}.db`);
	const { default: Database } = await import("better-sqlite3");
	const { drizzle } = await import("drizzle-orm/better-sqlite3");
	const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
	const sqlite = new Database(path);
	migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
	sqlite.close();
	return path;
};

const signIn = (
	handler: (request: Request) => Promise<Response>,
	headers: Record<string, string>,
) =>
	handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify({
				email: "nobody@example.com",
				password: "a-sufficiently-long-password",
			}),
		}),
	);

describe("a rate-limited auth response is logged", () => {
	const previousMax = process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX;
	let dir: string;

	before(() => {
		process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX = String(SIGN_IN_MAX);
		dir = mkdtempSync(join(tmpdir(), "remit-rate-limit-log-"));
	});

	after(() => {
		if (previousMax === undefined) {
			delete process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX;
		} else {
			process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX = previousMax;
		}
		rmSync(dir, { recursive: true, force: true });
	});

	const build = async (name: string): Promise<Auth> =>
		createAuth({
			connectionString: await createDatabase(dir, name),
			secret: "rate-limit-log-test-secret-value-32chars",
			baseURL: "http://localhost:3000",
			selfSignUpEnabled: true,
		});

	it("names the endpoint and the address the limit is keyed on", async () => {
		const handler = withRateLimitLogging(await build("logged"));
		const client = { [CLIENT_IP_HEADER]: "203.0.113.50" };

		let refused: Response | undefined;
		const lines = await capture(async () => {
			for (let attempt = 0; attempt <= SIGN_IN_MAX; attempt++) {
				const response = await signIn(handler, client);
				if (response.status === 429) {
					refused = response;
					break;
				}
			}
		});

		assert.equal(refused?.status, 429, "expected the budget to run out");

		const line = lines.find(
			(entry) => entry.msg === "Auth request rate limited",
		);
		assert.ok(line, `no rate-limit line in: ${JSON.stringify(lines)}`);
		assert.equal(line.level, "warn");
		assert.equal(line.endpoint, "/sign-in/email");
		assert.equal(line.method, "POST");
		assert.equal(line.clientIp, "203.0.113.50");
		assert.equal(typeof line.retryAfterSeconds, "number");
	});

	it("says so when the edge resolved no address, so one bucket serves everyone", async () => {
		const handler = withRateLimitLogging(await build("unresolved"));

		const lines = await capture(async () => {
			for (let attempt = 0; attempt <= SIGN_IN_MAX; attempt++) {
				const response = await signIn(handler, {});
				if (response.status === 429) break;
			}
		});

		const line = lines.find(
			(entry) => entry.msg === "Auth request rate limited",
		);
		assert.ok(line, `no rate-limit line in: ${JSON.stringify(lines)}`);
		assert.equal(line.clientIp, "unresolved");
	});

	it("leaves an answered request alone", async () => {
		const handler = withRateLimitLogging(await build("allowed"));

		const lines = await capture(async () => {
			const response = await signIn(handler, {
				[CLIENT_IP_HEADER]: "198.51.100.60",
			});
			assert.equal(response.status, 401);
		});

		assert.equal(
			lines.filter((entry) => entry.msg === "Auth request rate limited").length,
			0,
		);
	});
});
