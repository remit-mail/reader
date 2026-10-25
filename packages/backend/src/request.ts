import type { APIGatewayProxyEvent } from "aws-lambda";
import type { HandlerRequest } from "./types.js";

export const normalizeRequest = (
	event: APIGatewayProxyEvent,
): HandlerRequest => ({
	method: event.httpMethod,
	path: event.path,
	query: (event.queryStringParameters ?? {}) as Record<string, string>,
	body: event.body,
	headers: (event.headers ?? {}) as Record<string, string>,
});
