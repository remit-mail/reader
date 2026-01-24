// Load OpenAPI spec - in production this would be bundled
// For now, we read from the build directory
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import {
	type Document,
	OpenAPIBackend,
	type Context as OpenAPIContext,
	type Request,
} from "openapi-backend";
import { handleError } from "./error.js";
import { handlers } from "./handlers/index.js";
import { logger, withRequest } from "./logger.js";
import { normalizeRequest } from "./request.js";
import { postResponseHandler } from "./response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const loadOpenAPISpec = (): Document => {
	// Try multiple paths - dev vs bundled
	const paths = [
		join(__dirname, "../../../build/remit-openapi3/openapi.json"),
		join(__dirname, "../../build/remit-openapi3/openapi.json"),
		join(__dirname, "../openapi.json"),
	];

	for (const path of paths) {
		try {
			const content = readFileSync(path, "utf-8");
			return JSON.parse(content);
		} catch {
			// Try next path
		}
	}

	throw new Error("Could not load OpenAPI spec");
};

const OpenAPISpec = loadOpenAPISpec();

const api = new OpenAPIBackend({
	definition: OpenAPISpec,
	quick: true,
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
	return {
		statusCode: status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		body: JSON.stringify(mock),
	};
});

api.register(handlers);

api.init();

export { api, OpenAPISpec };

export const handler = async (
	event: APIGatewayProxyEvent,
	context: Context,
) => {
	withRequest(event, context);

	logger.info(
		{ method: event.httpMethod, path: event.path },
		"Request received",
	);

	return api
		.handleRequest(normalizeRequest(event), event, context)
		.catch(handleError);
};
