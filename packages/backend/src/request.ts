import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Request } from "openapi-backend";

export const normalizeRequest = (event: APIGatewayProxyEvent): Request => ({
	method: event.httpMethod,
	path: event.path,
	query: (event.queryStringParameters ?? {}) as Record<string, string>,
	body: event.body,
	headers: (event.headers ?? {}) as Record<string, string>,
});
