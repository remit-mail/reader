import type { APIGatewayProxyResult } from "aws-lambda";
import type { Context as OpenAPIContext } from "openapi-backend";
import { logger } from "./logger.js";

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

	logger.info({ statusCode, body }, "response");

	return {
		statusCode: statusCode,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
		body: JSON.stringify(body),
	};
};

export const postResponseHandler = (context: OpenAPIContext) => {
	const { api, response, operation } = context;

	if (response.statusCode) return formatResponse(response, response.statusCode);

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

	if (["dev", "prod", "beta", "alpha"].includes(process.env.STAGE_NAME ?? ""))
		return formatResponse(response, 200);

	return formatResponse({ message: "Internal Server Error" }, 500);
};
