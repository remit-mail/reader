import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import type { Request as OpenAPIRequest } from "openapi-backend";
import { getIdentityFromEvent } from "./auth.js";
import type { ApiConfig } from "./config/api-config.js";
import { identityFromSelfHostRequest } from "./jwt-auth.js";
import { normalizeRequest } from "./request.js";
import type { ServedApi } from "./serve.js";
import type { RemitClient } from "./service/data-client.js";
import type { QueueName } from "./service/queues.js";
import type { HandlerIdentity } from "./types.js";

export interface ApiEventHandlerOptions<K extends QueueName> {
	config: ApiConfig;
	localIdentity: HandlerIdentity;
	client: () => Promise<RemitClient<K>>;
}

export type ApiEventHandler = (
	event: APIGatewayProxyEvent,
	context: Context,
) => Promise<APIGatewayProxyResult>;

const queryOf = (
	event: APIGatewayProxyEvent,
): Record<string, readonly string[] | undefined> => {
	if (event.multiValueQueryStringParameters) {
		return event.multiValueQueryStringParameters;
	}
	return Object.fromEntries(
		Object.entries(event.queryStringParameters ?? {}).map(([key, value]) => [
			key,
			value === undefined ? undefined : [value],
		]),
	);
};

const headersOf = (
	event: APIGatewayProxyEvent,
): Record<string, string | undefined> => ({
	...event.headers,
	...Object.fromEntries(
		Object.entries(event.multiValueHeaders ?? {}).map(([name, values]) => [
			name,
			values?.join(", "),
		]),
	),
});

const normalizeApiGatewayEvent = (
	event: APIGatewayProxyEvent,
): OpenAPIRequest =>
	normalizeRequest({
		method: event.httpMethod,
		path: event.path,
		query: queryOf(event),
		headers: headersOf(event),
		body: event.body,
	});

export const createApiEventHandler =
	<K extends QueueName>(
		served: ServedApi<K>,
		{ config, localIdentity, client }: ApiEventHandlerOptions<NoInfer<K>>,
	): ApiEventHandler =>
	(event, context) =>
		served.dispatch(
			normalizeApiGatewayEvent(event),
			{
				config,
				client,
				identity: async () =>
					config.auth.mode === "BetterAuthJwt"
						? identityFromSelfHostRequest(event, localIdentity)
						: getIdentityFromEvent(event, localIdentity),
			},
			context.awsRequestId,
		);
