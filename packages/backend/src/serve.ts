import { redactCalendarFeedPath } from "@remit/calendar-service";
import { logger, withLogContext } from "@remit/logger";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import type { Context as OpenAPIContext } from "openapi-backend";
import { api } from "./api.js";
import { getIdentityFromEvent } from "./auth.js";
import { usesBetterAuthJwt } from "./data-backend.js";
import { defaultErrorCode, handleError } from "./error.js";
import { authenticateSelfHostRequest } from "./jwt-auth.js";
import { normalizeRequest } from "./request.js";
import { runWithRequestContext } from "./request-context.js";
import type { RemitClient } from "./service/data-client.js";
import type { QueueName } from "./service/queues.js";
import type {
	OperationHandler,
	OperationIds,
	PublicOperationHandler,
	PublicOperationIds,
} from "./types.js";

const unauthenticated = () => ({
	statusCode: 401,
	body: { code: defaultErrorCode(401), message: "Unauthorized" },
});

export interface ApiRegistry<K extends QueueName> {
	handlers: Partial<
		Record<
			Exclude<OperationIds, PublicOperationIds>,
			OperationHandler<OperationIds, K>
		>
	>;
	publicHandlers: Partial<
		Record<PublicOperationIds, PublicOperationHandler<K>>
	>;
}

export type ApiEventHandler = (
	event: APIGatewayProxyEvent,
	context: Context,
) => Promise<APIGatewayProxyResult>;

const entriesOf = <T>(record: Partial<Record<string, T>>): Array<[string, T]> =>
	Object.entries(record).flatMap(([key, value]) =>
		value === undefined ? [] : [[key, value]],
	);

export const serveApi = <K extends QueueName>(
	registry: ApiRegistry<NoInfer<K>>,
	client: () => Promise<RemitClient<K>>,
): ApiEventHandler => {
	api.register({
		...Object.fromEntries(
			entriesOf(registry.handlers).map(([operationId, handler]) => [
				operationId,
				async (c: OpenAPIContext, event: APIGatewayProxyEvent) => {
					const identity = getIdentityFromEvent(event);
					if (identity.kind === "anonymous") return unauthenticated();
					return handler(c, { client: await client(), identity });
				},
			]),
		),
		...Object.fromEntries(
			entriesOf(registry.publicHandlers).map(([operationId, handler]) => [
				operationId,
				async (c: OpenAPIContext) => handler(c, { client: await client() }),
			]),
		),
	});
	return handleApiEvent;
};

const readOriginHeader = (
	headers: APIGatewayProxyEvent["headers"],
): string | undefined => {
	if (!headers) return undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "origin" && typeof value === "string") {
			return value;
		}
	}
	return undefined;
};

// A scope, not `logger.setBindings`: this process serves requests concurrently,
// and bindings on the shared logger belong to whichever request wrote them last,
// so a line gets attributed to the wrong request. The scope follows the request
// through its own async continuations and nothing else. It nests inside the one
// `withTelemetry` opens, which is where `requestId` comes from.
const handleApiEvent = async (
	event: APIGatewayProxyEvent,
	context: Context,
): Promise<APIGatewayProxyResult> => {
	// A calendar feed carries its credential in the path, so the raw path is a
	// secret and cannot be a log field (issue #1065). Redacted once, here, where
	// every line inside the request picks it up from the scope.
	const path = redactCalendarFeedPath(event.path);

	return withLogContext(
		{
			path,
			method: event.httpMethod,
		},
		async () => {
			logger.debug({ method: event.httpMethod, path }, "Request received");

			const origin = readOriginHeader(event.headers);
			const startedAt = Date.now();
			// Capture the correlation id here: it is seeded by
			// runWithRequestContext below (from context.awsRequestId), but that
			// AsyncLocalStorage scope does not reliably survive the
			// openapi-backend handleRequest call chain, so we read it from
			// `context.awsRequestId` directly rather than via
			// getRequestCorrelationId at log time.
			const correlationId = context.awsRequestId;

			const result = await runWithRequestContext(
				{ origin, correlationId },
				async () => {
					if (usesBetterAuthJwt()) {
						const denied = await authenticateSelfHostRequest(event);
						if (denied) return denied;
					}

					return api
						.handleRequest(normalizeRequest(event), event, context)
						.catch(handleError);
				},
			);

			// One structured access line per request: method, path, status, and
			// duration. The correlation id is inlined as a top-level field so a bug
			// report quoting the id can grep logs by it directly, and emitted at
			// info so it is on by default in production (the debug "Request
			// received" above already filters out under normal log levels).
			// biome-ignore lint/plugin/no-logger-info: one access line per request is an audit-grade signal (issue #1054)
			logger.info(
				{
					method: event.httpMethod,
					path,
					statusCode: result.statusCode,
					durationMs: Date.now() - startedAt,
					correlationId,
				},
				"Request completed",
			);

			return result;
		},
	);
};
