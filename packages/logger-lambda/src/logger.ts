import type { Context } from "aws-lambda";
import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";

export type Logger = pino.Logger;

export const createLogger = (context?: Context): Logger => {
	const transport = isDevelopment
		? { target: "pino-pretty", options: { colorize: true } }
		: undefined;

	const logger = pino({
		level: process.env.LOG_LEVEL ?? "info",
		transport,
	});

	if (context) {
		return logger.child({
			requestId: context.awsRequestId,
			functionName: context.functionName,
		});
	}

	return logger;
};
