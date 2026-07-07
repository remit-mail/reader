import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Logger } from "@remit/logger-lambda";
import type { CascadeEntity } from "./cascade.js";
import { runCascadeDelete } from "./cascade-delete.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

const entities: CascadeEntity[] = [
	{ entityType: "Message", key: { messageId: "m-1" } },
];

// A client that fails the test if the DynamoDB path ever touches it.
const forbiddenClient = new Proxy(
	{},
	{
		get() {
			throw new Error("DynamoDB client must not be used on the Postgres path");
		},
	},
) as unknown as DynamoDBDocumentClient;

describe("runCascadeDelete", () => {
	it("routes to the Postgres deleter when one is provided, skipping DynamoDB", async () => {
		let received: CascadeEntity[] | undefined;
		await runCascadeDelete(
			entities,
			{
				ddbConfig: { client: forbiddenClient, table: "t" },
				pgDeleter: async (e) => {
					received = e;
				},
			},
			noopLog,
		);
		assert.deepEqual(received, entities);
	});

	it("falls back to DynamoDB when no Postgres deleter is set", async () => {
		// An empty enumeration makes the DynamoDB cascade a pure no-op, so this
		// exercises the fallback branch without a live table.
		await runCascadeDelete(
			[],
			{ ddbConfig: { client: forbiddenClient, table: "t" } },
			noopLog,
		);
	});
});
