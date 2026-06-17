/**
 * Visual regression suite global setup.
 *
 * Extends the shared smoke global-setup with a DynamoDB table reset before
 * seeding. This is necessary because in CI the playwright-tests job runs smoke
 * tests before visual tests using the same local DynamoDB. The smoke run:
 *   1. Seeds messages with real wall-clock dates (no REMIT_FAKE_NOW).
 *   2. Marks messages as read by opening them during smoke flows.
 *
 * Both effects make the visual tests non-deterministic: relative timestamps
 * ("Yesterday" vs "Mar 19") change daily, and the read/unread state affects
 * the brief's "Needs attention" section. Resetting the table here ensures the
 * visual tests always start from the same fake-clock, known-read-state data
 * regardless of what smoke left behind.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CreateTableCommand,
	DeleteTableCommand,
	DynamoDBClient,
	ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import smokeSetup from "../smoke/global-setup.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.replace(/\/[^/]+$/, "");

const TABLE_SCHEMA_PATH = resolve(
	__dirname,
	"../../../dynamodb/table.schema.json",
);

const resetTable = async () => {
	const port = Number.parseInt(process.env.DYNAMODB_PORT ?? "5435", 10);
	const tableName = process.env.DYNAMODB_TABLE_NAME ?? "remit-test";

	const client = new DynamoDBClient({
		endpoint: `http://localhost:${port}`,
		region: process.env.AWS_REGION ?? "not-a-region",
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
		},
	});

	const { TableNames = [] } = await client.send(new ListTablesCommand({}));

	if (TableNames.includes(tableName)) {
		await client.send(new DeleteTableCommand({ TableName: tableName }));
	}

	const schema = JSON.parse(readFileSync(TABLE_SCHEMA_PATH, "utf-8"));
	await client.send(
		new CreateTableCommand({ ...schema, TableName: tableName }),
	);
};

const globalSetup = async () => {
	console.log("Visual Global Setup: resetting DynamoDB table...");
	await resetTable();
	console.log("Visual Global Setup: table reset, seeding data...");
	await smokeSetup();
};

export default globalSetup;
