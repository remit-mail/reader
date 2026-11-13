import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { handleApiEvent } from "../index.js";

const id = (n: number): string => `id${String(n).padStart(23, "0")}`;

describe("rescanMessages", () => {
	it("refuses an eleventh message id with a 400 naming the limit", async () => {
		const response = await handleApiEvent(
			{
				httpMethod: "POST",
				path: `/accounts/${id(0)}/messages/rescan`,
				body: JSON.stringify({
					messageIds: Array.from({ length: 11 }, (_, n) => id(n + 1)),
				}),
				queryStringParameters: null,
				headers: { "content-type": "application/json" },
				requestContext: { authorizer: { claims: { sub: "rescan-sub" } } },
			} as unknown as APIGatewayProxyEvent,
			{ awsRequestId: "rescan-limit" } as Context,
		);

		assert.equal(response.statusCode, 400);
		const body = JSON.parse(response.body) as {
			errors: { path: string; rule: string; message: string }[];
		};
		assert.deepEqual(
			body.errors.map(({ rule, message }) => ({ rule, message })),
			[{ rule: "maxItems", message: "must NOT have more than 10 items" }],
		);
	});
});
