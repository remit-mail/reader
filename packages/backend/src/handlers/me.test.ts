import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { QuarantineItem } from "@remit/data-ports";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/dynamodb.js";
import { MeOperations } from "./me.js";

const listQuarantine = MeOperations.MeOperations_listQuarantine as unknown as (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<{ entries: QuarantineItem[] }>;

const SUB = "cognito-sub-1";

const eventFor = (sub: string): APIGatewayProxyEvent =>
	({
		requestContext: { authorizer: { claims: { sub } } },
	}) as unknown as APIGatewayProxyEvent;

const entry = (over: Partial<QuarantineItem> = {}): QuarantineItem =>
	({
		quarantineId: "q-1",
		accountConfigId: deriveAccountConfigId(SUB),
		accountId: "acct-1",
		mailboxId: "mbx-1",
		uidValidity: 1_712_000_000,
		uid: 40217,
		mailboxPath: "INBOX",
		quarantinedAt: 1_000,
		attempts: 3,
		failureStage: "BodyParse",
		failureCode: "UnreadableBody",
		failureMessage: "multipart boundary was never closed",
		workerVersion: "worker 1.0.0",
		structure: [{ depth: 0, contentType: "multipart/mixed" }],
		createdAt: 1_000,
		updatedAt: 1_000,
		...over,
	}) as QuarantineItem;

const clientListing = (items: QuarantineItem[], seen: string[]): RemitClient =>
	({
		quarantine: {
			listByAccountConfigId: async (
				accountConfigId: string,
			): Promise<QuarantineItem[]> => {
				seen.push(accountConfigId);
				return items;
			},
		},
	}) as unknown as RemitClient;

afterEach(() => {
	_resetForTest();
});

describe("MeOperations_listQuarantine", () => {
	it("lists only what belongs to the caller", async () => {
		const seen: string[] = [];
		setClient(clientListing([entry()], seen));

		const response = await listQuarantine({} as Context, eventFor(SUB));

		assert.deepEqual(seen, [deriveAccountConfigId(SUB)]);
		assert.deepEqual(response, { entries: [entry()] });
	});

	it("returns an empty list rather than failing when nothing is quarantined", async () => {
		setClient(clientListing([], []));

		const response = await listQuarantine({} as Context, eventFor(SUB));

		assert.deepEqual(response, { entries: [] });
	});
});
