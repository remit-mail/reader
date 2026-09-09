import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { OrganizeInput } from "@remit/api-openapi-types";
import type {
	CreateOrganizeJobRequestInput,
	IAccountRepository,
	IOrganizeJobRequestRepository,
	OrganizeJobRequestItem,
} from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";
import { FilterMatchOperator } from "@remit/domain-enums";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { deriveAccountConfigId } from "../auth.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { sqsClient } from "../service/sqs.js";
import { OrganizeOperations, predicateFromInput } from "./organize.js";

const input = (over: Partial<OrganizeInput> = {}): OrganizeInput => ({
	matchOperator: FilterMatchOperator.And,
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "None",
	...over,
});

// A move back-apply is accepted end to end: createOrganizeJob and
// previewOrganize no longer reject `actionMailboxId` up front (the removed
// label-only 400). Both endpoints flatten the request into the predicate the
// job row and the matcher share, so the proof of acceptance is that the move
// action survives that mapping verbatim — the worker then applies it through
// the wired placement mover (see service/organize.test.ts).
describe("predicateFromInput (move back-apply accepted)", () => {
	it("carries a requested move action through to the predicate", () => {
		const predicate = predicateFromInput(
			input({ actionMailboxId: "mbox-target" }),
		);
		assert.equal(predicate.actionMailboxId, "mbox-target");
		assert.equal(predicate.actionLabelId, "None");
	});

	it("carries a combined move + label action through to the predicate", () => {
		const predicate = predicateFromInput(
			input({ actionLabelId: "lbl-1", actionMailboxId: "mbox-target" }),
		);
		assert.equal(predicate.actionMailboxId, "mbox-target");
		assert.equal(predicate.actionLabelId, "lbl-1");
	});

	it("preserves the None sentinel for an absent action", () => {
		const predicate = predicateFromInput(input());
		assert.equal(predicate.actionMailboxId, "None");
		assert.equal(predicate.actionLabelId, "None");
	});
});

// The matcher returns a body-content (HasWords) refusal as a result (see
// service/organize.test.ts); previewOrganize is the boundary that words it as a
// BadRequestError. Proving the 4xx actually reaches the wire — not just that the
// right class is raised — means proving the shared error handler maps it, since
// a plain Error would otherwise fall through to a 500 (reader #457).
describe("previewOrganize rejected-rule response (reader #457)", () => {
	it("maps a rejected HasWords clause to a 400 naming the reason, not a 500", async () => {
		const error = new BadRequestError(
			"Organize literal matching cannot evaluate a body-content (HasWords) clause without the vector pipeline — it requires the semantic widen path",
		);

		const response = await handleError(error);

		assert.equal(response.statusCode, 400);
		assert.match(JSON.parse(response.body).message, /HasWords/);
	});
});

const SUB = "cognito-sub-995";
const ACCOUNT_CONFIG_ID = deriveAccountConfigId(SUB);
const ACCOUNT_ID = "acc-995";

const createdRows: CreateOrganizeJobRequestInput[] = [];
const enqueued: SendMessageCommand[] = [];

const installClient = (): void => {
	createdRows.length = 0;
	setClient({
		account: {
			get: async () => ({
				accountId: ACCOUNT_ID,
				accountConfigId: ACCOUNT_CONFIG_ID,
			}),
		} as unknown as IAccountRepository,
		organizeJobRequest: {
			create: async (input: CreateOrganizeJobRequestInput) => {
				createdRows.push(input);
				return {
					...input,
					organizeJobId: `job-${createdRows.length}`,
					state: "Pending",
				} as unknown as OrganizeJobRequestItem;
			},
		} as unknown as IOrganizeJobRequestRepository,
	} as unknown as RemitClient);
};

const authorizedEvent = (): APIGatewayProxyEvent =>
	({
		body: null,
		requestContext: { authorizer: { claims: { sub: SUB } } },
	}) as unknown as APIGatewayProxyEvent;

const createJob = OrganizeOperations.OrganizeOperations_createOrganizeJob as (
	context: Context,
	event: APIGatewayProxyEvent,
) => Promise<Record<string, unknown>>;

/** The response the browser receives, error funnel included. */
const postOrganize = async (
	body: OrganizeInput,
): Promise<APIGatewayProxyResult> => {
	const context = {
		request: { params: { accountId: ACCOUNT_ID }, requestBody: body },
	} as unknown as Context;
	return createJob(context, authorizedEvent()).then(
		(response) => formatResponse(response),
		(error: unknown) => handleError(error),
	);
};

// A rule the matcher can never honour — a body-content clause with no anchor to
// widen from — is refused on the request instead of accepted with a 202 for a
// job the worker can only fail (reader #463, #995). The contract now declares
// the 400, so the proof is the response the client gets plus the absence of the
// two side effects a 202 promises: a job row and a queued message.
describe("createOrganizeJob rejected-rule refusal (reader #995)", () => {
	afterEach(() => {
		mock.restoreAll();
		_resetForTest();
	});

	const withStubbedQueue = (): void => {
		process.env.SQS_QUEUE_URL_ACCOUNT_FANOUT =
			"http://localhost:9324/queue/account-fanout-test";
		enqueued.length = 0;
		mock.method(sqsClient, "send", async (command: SendMessageCommand) => {
			enqueued.push(command);
			return {};
		});
		installClient();
	};

	it("refuses an anchorless body-content clause with a 400 and creates nothing", async () => {
		withStubbedQueue();

		const response = await postOrganize(
			input({ literalClauses: [{ field: "HasWords", value: "invoice" }] }),
		);

		assert.equal(response.statusCode, 400);
		assert.match(JSON.parse(response.body).message, /HasWords/);
		assert.deepEqual(createdRows, []);
		assert.deepEqual(enqueued, []);
	});

	it("accepts the same clause when an anchor gives the widen something to run on", async () => {
		withStubbedQueue();

		const response = await postOrganize(
			input({
				anchorMessageId: "msg-anchor",
				literalClauses: [{ field: "HasWords", value: "invoice" }],
			}),
		);

		assert.equal(response.statusCode, 202);
		assert.equal(createdRows.length, 1);
		assert.equal(enqueued.length, 1);
		assert.match(
			String(enqueued[0]?.input.MessageBody),
			new RegExp(String(JSON.parse(response.body).organizeJobId)),
		);
	});
});
