import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import type { QuarantineListResponse } from "@remit/api-openapi-types";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	QuarantineFailureCode,
	QuarantineFailureStage,
	SyncWarningStage,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import { MeOperations } from "./me.js";

const listQuarantine = MeOperations.MeOperations_listQuarantine as unknown as (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<QuarantineListResponse>;

const eventFor = (sub: string): APIGatewayProxyEvent =>
	({
		requestContext: { authorizer: { claims: { sub } } },
	}) as unknown as APIGatewayProxyEvent;

let client: RemitClient;
let cleanup: () => void;

const quarantine = (sub: string, uid: number) =>
	client.quarantine.upsert({
		accountConfigId: deriveAccountConfigId(sub),
		accountId: `acct-${sub}`,
		mailboxId: `mbx-${sub}`,
		uidValidity: 1_712_000_000,
		uid,
		mailboxPath: "INBOX",
		quarantinedAt: uid,
		attempts: 3,
		failureStage: QuarantineFailureStage.BodyParse,
		failureCode: QuarantineFailureCode.UnreadableBody,
		failureMessage: "multipart boundary was never closed",
		workerVersion: "worker 1.0.0",
	});

const failRounds = async (
	sub: string,
	uids: number[],
	rounds: number,
	at: number,
) => {
	const now = mock.method(Date, "now", () => at);
	for (let round = 0; round < rounds; round++) {
		await client.syncWarning.recordFailures(
			uids.map((uid) => ({
				accountConfigId: deriveAccountConfigId(sub),
				accountId: `acct-${sub}`,
				mailboxId: `mbx-${sub}`,
				uidValidity: 1_712_000_000,
				uid,
				stage: SyncWarningStage.Body,
			})),
		);
	}
	now.mock.restore();
};

before(async () => {
	_resetForTest();
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
});

after(() => {
	_resetForTest();
	cleanup();
});

describe("MeOperations_listQuarantine", () => {
	it("lists the caller's quarantined messages and nobody else's", async () => {
		await quarantine("me-caller", 40217);
		await quarantine("me-stranger", 99);

		const response = await listQuarantine({} as Context, eventFor("me-caller"));

		assert.deepEqual(
			response.entries.map((entry) => [entry.accountId, entry.uid]),
			[["acct-me-caller", 40217]],
		);
	});
});

describe("MeOperations_listQuarantine warnings", () => {
	it("returns the caller's warnings at three attempts or more, newest first", async () => {
		await failRounds("warn-caller", [1], 3, 1_000);
		await failRounds("warn-caller", [2], 4, 2_000);
		await failRounds("warn-caller", [3], 2, 3_000);
		await failRounds("warn-stranger", [4], 3, 4_000);

		const response = await listQuarantine(
			{} as Context,
			eventFor("warn-caller"),
		);

		assert.deepEqual(
			response.warnings.map((warning) => [warning.uid, warning.attempts]),
			[
				[2, 4],
				[1, 3],
			],
		);
		assert.equal(response.warningsTotal, 2);
	});

	it("caps the list at 200 and counts every surfaced warning", async () => {
		const uids = Array.from({ length: 201 }, (_, index) => index + 1);
		await failRounds("warn-flood", uids, 3, 5_000);

		const response = await listQuarantine(
			{} as Context,
			eventFor("warn-flood"),
		);

		assert.equal(response.warnings.length, 200);
		assert.equal(response.warningsTotal, 201);
	});
});
