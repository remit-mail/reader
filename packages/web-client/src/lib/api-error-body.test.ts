/**
 * #1004: two types named `ApiError` — the generated wire body (flat `code` and
 * `details`) and the class every failure is wrapped in (`message`, `status`,
 * `body`). A refusal check that reads `code` off the top level matches nothing,
 * and a test that only ever hands it the flat body cannot tell. Every case here
 * is built by running the interceptor the app actually registers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFolderRoleRefusal } from "@/components/ui/folder-role-refusal";
import { isPlacementRefusal } from "@/components/ui/placement-refusal";
import { ApiError } from "./api.js";
import { apiErrorBody, toApiError } from "./api-error-body.js";

/** What the API emits and hey-api throws, before the interceptor sees it. */
const wireBody = (code: string, details: Record<string, string>) => ({
	message: "Refused",
	code,
	details,
});

/** What a call site receives: the interceptor's output, not the wire body. */
const asReceived = (code: string, details: Record<string, string>): unknown =>
	toApiError(wireBody(code, details), { status: 409 } as Response);

const PLACEMENT = {
	accountId: "acc-1",
	messageId: "msg-1",
	reason: "in_flight",
};
const FOLDER_ROLE = {
	accountId: "acc-1",
	role: "Trash",
	reason: "stale",
};

describe("the interceptor's output is what the refusal checks must read", () => {
	it("wraps the wire body rather than passing it through", () => {
		const received = asReceived("message_placement_unsettled", PLACEMENT);
		assert.ok(received instanceof ApiError);
		assert.equal(received.status, 409);
		assert.equal(
			(received as { code?: unknown }).code,
			undefined,
			"the code does not survive at the top level — this is the whole defect",
		);
	});

	it("finds the placement refusal in what a call site receives", () => {
		assert.deepEqual(
			isPlacementRefusal(asReceived("message_placement_unsettled", PLACEMENT)),
			{ reason: "in_flight", messageId: "msg-1" },
		);
	});

	it("finds the folder-role refusal in what a call site receives (#1004)", () => {
		const refusal = isFolderRoleRefusal(
			asReceived("folder_role_unresolved", FOLDER_ROLE),
		);
		assert.deepEqual(refusal, {
			reason: "stale",
			role: "Trash",
			accountId: "acc-1",
		});
	});

	it("reads the same body off the other client's ApiError", () => {
		// `api.ts`'s own `request` wraps failures the same way.
		const thrown = new ApiError(
			"Refused",
			409,
			wireBody("message_placement_unsettled", PLACEMENT),
		);
		assert.equal(
			isPlacementRefusal(thrown)?.messageId,
			"msg-1",
			"both clients wrap, so both must be read the same way",
		);
	});

	it("leaves a transport failure alone", () => {
		const offline = new TypeError("Failed to fetch");
		assert.equal(toApiError(offline, undefined), offline);
		assert.equal(apiErrorBody(offline), undefined);
		assert.equal(isPlacementRefusal(offline), undefined);
		assert.equal(isFolderRoleRefusal(offline), undefined);
	});

	it("ignores a 409 that carries somebody else's code", () => {
		const other = asReceived("mailbox_not_settled", { mailboxId: "m" });
		assert.equal(isPlacementRefusal(other), undefined);
		assert.equal(isFolderRoleRefusal(other), undefined);
	});
});
