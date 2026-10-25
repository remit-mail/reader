import spec from "@remit/api-openapi-spec/openapi.json" with { type: "json" };
import { redactCalendarFeedPath } from "@remit/calendar-service";
import { logger, withLogContext } from "@remit/logger";
import type {
	APIGatewayProxyEvent,
	APIGatewayProxyResult,
	Context,
} from "aws-lambda";
import {
	type Document,
	OpenAPIBackend,
	type Context as OpenAPIContext,
	type Request,
} from "openapi-backend";
import {
	assertLocalBypassNotInDeployedEnv,
	getIdentityFromEvent,
} from "./auth.js";
import { usesBetterAuthJwt } from "./data-backend.js";
import { defaultErrorCode, handleError } from "./error.js";
import { handlers, publicHandlers } from "./handlers/index.js";
import { authenticateSelfHostRequest } from "./jwt-auth.js";
import { normalizeRequest } from "./request.js";
import { runWithRequestContext } from "./request-context.js";
import { formatResponse, postResponseHandler } from "./response.js";
import { getClient } from "./service/data-client.js";
import type { OperationHandler, PublicOperationHandler } from "./types.js";

// Boot-time refusal: the local auth-bypass overrides must never be set in a
// deployed environment. Runs on module load so a leaked env var fails the
// process at startup rather than silently opening authentication at runtime.
assertLocalBypassNotInDeployedEnv();

const isDocument = (value: unknown): value is Document =>
	typeof value === "object" &&
	value !== null &&
	"openapi" in value &&
	typeof value.openapi === "string" &&
	"paths" in value;

// Imported, not read from disk, so no host has to place openapi.json next to the
// entry point — a Worker has no filesystem to read it from.
if (!isDocument(spec)) {
	throw new Error("@remit/api-openapi-spec is not an OpenAPI document");
}
// Typed as a Document so importers do not see the JSON literal type.
export const OpenAPISpec: Document = spec;

const api: OpenAPIBackend = new OpenAPIBackend({
	definition: OpenAPISpec,
	quick: true,
	// Coerce query/path params to their schema types. API Gateway delivers every
	// query param as a string; handlers cast them to number/boolean (e.g. `limit`,
	// `hasAttachment`) and forward them downstream. Without coercion a string
	// `limit` reaches ElectroDB's `.go({ limit })` and DynamoDB rejects the
	// numeric Limit field ("STRING_VALUE cannot be converted to Integer"), 500ing
	// /addresses/search.
	coerceTypes: true,
});

api.register("postResponseHandler", postResponseHandler);

/**
 * The validator's findings, narrowed to the three fields `RequestValidationDetail`
 * declares. Copied field by field rather than passed through: an AJV error also
 * carries `params`, and under `verbose` the rejected `data` itself — which for a
 * refused request body is whatever the caller sent, a password among the
 * possibilities. Naming the fields is what keeps that off the wire.
 */
const validationDetails = (
	errors: OpenAPIContext["validation"]["errors"],
): Array<{ path: string; rule: string; message: string }> =>
	(errors ?? []).map((error) => ({
		path: error.instancePath,
		rule: error.keyword,
		message: error.message ?? "refused",
	}));

// The errors and the operation, and nothing that came off the wire. A request
// that fails validation is logged at error level, and the request it carries
// holds the caller's headers and cookies — an Authorization bearer among them,
// and for a calendar feed the token in the path is itself the credential
// (issue #1065). The path is redacted the same way the request scope redacts it.
api.register("validationFail", (c: OpenAPIContext, req: Request) => {
	logger.error(
		{
			errors: c.validation.errors,
			path: redactCalendarFeedPath(req.path),
			operation: c.operation?.operationId,
		},
		"Validation failed",
	);
	return {
		statusCode: 400,
		body: {
			code: defaultErrorCode(400),
			message: "Invalid request",
			errors: validationDetails(c.validation.errors),
		},
	};
});

api.register("notFound", () => ({
	statusCode: 404,
	body: { code: defaultErrorCode(404), message: "Not found" },
}));

api.register("notImplemented", async (c: OpenAPIContext) => {
	const { status, mock } = api.mockResponseForOperation(
		c.operation.operationId as string,
	);
	return formatResponse(mock as Record<string, unknown>, status);
});

const unauthenticated = () => ({
	statusCode: 401,
	body: { code: defaultErrorCode(401), message: "Unauthorized" },
});

const fromLambdaEvent =
	(handler: OperationHandler) =>
	async (c: OpenAPIContext, event: APIGatewayProxyEvent) => {
		const identity = getIdentityFromEvent(event);
		if (identity.kind === "anonymous") return unauthenticated();
		return handler(c, { client: await getClient(), identity });
	};

const publicFromLambdaEvent =
	(handler: PublicOperationHandler) =>
	async (c: OpenAPIContext, event: APIGatewayProxyEvent) =>
		handler(c, {
			client: await getClient(),
			identity: getIdentityFromEvent(event),
		});

api.register({
	...Object.fromEntries(
		Object.entries(handlers).map(([operationId, handler]) => [
			operationId,
			fromLambdaEvent(handler),
		]),
	),
	...Object.fromEntries(
		Object.entries(publicHandlers).map(([operationId, handler]) => [
			operationId,
			publicFromLambdaEvent(handler),
		]),
	),
});

api.init();

export { setLogger } from "@remit/logger";
export { api };

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
export const handleApiEvent = async (
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
