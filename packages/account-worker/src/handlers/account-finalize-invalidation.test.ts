import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import type { InvalidationClient } from "../cloudfront-invalidation.js";
import { processAccountFinalize } from "./account-finalize.js";

const createMockLog = () =>
	({
		info: mock.fn(),
		warn: mock.fn(),
		error: mock.fn(),
		debug: mock.fn(),
	}) as never;

const createCapturingClient = (): {
	client: InvalidationClient;
	commands: CreateInvalidationCommand[];
} => {
	const commands: CreateInvalidationCommand[] = [];
	return {
		client: {
			send: async (command) => {
				commands.push(command);
				return {};
			},
		},
		commands,
	};
};

describe("processAccountFinalize — CloudFront invalidation (#297)", () => {
	it("submits a CreateInvalidation for /content/accounts/{accountConfigId}/* on the configured distribution", async () => {
		const { client, commands } = createCapturingClient();
		await processAccountFinalize(
			{ type: "FinalizeAccountDelete", accountConfigId: "cfg-alice" },
			createMockLog(),
			{ cloudFrontClient: client, distributionId: "EDIST123" },
		);

		assert.equal(commands.length, 1);
		const cmd = commands[0];
		assert.equal(cmd.input.DistributionId, "EDIST123");
		assert.deepEqual(cmd.input.InvalidationBatch?.Paths?.Items, [
			"/content/accounts/cfg-alice/*",
		]);
	});

	it("propagates CloudFront errors so SQS retries the message", async () => {
		const failingClient: InvalidationClient = {
			send: async () => {
				throw new Error("AccessDenied");
			},
		};
		await assert.rejects(
			processAccountFinalize(
				{ type: "FinalizeAccountDelete", accountConfigId: "cfg-alice" },
				createMockLog(),
				{ cloudFrontClient: failingClient, distributionId: "EDIST" },
			),
			/AccessDenied/,
		);
	});

	it("rejects when CONTENT_DISTRIBUTION_ID is missing — fail-loud, do not silently skip", async () => {
		const { client } = createCapturingClient();
		await assert.rejects(
			processAccountFinalize(
				{ type: "FinalizeAccountDelete", accountConfigId: "cfg-alice" },
				createMockLog(),
				{ cloudFrontClient: client, distributionId: "" },
			),
			/CONTENT_DISTRIBUTION_ID/,
		);
	});
});
