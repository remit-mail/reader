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
			return formatResponse(
				{ message: error.message },
				error.statusCode as number,
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
