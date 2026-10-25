import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { OrganizeInput } from "@remit/api-openapi-types";
import type {
	CreateOrganizeJobRequestInput,
	FilterItem,
	IAccountRepository,
	IOrganizeJobRequestRepository,
	OrganizeJobRequestItem,
} from "@remit/data-ports";
import { BadRequestError, NotFoundError } from "@remit/data-ports/errors";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import {
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { FilterMatchOperator } from "@remit/domain-enums";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { testApiConfig } from "../config/test-config.js";
import { handleError } from "../error.js";
import { formatResponse } from "../response.js";
import type { RemitClient } from "../service/data-client.js";
import type { QueueName } from "../service/queues.js";
import type {
	HandlerContext,
	OperationHandler,
	OperationIds,
} from "../types.js";
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
			"Organize cannot match a body-content (HasWords) clause over the mailbox: it reads only each message's preview, not its body",
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
let fanout: RecordingQueue = recordingQueue();
let client: RemitClient;

const installClient = (): void => {
	createdRows.length = 0;
	client = {
		queues: { accountFanout: fanout },
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
	} as unknown as RemitClient;
};

const authorized = (): HandlerContext<QueueName> => ({
	client,
	config: testApiConfig(),
	identity: {
		kind: "user",
		accountConfigId: ACCOUNT_CONFIG_ID,
		sub: SUB,
		email: "caller@example.com",
	},
});

const createJob: OperationHandler<OperationIds, "accountFanout"> =
	OrganizeOperations.OrganizeOperations_createOrganizeJob;

/** The response the browser receives, error funnel included. */
const postOrganize = async (
	body: OrganizeInput,
): Promise<APIGatewayProxyResult> => {
	const context = {
		request: { params: { accountId: ACCOUNT_ID }, requestBody: body },
	} as unknown as Context;
	return createJob(context, authorized()).then(
		(response) => formatResponse(response),
		(error: unknown) => handleError(error),
	);
};

// A rule the matcher can never honour — a body-content clause — is refused on the request instead of accepted with a 202 for a
// job the worker can only fail (reader #463, #995). The contract now declares
// the 400, so the proof is the response the client gets plus the absence of the
// two side effects a 202 promises: a job row and a queued message.
describe("createOrganizeJob rejected-rule refusal (reader #995)", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	const withStubbedQueue = (): void => {
		fanout = recordingQueue();
		installClient();
	};

	it("refuses a body-content clause with a 400 and creates nothing", async () => {
		withStubbedQueue();

		const response = await postOrganize(
			input({ literalClauses: [{ field: "HasWords", value: "invoice" }] }),
		);

		assert.equal(response.statusCode, 400);
		assert.match(JSON.parse(response.body).message, /HasWords/);
		assert.deepEqual(createdRows, []);
		assert.deepEqual(fanout.sent, []);
	});
});

describe("createOrganizeJob by filterId — Run now (#1354)", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	const standing = (state: FilterItem["state"]): FilterItem => ({
		filterId: "flt-1",
		accountConfigId: ACCOUNT_CONFIG_ID,
		name: "Invoices",
		scope: "Standing",
		state,
		disabledReason: state === "Active" ? "None" : "UserDisabled",
		ruleChangedAt: 1,
		actionChangedAt: 1,
		matchOperator: FilterMatchOperator.And,
		literalClauses: [{ field: "From", value: "billing@example.com" }],
		actionLabelId: "None",
		actionMailboxId: "mbx-invoices",
		createdAt: 0,
		updatedAt: 0,
	});

	const withFilter = (filter: FilterItem): void => {
		createdRows.length = 0;
		fanout = recordingQueue();
		client = {
			queues: { accountFanout: fanout },
			account: {
				get: async () => ({
					accountId: ACCOUNT_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
				}),
			},
			filter: {
				get: async () => filter,
			},
			organizeJobRequest: {
				create: async (row: CreateOrganizeJobRequestInput) => {
					createdRows.push(row);
					return { ...row, organizeJobId: "job-run", state: "Pending" };
				},
			},
		} as unknown as RemitClient;
	};

	it("queues a job that names only the filter", async () => {
		withFilter(standing("Active"));

		const response = await postOrganize(input({ filterId: "flt-1" }));

		assert.equal(response.statusCode, 202);
		assert.equal(createdRows[0]?.filterId, "flt-1");
		assert.equal(createdRows[0]?.actionMailboxId, "None");
		assert.deepEqual(createdRows[0]?.literalClauses, []);
		assert.equal(fanout.sent.length, 1);
	});

	it("answers an unknown filter with a 404 and queues nothing", async () => {
		withFilter(standing("Active"));
		client = {
			queues: { accountFanout: fanout },
			account: {
				get: async () => ({
					accountId: ACCOUNT_ID,
					accountConfigId: ACCOUNT_CONFIG_ID,
				}),
			},
			filter: {
				get: async () => {
					throw new NotFoundError("Filter not found: flt-gone");
				},
			},
		} as unknown as RemitClient;

		const response = await postOrganize(input({ filterId: "flt-gone" }));

		assert.equal(response.statusCode, 404);
		assert.deepEqual(createdRows, []);
		assert.deepEqual(fanout.sent, []);
	});
});
