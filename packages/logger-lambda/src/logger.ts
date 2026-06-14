import { Logger as PowertoolsLogger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { Context } from "aws-lambda";

type LogBindings = Record<string, unknown>;

type PowertoolsLevel =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "critical";

const isBindings = (value: unknown): value is LogBindings =>
	typeof value === "object" && value !== null;

const emit = (
	target: PowertoolsLogger,
	level: PowertoolsLevel,
	first: LogBindings | string,
	second?: LogBindings | string,
): void => {
	if (typeof first !== "string") {
		const message = typeof second === "string" ? second : "";
		target[level](message, first);
		return;
	}
	if (second === undefined) {
		target[level](first);
		return;
	}
	if (typeof second === "string") {
		target[level](first, second);
		return;
	}
	target[level](first, second);
};

export interface Logger {
	trace(obj: LogBindings, msg?: string): void;
	trace(msg: string, obj?: LogBindings): void;
	debug(obj: LogBindings, msg?: string): void;
	debug(msg: string, obj?: LogBindings): void;
	info(obj: LogBindings, msg?: string): void;
	info(msg: string, obj?: LogBindings): void;
	warn(obj: LogBindings, msg?: string): void;
	warn(msg: string, obj?: LogBindings): void;
	error(obj: LogBindings, msg?: string): void;
	error(msg: string, obj?: LogBindings): void;
	fatal(obj: LogBindings, msg?: string): void;
	fatal(msg: string, obj?: LogBindings): void;
	child(bindings: LogBindings): Logger;
	setBindings(bindings: LogBindings): void;
}

const createAdapter = (target: PowertoolsLogger): Logger => ({
	trace: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "trace", first, second),
	debug: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "debug", first, second),
	info: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "info", first, second),
	warn: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "warn", first, second),
	error: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "error", first, second),
	fatal: (first: LogBindings | string, second?: LogBindings | string): void =>
		emit(target, "critical", first, second),
	child: (bindings: LogBindings): Logger => {
		const childLogger = target.createChild();
		if (isBindings(bindings)) {
			childLogger.appendPersistentKeys(bindings);
		}
		return createAdapter(childLogger);
	},
	setBindings: (bindings: LogBindings): void => {
		target.appendPersistentKeys(bindings);
	},
});

export const logger = new PowertoolsLogger({
	serviceName: process.env.POWERTOOLS_SERVICE_NAME ?? "remit",
});

export const metrics = new Metrics({
	namespace: process.env.POWERTOOLS_METRICS_NAMESPACE ?? "Remit",
	serviceName: process.env.POWERTOOLS_SERVICE_NAME ?? "remit",
});

export const createLogger = (_context?: Context): Logger =>
	createAdapter(logger);

export const withTelemetry = <TEvent, TResult>(
	handler: (event: TEvent, context: Context) => Promise<TResult>,
): ((event: TEvent, context: Context) => Promise<TResult>) => {
	return async (event: TEvent, context: Context): Promise<TResult> => {
		logger.addContext(context);
		logger.info("Lambda invocation started", {
			functionName: context.functionName,
		});

		metrics.captureColdStartMetric();

		const start = Date.now();

		try {
			const result = await handler(event, context);
			const duration = Date.now() - start;

			metrics.addMetric("invocationCount", MetricUnit.Count, 1);
			metrics.addMetric("invocationLatency", MetricUnit.Milliseconds, duration);

			return result;
		} catch (err) {
			metrics.addMetric("errorCount", MetricUnit.Count, 1);
			logger.error("Lambda invocation failed", { error: err });
			throw err;
		} finally {
			metrics.publishStoredMetrics();
		}
	};
};
