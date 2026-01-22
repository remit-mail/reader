import type { Context } from "aws-lambda";
import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL ?? "info";

export type Logger = pino.Logger;

/**
 * Simple console-based logger for local development.
 * Matches the pino.Logger interface for the methods we use.
 */
const createConsoleLogger = (
	bindings: Record<string, unknown> = {},
): Logger => {
	const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
	const currentLevelIndex = levels.indexOf(logLevel as (typeof levels)[number]);

	const shouldLog = (level: (typeof levels)[number]) => {
		return levels.indexOf(level) >= currentLevelIndex;
	};

	const formatMessage = (
		level: string,
		objOrMsg?: Record<string, unknown> | string,
		msg?: string,
	) => {
		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] ${level.toUpperCase()}`;

		if (typeof objOrMsg === "string") {
			return Object.keys(bindings).length > 0
				? `${prefix} ${objOrMsg} ${JSON.stringify(bindings)}`
				: `${prefix} ${objOrMsg}`;
		}

		const combined = { ...bindings, ...objOrMsg };
		const context =
			Object.keys(combined).length > 0 ? ` ${JSON.stringify(combined)}` : "";
		return msg ? `${prefix} ${msg}${context}` : `${prefix}${context}`;
	};

	const createLogMethod = (level: (typeof levels)[number]) => {
		return (objOrMsg?: Record<string, unknown> | string, msg?: string) => {
			if (!shouldLog(level)) return;
			const output = formatMessage(level, objOrMsg, msg);
			if (level === "error" || level === "fatal") {
				console.error(output);
			} else if (level === "warn") {
				console.warn(output);
			} else {
				console.log(output);
			}
		};
	};

	const logger = {
		trace: createLogMethod("trace"),
		debug: createLogMethod("debug"),
		info: createLogMethod("info"),
		warn: createLogMethod("warn"),
		error: createLogMethod("error"),
		fatal: createLogMethod("fatal"),
		child: (childBindings: Record<string, unknown>) =>
			createConsoleLogger({ ...bindings, ...childBindings }),
		level: logLevel,
	};

	return logger as unknown as Logger;
};

export const createLogger = (context?: Context): Logger => {
	if (isDevelopment) {
		const bindings = context
			? { requestId: context.awsRequestId, functionName: context.functionName }
			: {};
		return createConsoleLogger(bindings);
	}

	const logger = pino({
		level: logLevel,
	});

	if (context) {
		return logger.child({
			requestId: context.awsRequestId,
			functionName: context.functionName,
		});
	}

	return logger;
};
