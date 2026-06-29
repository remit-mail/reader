import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { logger, withTelemetry } from "@remit/logger-lambda";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import {
	type Document,
	OpenAPIBackend,
	type Context as OpenAPIContext,
	type Request,
} from "openapi-backend";
import { handleError } from "./error.js";
import { handlers } from "./handlers/index.js";
import { normalizeRequest } from "./request.js";
import { runWithRequestContext } from "./request-context.js";
import { formatResponse, postResponseHandler } from "./response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Last-resort net for a leaked background rejection.
 *
 * Every fire-and-forget side effect is meant to be contained at its source (see
 * service/fire-and-forget.ts), so reaching here is a bug — an uncontained
 * `void promise` somewhere. The API process (dev-server / warm Lambda container)
 * shares one event loop across requests, so without this handler such a leak
 * would surface as a spurious 500 on whatever request was in flight. We log it
 * LOUDLY with a distinct alert so it is observable, and deliberately do NOT exit
 * — a stray background rejection must never take the API down or fail a request.
 * (The worker process intentionally has no such net: there each message is its
 * own invocation and a rejection should crash it.)
 */
const unhandledRejectionRegistered = Symbol.for(
	"remit.backend.unhandledRejectionNet",
);
const globalProcess = process as unknown as Record<symbol, boolean>;
if (!globalProcess[unhandledRejectionRegistered]) {
	globalProcess[unhandledRejectionRegistered] = true;
	process.on("unhandledRejection", (reason: unknown) => {
		logger.error(
			{
				alert: "unhandled_rejection",
				errorName: (reason as { name?: string })?.name,
				errorCode:
					(reason as { Code?: string })?.Code ??
					(reason as { code?: string })?.code,
				error: inspect(reason),
			},
			"Unhandled promise rejection leaked into the API event loop (contained, request not failed)",
		);
	});
}

const loadOpenAPISpec = (): Document => {
	// Bundled Lambda: infra's NodeJSArmFunction copies openapi.json into the
	// bundle root next to the entrypoint via its `extraFiles` prop.
	const bundledPath = join(__dirname, "openapi.json");
	if (existsSync(bundledPath)) {
		return JSON.parse(readFileSync(bundledPath, "utf-8"));
	}

	// Dev (tsx / dev-server): read straight from the repo build tree.
	const devPath = join(__dirname, "../../../build/remit-openapi3/openapi.json");
	return JSON.parse(readFileSync(devPath, "utf-8"));
};

const OpenAPISpec = loadOpenAPISpec();

const api = new OpenAPIBackend({
	definition: OpenAPISpec,
	quick: true,
	// Coerce query/path params to their schema types. API Gateway delivers every
	// query param as a string; handlers cast them to number/boolean (e.g. `limit`,
	// `hasAttachment`) and forward them downstream. Without coercion a string
	// `limit` reaches ElectroDB's `.go({ limit })` and DynamoDB rejects the
	// numeric Limit field ("STRING_VALUE cannot be converted to Integer"), 500ing
	// /addresses/search and /search/semantic.
	coerceTypes: true,
});

api.register("postResponseHandler", postResponseHandler);

api.register("validationFail", (c: OpenAPIContext, req: Request) => {
	const operation = api.router.getOperation(c.operation?.operationId ?? "");
	logger.error(
		{
			errors: c.validation.errors,
			method: req.method,
			path: req.path,
			operation: c.operation?.operationId,
			operationParameters: operation?.parameters,
			validationContext: {
				parsedRequest: c.request,
				validationTarget: c.validation,
			},
		},
		"Validation failed",
	);
	return {
		statusCode: 400,
		body: {
			message: "Invalid request",
			errors: c.validation.errors,
		},
	};
});

api.register("notFound", () => ({ statusCode: 404 }));

api.register("notImplemented", async (c: OpenAPIContext) => {
	const { status, mock } = api.mockResponseForOperation(
		c.operation.operationId as string,
	);
	return formatResponse(mock as Record<string, unknown>, status);
});

api.register(handlers);

api.init();

export { api, OpenAPISpec };

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

const rawHandler = async (event: APIGatewayProxyEvent, context: Context) => {
	logger.setBindings({
		requestId: context.awsRequestId,
		path: event.path,
		method: event.httpMethod,
	});

	logger.debug(
		{ method: event.httpMethod, path: event.path },
		"Request received",
	);

	const origin = readOriginHeader(event.headers);

	return runWithRequestContext({ origin }, () =>
		api
			.handleRequest(normalizeRequest(event), event, context)
			.catch(handleError),
	);
};

export const handler = withTelemetry(rawHandler);
