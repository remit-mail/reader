import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { trashOperationsEmptyTrash } from "@remit/api-http-client/sdk.gen.ts";
import { type HttpMock, mockFetch } from "../test-support/http";
import { ApiError } from "./api";
import "./client";

let http: HttpMock | undefined;

afterEach(() => {
	http?.restore();
	http = undefined;
});

const answer = (status: number, body: unknown): void => {
	http = mockFetch(
		() =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
};

const empty = (): Promise<unknown> =>
	trashOperationsEmptyTrash({
		path: { accountId: "acc-1" },
		throwOnError: true,
	});

describe("the error interceptor", () => {
	it("hands the app an ApiError carrying the status and the wire body", async () => {
		answer(409, {
			code: "folder_role_unresolved",
			message: "Nobody has confirmed which folder is this account's Trash",
			details: { reason: "unconfirmed", role: "Trash", accountId: "acc-1" },
		});

		const error = await empty().then(
			() => undefined,
			(reason: unknown) => reason,
		);

		assert.ok(error instanceof ApiError);
		assert.equal(error.status, 409);
		assert.equal(
			error.message,
			"Nobody has confirmed which folder is this account's Trash",
		);
		assert.deepEqual(error.body, {
			code: "folder_role_unresolved",
			message: "Nobody has confirmed which folder is this account's Trash",
			details: { reason: "unconfirmed", role: "Trash", accountId: "acc-1" },
		});
	});

	it("falls back to the status when the body states no message", async () => {
		answer(503, {});

		const error = await empty().then(
			() => undefined,
			(reason: unknown) => reason,
		);

		assert.ok(error instanceof ApiError);
		assert.equal(error.message, "Request failed with status 503");
	});
});
