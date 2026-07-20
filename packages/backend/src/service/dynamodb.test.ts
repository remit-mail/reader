import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	_resetForTest,
	getClient,
	type RemitClient,
	setClient,
} from "./dynamodb.js";

const REQUIRED_KEYS: ReadonlyArray<keyof RemitClient> = [
	"accountConfig",
	"account",
	"accountSetting",
	"address",
	"mailbox",
	"mailboxSpecialUse",
	"message",
	"messageFlag",
	"outboxMessage",
	"threadMessage",
	"envelope",
	"accountExportRequest",
	"quarantine",
	"storage",
	"search",
	"secrets",
	"bodySync",
	"flagQueue",
	"mailboxQueue",
	"messageMove",
	"outboxQueue",
	"createConnectionScope",
] as const;

afterEach(() => {
	_resetForTest();
});

test("getClient() with DATA_BACKEND=postgres constructs all services without throwing", async () => {
	const savedBackend = process.env.DATA_BACKEND;
	const savedPgUrl = process.env.PG_CONNECTION_URL;

	process.env.DATA_BACKEND = "postgres";
	process.env.PG_CONNECTION_URL =
		"postgresql://remit:remit@localhost:5432/remit_test";

	try {
		const client = await getClient();

		for (const key of REQUIRED_KEYS) {
			assert.ok(
				client[key] !== undefined && client[key] !== null,
				`RemitClient.${key} must be defined on the postgres path`,
			);
		}

		assert.equal(typeof client.createConnectionScope, "function");
	} finally {
		_resetForTest();
		if (savedBackend === undefined) {
			delete process.env.DATA_BACKEND;
		} else {
			process.env.DATA_BACKEND = savedBackend;
		}
		if (savedPgUrl === undefined) {
			delete process.env.PG_CONNECTION_URL;
		} else {
			process.env.PG_CONNECTION_URL = savedPgUrl;
		}
	}
});

test("getClient() without DATA_BACKEND throws until a client is registered", () => {
	const savedBackend = process.env.DATA_BACKEND;
	delete process.env.DATA_BACKEND;

	try {
		assert.throws(() => getClient(), /no DynamoDB client registered/);
	} finally {
		if (savedBackend !== undefined) process.env.DATA_BACKEND = savedBackend;
	}
});

test("getClient() without DATA_BACKEND returns the injected client", async () => {
	const savedBackend = process.env.DATA_BACKEND;
	delete process.env.DATA_BACKEND;

	const injected = { account: {} } as unknown as RemitClient;
	setClient(injected);

	try {
		const client = await getClient();
		assert.equal(client, injected);
	} finally {
		_resetForTest();
		if (savedBackend !== undefined) process.env.DATA_BACKEND = savedBackend;
	}
});
