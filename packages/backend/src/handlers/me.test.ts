import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { QuarantineListResponse } from "@remit/api-openapi-types";
import {
	QuarantineFailureCode,
	QuarantineFailureStage,
} from "@remit/domain-enums";
import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
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
