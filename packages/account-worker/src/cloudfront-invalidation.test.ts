import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import {
	type InvalidationClient,
	invalidateAccountContent,
} from "./cloudfront-invalidation.js";

const createFakeClient = (): {
	client: InvalidationClient;
	commands: CreateInvalidationCommand[];
} => {
	const commands: CreateInvalidationCommand[] = [];
	const client: InvalidationClient = {
		send: async (command) => {
			commands.push(command);
			return {};
		},
	};
	return { client, commands };
};

describe("invalidateAccountContent", () => {
	it("issues a CreateInvalidation against /content/accounts/{accountConfigId}/*", async () => {
		const { client, commands } = createFakeClient();
		await invalidateAccountContent("cfg-alice", "E1ABCDEFGHIJK", client);

		assert.equal(commands.length, 1);
		const cmd = commands[0];
		assert.equal(cmd instanceof CreateInvalidationCommand, true);
		assert.equal(cmd.input.DistributionId, "E1ABCDEFGHIJK");
		assert.equal(cmd.input.InvalidationBatch?.Paths?.Quantity, 1);
		assert.deepEqual(cmd.input.InvalidationBatch?.Paths?.Items, [
			"/content/accounts/cfg-alice/*",
		]);
	});

	it("includes a per-account CallerReference so concurrent invalidations don't collide", async () => {
		const { client, commands } = createFakeClient();
		await invalidateAccountContent("cfg-alice", "DIST", client);
		await invalidateAccountContent("cfg-bob", "DIST", client);

		const refs = commands.map(
			(c) => c.input.InvalidationBatch?.CallerReference ?? "",
		);
		assert.match(refs[0], /^account-erase:cfg-alice:\d+$/);
		assert.match(refs[1], /^account-erase:cfg-bob:\d+$/);
		assert.notEqual(refs[0], refs[1]);
	});

	it("throws when the distribution id is missing — refuses to silently no-op", async () => {
		const { client } = createFakeClient();
		await assert.rejects(
			invalidateAccountContent("cfg-alice", "", client),
			/CONTENT_DISTRIBUTION_ID/,
		);
	});
});
