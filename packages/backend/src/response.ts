import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context as OpenAPIContext } from "openapi-backend";
import { logger } from "./logger.js";
import { getRequestOrigin, resolveAllowedOrigin } from "./request-context.js";

export const formatResponse = (
	body: Record<string, unknown>,
	statusCode = 200,
): APIGatewayProxyResult => {
	if (body.statusCode && typeof body.statusCode === "number") {
		statusCode = body.statusCode;
	}

	if ("body" in body && body.body && typeof body.body === "object") {
		body = body.body as Record<string, unknown>;
	}

	logger.info({ statusCode }, "response");

	const allowOrigin = resolveAllowedOrigin(getRequestOrigin());

	const corsHeaders: Record<string, string> = {
		"Access-Control-Allow-Origin": allowOrigin,
		"Access-Control-Allow-Headers": "Authorization,Content-Type",
		"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		Vary: "Origin",
	};

	if (allowOrigin !== "*") {
		corsHeaders["Access-Control-Allow-Credentials"] = "true";
	}

	return {
		statusCode: statusCode,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders,
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
