import type { Context } from "aws-lambda";
import pino from "pino";

const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL ?? "info";

const serializeError = (err: Error): Record<string, unknown> => {
	const serialized: Record<string, unknown> = {
		name: err.name,
		message: err.message,
		stack: err.stack,
	};

	// Capture all enumerable properties (code, errno, syscall, custom props, etc.)
	for (const key of Object.keys(err)) {
		if (!(key in serialized)) {
			const value = (err as unknown as Record<string, unknown>)[key];
			serialized[key] = value instanceof Error ? serializeError(value) : value;
		}
	}

	// Handle cause separately since it's not enumerable
	if (err.cause) {
		serialized.cause =
			err.cause instanceof Error ? serializeError(err.cause) : err.cause;
	}

	return serialized;
};

const serializeValue = (value: unknown): unknown => {
	if (value instanceof Error) {
		return serializeError(value);
	}
	if (Array.isArray(value)) {
		return value.map(serializeValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, serializeValue(v)]),
		);
	}
	return value;
};

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

		const combined = serializeValue({ ...bindings, ...objOrMsg });
		const context =
			Object.keys(combined as object).length > 0
				? ` ${JSON.stringify(combined)}`
				: "";
		return msg ? `${prefix} ${msg}${context}` : `${prefix}${context}`;
	};

	const createLogMethod = (level: (typeof levels)[number]) => {
		return (objOrMsg?: Record<string, unknown> | string, msg?: string) => {
			if (!shouldLog(level)) return;
			const output = formatMessage(level, objOrMsg, msg);
			console.log(output);
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
