import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context as OpenAPIContext } from "openapi-backend";
import {
	getRequestCorrelationId,
	getRequestOrigin,
	resolveAllowedOrigin,
} from "./request-context.js";

const RAW_API_RESPONSE: unique symbol = Symbol("remit.rawApiResponse");

/**
 * A response the caller reads by something other than its JSON body — an
 * iCalendar feed, an OAuth redirect's Location, and whatever later joins them.
 *
 * Every other handler returns a plain object and lets this module decide the
 * status, the content type and the serialization. That is the right default and
 * stays the default; a handler that has to own its own media type or headers
 * says so with `rawApiResponse` rather than by returning a shape this one has
 * to guess at.
 * The CORS and correlation headers are still added here, so a raw response is
 * not a way around them.
 */
export interface RawApiResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

type MarkedRawApiResponse = RawApiResponse & {
	readonly [RAW_API_RESPONSE]: true;
};

export const rawApiResponse = (
	response: RawApiResponse,
): MarkedRawApiResponse =>
	Object.assign(response, { [RAW_API_RESPONSE]: true as const });

const isRawApiResponse = (
	body: Record<string, unknown>,
): body is MarkedRawApiResponse & Record<string, unknown> =>
	RAW_API_RESPONSE in body;

/**
 * The headers every response carries whatever its body is: the CORS grant the
 * browser needs, and the id the request's log lines are already tagged with.
 * Returning that id is what makes a bug report's "correlation id" resolve to a
 * server-side line; the browser can only read a non-safelisted header when it
 * is exposed.
 */
const envelopeHeaders = (): Record<string, string> => {
	const allowOrigin = resolveAllowedOrigin(getRequestOrigin());

	const headers: Record<string, string> = {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Headers": "Authorization,Content-Type",
		"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		Vary: "Origin",
	};

	if (allowOrigin !== "*") {
		headers["Access-Control-Allow-Credentials"] = "true";
	}

	const correlationId = getRequestCorrelationId();
	if (correlationId) {
		headers["x-correlation-id"] = correlationId;
		headers["Access-Control-Expose-Headers"] = "x-correlation-id";
	}

	return headers;
};

export const formatResponse = (
	body: Record<string, unknown>,
	statusCode = 200,
): APIGatewayProxyResult => {
	if (body.statusCode && typeof body.statusCode === "number") {
		statusCode = body.statusCode;
	}

	if (isRawApiResponse(body)) {
		logger.debug({ statusCode: body.statusCode }, "response");
		return {
			statusCode: body.statusCode,
			headers: { ...envelopeHeaders(), ...body.headers },
			body: body.body,
		};
	}

	if ("body" in body && body.body && typeof body.body === "object") {
		body = body.body as Record<string, unknown>;
	}

	logger.debug({ statusCode }, "response");

	return {
		statusCode: statusCode,
		headers: {
			"Content-Type": "application/json",
			...envelopeHeaders(),
		},
		body: JSON.stringify(body),
	};
};

export const postResponseHandler = (context: OpenAPIContext) => {
	const { api, response, operation } = context;

	if (response.statusCode) return formatResponse(response, response.statusCode);

	if (process.env.STAGE_NAME !== "dev") return formatResponse(response, 200);

	const { valid, errors } = api.validateResponse(response, operation);

	if (valid) return formatResponse(response, 200);

	const { operationId } = operation;

	const errorDetails: Record<string, unknown> = {
		errors,
		operationId,
		responseKeys: Object.keys(response),
	};

	errors?.forEach((error) => {
		if (error.instancePath) {
			const pathParts = error.instancePath.split("/").filter(Boolean);
			let value = response;
			for (const part of pathParts) {
				value = value?.[part];
			}
			errorDetails[`problematicValue_${error.instancePath}`] = {
				path: error.instancePath,
				value: JSON.stringify(value).substring(0, 500),
				error: error.message,
			};
		}
	});

	logger.error(errorDetails, "Response validation failed");

	return formatResponse(response, 200);
};
