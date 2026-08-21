import { isPublicApiError } from "@remit/data-ports/errors";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyResult } from "aws-lambda";
import { formatResponse } from "./response.js";

export const handleError = async (
	error: unknown,
): Promise<APIGatewayProxyResult> => {
	if (error instanceof Error) {
		if ("statusCode" in error) {
			logger.error(
				{
					error: error.message,
					statusCode: error.statusCode,
					stack: error.stack,
				},
				"Error with statusCode",
			);
			// Only an error that opted in gets a coded body, and only below 500:
			// a coded 5xx is a mistake at the throw site, not a contract, and the
			// status bound keeps it from reaching a client rather than trusting
			// every future thrower to leave `publicApiError` alone.
			const statusCode =
				typeof error.statusCode === "number" ? error.statusCode : 500;
			const publicApiError =
				statusCode < 500 &&
				"publicApiError" in error &&
				isPublicApiError(error.publicApiError)
					? error.publicApiError
					: undefined;
			return formatResponse(
				{ message: error.message, ...publicApiError },
				statusCode,
			);
		}

		if (error.name === "ElectroError") {
			// DynamoDB client/infrastructure errors should be 500
			// These contain "aws-error" in the message or reference URL
			const isInfrastructureError =
				error.message.includes("aws-error") ||
				error.message.includes("DynamoDB client");

			const statusCode = isInfrastructureError ? 500 : 400;
			const logMessage = isInfrastructureError
				? "DynamoDB infrastructure error"
				: "ElectroError";

			logger.error({ error: error.message, stack: error.stack }, logMessage);

			// Don't expose internal details for infrastructure errors
			const responseMessage = isInfrastructureError
				? "Database temporarily unavailable"
				: error.message;

			return formatResponse({ message: responseMessage }, statusCode);
		}

		logger.error(
			{ error: error.message, name: error.name, stack: error.stack },
			"Unhandled Error",
		);
		return formatResponse({ message: "Internal server error" }, 500);
	}

	logger.error({ error: JSON.stringify(error) }, "Unknown error type");
	return formatResponse({ message: "Internal server error" }, 500);
};
