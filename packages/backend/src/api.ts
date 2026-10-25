import spec from "@remit/api-openapi-spec/openapi.json" with { type: "json" };
import { requestValidators } from "@remit/api-openapi-spec/request-validators";
import { redactCalendarFeedPath } from "@remit/calendar-service";
import { logger } from "@remit/logger";
import {
	type Document,
	OpenAPIBackend,
	type Context as OpenAPIContext,
} from "openapi-backend";
import { defaultErrorCode } from "./error.js";
import { postResponseHandler } from "./response.js";

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

// ajv compiles a validator with `new Function`, which a Cloudflare Worker
// refuses, so every init hands the router the validators codegen compiled ahead
// of time. A host may call init again; in quick mode it builds the validator
// before its first await, so the validators land before any request does.
class PrecompiledOpenAPIBackend extends OpenAPIBackend {
	override init(): Promise<this> {
		const initialized = super.init();
		for (const { operationId } of this.router.getOperations()) {
			if (!operationId || !Object.hasOwn(requestValidators, operationId)) {
				throw new Error(
					`No precompiled request validator for ${operationId}; run npm run codegen`,
				);
			}
			this.validator.requestValidators[operationId] =
				requestValidators[operationId];
		}
		return initialized;
	}
}

const api: OpenAPIBackend = new PrecompiledOpenAPIBackend({
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
api.register("validationFail", (c: OpenAPIContext) => {
	logger.error(
		{
			errors: c.validation.errors,
			path: redactCalendarFeedPath(c.request.path),
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
