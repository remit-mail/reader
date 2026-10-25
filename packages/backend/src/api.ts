import spec from "@remit/api-openapi-spec/openapi.json" with { type: "json" };
import { redactCalendarFeedPath } from "@remit/calendar-service";
import { logger } from "@remit/logger";
import {
	type Document,
	OpenAPIBackend,
	type Context as OpenAPIContext,
	type Request,
} from "openapi-backend";
import { assertLocalBypassNotInDeployedEnv } from "./auth.js";
import { defaultErrorCode } from "./error.js";
import { postResponseHandler } from "./response.js";

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

api.register("notImplemented", () => ({
	statusCode: 501,
	body: { code: defaultErrorCode(501), message: "Not implemented" },
}));

api.init();

export { setLogger } from "@remit/logger";
export { api };
