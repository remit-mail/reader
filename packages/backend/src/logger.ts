import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import pino from "pino";

export const logger = pino({
	level: process.env.LOG_LEVEL ?? "info",
	transport:
		process.env.NODE_ENV === "development"
			? { target: "pino-pretty" }
			: undefined,
});

export const withRequest = (
	event: APIGatewayProxyEvent,
	context: Context,
): void => {
	logger.setBindings({
		requestId: context.awsRequestId,
		path: event.path,
		method: event.httpMethod,
	});
};
