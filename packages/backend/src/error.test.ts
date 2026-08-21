import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FolderRoleConflict } from "@remit/api-openapi-types";
import {
	ClientError,
	FolderRoleUnresolvedError,
	ForbiddenError,
	UnhandledError,
} from "@remit/data-ports/errors";
import { NO_TRASH_FOLDER_REASON } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import { NoTrashMailboxError } from "@remit/mailbox-service";
import { handleError } from "./error.js";

const parseBody = (body: string): Record<string, unknown> =>
	JSON.parse(body) as Record<string, unknown>;

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

	it("keeps an unhandled 500 to a message — no stack, no cause, no code", async () => {
		const response = await handleError(
			new UnhandledError("Something went wrong", new Error("connection reset")),
		);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			message: "Something went wrong",
		});
	});

	it("strips a code a 5xx should never have carried", async () => {
		const error = new UnhandledError("Something went wrong");
		error.publicApiError = {
			code: "folder_role_unresolved",
			details: { role: "Trash", reason: "none", accountId: "account-7" },
		};

		const response = await handleError(error);

		assert.equal(response.statusCode, 500);
		assert.deepEqual(parseBody(response.body), {
			message: "Something went wrong",
		});
	});

	it("answers an unauthenticated request with a 401 and an error body", async () => {
		const response = await handleError(new ClientError("Session expired"));

		assert.equal(response.statusCode, 401);
		assert.deepEqual(parseBody(response.body), { message: "Session expired" });
	});

	it("answers a forbidden request with a 403 and an error body", async () => {
		const response = await handleError(new ForbiddenError("Not your account"));

		assert.equal(response.statusCode, 403);
		assert.deepEqual(parseBody(response.body), { message: "Not your account" });
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
