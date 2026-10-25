import { withTelemetry } from "@remit/logger-lambda/node";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { api } from "./api.js";
import { handlers, publicHandlers } from "./handlers/index.js";
import { serveApi } from "./serve.js";
import type { RemitClient } from "./service/data-client.js";

type TestApiHandler = (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;

export const servedApi = (client: RemitClient) => ({
	api,
	handler: withTelemetry(
		serveApi({ handlers, publicHandlers }, async () => client),
	) as unknown as TestApiHandler,
});
