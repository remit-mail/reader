import type { APIGatewayProxyEvent } from "aws-lambda";
import { getIdentityFromEvent } from "./auth.js";
import { normalizeRequest } from "./request.js";
import type { RemitClient } from "./service/create-remit-client.js";
import type { HandlerContext } from "./types.js";

export const handlerContextFromEvent = (
	client: RemitClient,
	event: APIGatewayProxyEvent,
): HandlerContext => ({
	client,
	identity: getIdentityFromEvent(event),
	request: normalizeRequest(event),
});
