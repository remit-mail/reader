import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { createAuth } from "./auth.js";
import {
	createInstanceOwnerStore,
	type InstanceOwnerStore,
} from "./instance-owner.js";
import * as authSchema from "./schema/auth-schema.js";
import * as metaSchema from "./schema/meta-schema.js";

/**
 * Real Postgres coverage for RFC 037 D8, using a self-contained embedded
 * server (the same tool `drizzle-service`'s pg repo tests use, `before`/
 * `after`-scoped the same way) rather than a container — no external service
 * required, so this runs in CI unattended. Proves the earlier failure —
 * nothing ever migrated `instance_owner` on Postgres, so every registration
 * 500s — is closed: this pushes the exact `auth-schema.ts` + `meta-schema.ts`
 * tables (the same shape `deploy/vps/migrations/meta` migrates to) and drives
 * real signups through `createAuth`.
 */
describe("createAuth claims ownership on registration — postgres (RFC 037 D8)", () => {
	const combinedSchema = { ...authSchema, ...metaSchema };
	const port = 55600 + Math.floor(Math.random() * 400);
	const databaseDir = `/tmp/auth-service-test-pg-${port}-${Date.now()}`;
	const pg = new EmbeddedPostgres({
		databaseDir,
		user: "test",
		password: "test",
		port,
		persistent: false,
	});
	const connectionString = `postgresql://test:test@localhost:${port}/postgres`;
	let store: InstanceOwnerStore;

	before(async () => {
		await pg.initialise();
		await pg.start();

		const db = drizzle(connectionString, { schema: combinedSchema });
		const write = process.stdout.write.bind(process.stdout);
		process.stdout.write = (() => true) as typeof process.stdout.write;
		try {
			const { apply } = await pushSchema(
				combinedSchema,
				db as unknown as Parameters<typeof pushSchema>[1],
			);
			await apply();
		} finally {
			process.stdout.write = write;
		}

		store = await createInstanceOwnerStore({
			provider: "pg",
			connectionString,
		});
	});

	after(async () => {
		await store.close();
		await pg.stop();
		try {
			rmSync(databaseDir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	});

	const signUp = (
		auth: Awaited<ReturnType<typeof createAuth>>,
		email: string,
	) =>
		auth.handler(
			new Request("http://localhost:3000/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email,
					password: "a-sufficiently-long-password",
					name: email,
				}),
			}),
		);

	it("the first real Postgres signup succeeds and claims ownership; the second does not", async () => {
		const auth = await createAuth({
			provider: "pg",
			connectionString,
			secret: "instance-owner-pg-test-secret-value-32chars-minimum",
			baseURL: "http://localhost:3000",
			selfSignUpEnabled: true,
		});

		const first = await signUp(auth, "first@example.com");
		assert.equal(first.status, 200);
		const firstBody = (await first.json()) as { user: { id: string } };

		const second = await signUp(auth, "second@example.com");
		assert.equal(second.status, 200);
		const secondBody = (await second.json()) as { user: { id: string } };

		assert.equal(await store.isOwner(firstBody.user.id), true);
		assert.equal(await store.isOwner(secondBody.user.id), false);
	});
});
