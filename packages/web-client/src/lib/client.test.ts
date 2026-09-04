import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { trashOperationsEmptyTrashMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { trashOperationsEmptyTrash } from "@remit/api-http-client/sdk.gen.ts";
import { QueryClient } from "@tanstack/react-query";
import { getRuntimeConfig } from "../runtime-config";
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

/**
 * `client.ts` reaches the generated client as `@remit/api-http-client/client.gen.ts`
 * while the generated code reaches it as `./client.gen.js`. Both must land on
 * one module: two would leave every generated call on the generated default
 * base URL and outside the error interceptor, so a 409 would arrive with no
 * status and the fatal-error classifier would escalate it. Vite dedupes; this
 * pins the node test loader, where the flow tests run.
 */
describe("the client the generated code calls through", () => {
	const emptyViaQueryLayer = (): Promise<unknown> => {
		const { mutationFn } = trashOperationsEmptyTrashMutation();
		assert.ok(mutationFn);
		return mutationFn(
			{ path: { accountId: "acc-1" } },
			{ client: new QueryClient(), meta: undefined },
		);
	};

	it("is the instance client.ts configured, for the SDK and the query layer", async () => {
		answer(200, {});

		await empty();
		await emptyViaQueryLayer();

		const sent = http?.calls.map((call) => call.url) ?? [];
		assert.equal(sent.length, 2);
		const base = `${getRuntimeConfig().apiUrl}/accounts/acc-1/trash/empty`;
		assert.deepEqual(sent, [base, base]);
	});

	it("carries the status on a query-layer failure too", async () => {
		answer(409, { code: "config_not_empty", message: "already configured" });

		const error = await emptyViaQueryLayer().then(
			() => undefined,
			(reason: unknown) => reason,
		);

		assert.ok(error instanceof ApiError);
		assert.equal(error.status, 409);
	});
});
