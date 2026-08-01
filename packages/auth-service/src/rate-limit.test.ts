import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Auth } from "./auth.js";
import { CLIENT_IP_HEADER, createAuth } from "./auth.js";

const SIGN_IN_MAX = 2;
const MIGRATIONS = resolve(
	import.meta.dirname,
	"../../../deploy/vps/migrations-sqlite/auth",
);

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

const signIn = (auth: Auth, headers: Record<string, string>) =>
	auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify({
				email: "nobody@example.com",
				password: "a-sufficiently-long-password",
			}),
		}),
	);

/**
 * Spend one client's sign-in budget, returning the attempt number that was
 * turned away. `null` means the budget never ran out.
 */
const exhaust = async (
	auth: Auth,
	headers: Record<string, string>,
): Promise<number | null> => {
	for (let attempt = 0; attempt <= SIGN_IN_MAX; attempt++) {
		const response = await signIn(auth, headers);
		if (response.status === 429) return attempt;
	}
	return null;
};

describe("sign-in rate limiting is per client", () => {
	const previousMax = process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX;
	let dir: string;

	before(() => {
		process.env.BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX = String(SIGN_IN_MAX);
		dir = mkdtempSync(join(tmpdir(), "remit-rate-limit-"));
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
			secret: "rate-limit-test-secret-value-32chars-min",
			baseURL: "http://localhost:3000",
			selfSignUpEnabled: true,
		});

	it("locks out only the client that spent the budget", async () => {
		const auth = await build("per-client");

		assert.equal(
			await exhaust(auth, { [CLIENT_IP_HEADER]: "203.0.113.10" }),
			SIGN_IN_MAX,
		);

		const other = await signIn(auth, { [CLIENT_IP_HEADER]: "198.51.100.20" });
		assert.equal(other.status, 401);
	});

	it("ignores a forwarded address the client supplies itself", async () => {
		const auth = await build("spoofed");
		const client = { [CLIENT_IP_HEADER]: "203.0.113.30" };

		assert.equal(
			await exhaust(auth, { ...client, "x-forwarded-for": "203.0.113.31" }),
			SIGN_IN_MAX,
		);

		const spoofed = await signIn(auth, {
			...client,
			"x-forwarded-for": "198.51.100.40",
		});
		assert.equal(spoofed.status, 429);
	});
});
