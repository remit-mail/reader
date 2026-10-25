import { withTelemetry } from "@remit/logger-lambda/node";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { ApiConfig } from "./config/api-config.js";
import { handlers, publicHandlers } from "./handlers/index.js";
import { type ApiEventHandler, createApiEventHandler } from "./lambda.js";
import { serveApi } from "./serve.js";
import type { RemitClient } from "./service/data-client.js";
import type { HandlerIdentity } from "./types.js";

type TestApiHandler = (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;

export const lambdaHandler = (
	client: () => Promise<RemitClient>,
	config: ApiConfig,
	localIdentity: HandlerIdentity = { kind: "anonymous" },
): ApiEventHandler =>
	createApiEventHandler(serveApi({ handlers, publicHandlers }), {
		config,
		localIdentity,
		client,
	});

export const telemetryHandler = (
	client: RemitClient,
	config: ApiConfig,
): TestApiHandler =>
	withTelemetry(
		lambdaHandler(async () => client, config),
	) as unknown as TestApiHandler;
