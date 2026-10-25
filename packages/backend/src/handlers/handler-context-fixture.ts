import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Context } from "openapi-backend";
import { handlerContextFromEvent } from "../handler-context.js";
import type { RemitClient } from "../service/data-client.js";
import type { OperationHandler } from "../types.js";

export const bindHandlers =
	(client: () => RemitClient) =>
	<R = Record<string, unknown>>(handler: OperationHandler) =>
	(context: Context, event: APIGatewayProxyEvent): Promise<R> =>
		handler(context, handlerContextFromEvent(client(), event)) as Promise<R>;
