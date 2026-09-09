import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiError, FolderRoleConflict } from "@remit/api-openapi-types";
import {
	BadRequestError,
	ClientError,
	ConflictError,
	FolderRoleUnresolvedError,
	ForbiddenError,
	NotFoundError,
	UnhandledError,
	UnrecoverableBodyError,
} from "@remit/data-ports/errors";
import { NO_TRASH_FOLDER_REASON } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import { NoTrashMailboxError } from "@remit/mailbox-service";
import { handleError } from "./error.js";

const parseBody = (body: string): Record<string, unknown> =>
	JSON.parse(body) as Record<string, unknown>;

// One shape for every error the API answers with (issue #371): flat, always a
// `code`, always a `message`. A status class that reaches a client without a
// code leaves it branching on prose.
describe("the wire shape of a refusal, per status class", () => {
	const cases: ReadonlyArray<[string, Error, number, string]> = [
		[
			"400",
			new BadRequestError("confirmEmail is required"),
			400,
			"invalid_request",
		],
		["401", new ClientError("Session expired"), 401, "unauthorized"],
		["403", new ForbiddenError("Not your account"), 403, "forbidden"],
		["404", new NotFoundError("Mailbox not found: mb-1"), 404, "not_found"],
		[
			"409",
			new ConflictError("An update is already in progress."),
			409,
			"conflict",
		],
		[
			"422",
			new UnrecoverableBodyError("This message's body could not be read."),
			422,
			"unprocessable_entity",
		],
	];

	for (const [name, error, statusCode, code] of cases) {
		it(`answers ${name} with a flat code and message`, async () => {
			const response = await handleError(error);

			assert.equal(response.statusCode, statusCode);
			assert.deepEqual(parseBody(response.body), {
				code,
				message: error.message,
			});
		});
	}

	// A 5xx is the one class whose message is not the thrower's. Those sentences
	// are written for a log line and name hosts, queries and ids; the correlation
	// id on the response is how the real one is found.
	it("answers 500 with one code and one sentence, never the thrower's", async () => {
		const response = await handleError(
			new UnhandledError(
				"pg://reader@db-3.internal:5432 timed out on SELECT * FROM message",
			),
		);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			code: "internal_error",
			message: "Internal server error",
		});
	});

	it("types every one of those bodies as the declared ApiError", async () => {
		const response = await handleError(new NotFoundError("Gone"));
		const body: ApiError = JSON.parse(response.body);

		assert.equal(body.code, "not_found");
		assert.equal(body.message, "Gone");
	});
});

describe("handleError coded refusals", () => {
	it("puts the code and every detail of a folder-role 409 on the wire", async () => {
		const response = await handleError(
			new FolderRoleUnresolvedError(
				"The folder you chose for Trash is gone.",
				CanonicalMailboxRole.Trash,
				"stale",
				"account-7",
			),
		);

		assert.equal(response.statusCode, 409);
		assert.deepEqual(parseBody(response.body), {
			message: "The folder you chose for Trash is gone.",
			code: "folder_role_unresolved",
			details: { role: "Trash", reason: "stale", accountId: "account-7" },
		});
	});

	it("carries NoTrashMailboxError as the Trash role with reason none", async () => {
		const response = await handleError(new NoTrashMailboxError("account-7"));

		assert.equal(response.statusCode, 409);
		assert.deepEqual(parseBody(response.body), {
			message: NO_TRASH_FOLDER_REASON,
			code: "folder_role_unresolved",
			details: { role: "Trash", reason: "none", accountId: "account-7" },
		});
	});

	it("keeps an unhandled 500 to a code and a message — no stack, no cause, no details", async () => {
		const response = await handleError(
			new UnhandledError("Something went wrong", new Error("connection reset")),
		);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			code: "internal_error",
			message: "Internal server error",
		});
	});

	it("replaces a code a 5xx should never have carried, and drops its details", async () => {
		const error = new UnhandledError("Something went wrong");
		error.publicApiError = {
			code: "folder_role_unresolved",
			details: { role: "Trash", reason: "none", accountId: "account-7" },
		};

		const response = await handleError(error);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			code: "internal_error",
			message: "Internal server error",
		});
	});

	it("keeps an infrastructure failure to the generic message and code", async () => {
		const error = Object.assign(
			new Error("aws-error: ProvisionedThroughputExceeded on remit-main"),
			{ name: "ElectroError" },
		);

		const response = await handleError(error);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			code: "internal_error",
			message: "Database temporarily unavailable",
		});
	});

	it("answers a malformed query as a 400 with the query's own message", async () => {
		const error = Object.assign(new Error("Invalid attribute: sentDate"), {
			name: "ElectroError",
		});

		const response = await handleError(error);

		assert.equal(response.statusCode, 400);
		assert.deepEqual(parseBody(response.body), {
			code: "invalid_request",
			message: "Invalid attribute: sentDate",
		});
	});

	// The contract and the emitter cannot drift apart: this asserts the response
	// `handleError` actually builds against the generated model. Nesting the body
	// under `error` again would leave `code` off `keyof FolderRoleConflict` and
	// fail to compile here, long before a client reads a 409 it cannot parse.
	it("matches the generated FolderRoleConflict model field for field", async () => {
		const response = await handleError(
			new FolderRoleUnresolvedError(
				"Nobody has confirmed a Trash folder.",
				CanonicalMailboxRole.Trash,
				"unconfirmed",
				"account-7",
			),
		);
		const body: Omit<FolderRoleConflict, "statusCode"> = JSON.parse(
			response.body,
		);
		const declaredFields: ReadonlyArray<keyof typeof body> = [
			"code",
			"details",
			"message",
		];

		assert.equal(response.statusCode, 409);
		assert.deepEqual(Object.keys(body).sort(), [...declaredFields].sort());
		assert.equal(body.code, "folder_role_unresolved");
	});
});
