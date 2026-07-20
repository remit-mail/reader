import { isInstanceOwner } from "@remit/auth-service";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getSubFromEvent } from "../auth.js";

const forbidden = (message: string): APIGatewayProxyResult => ({
	statusCode: 403,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ message }),
});

/**
 * Gate a request to the standalone instance owner (RFC 037 D8) — the first
 * account to register, or whoever `REMIT_OWNER_EMAIL` names. Returns `null` to
 * let the request proceed, or a 403 `APIGatewayProxyResult` otherwise. Callers
 * wire this in ahead of the handler; it does not run the handler itself.
 */
export const requireInstanceOwner = async (
	event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult | null> => {
	const sub = getSubFromEvent(event);
	if (!sub) return forbidden("Instance owner required");
	if (!(await isInstanceOwner(sub)))
		return forbidden("Instance owner required");
	return null;
};
