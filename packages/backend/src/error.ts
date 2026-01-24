import type { APIGatewayProxyResult } from "aws-lambda";
import { logger } from "./logger.js";
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
			logger.error(
				{ error: error.message, stack: error.stack },
				"ElectroError",
			);
			return formatResponse({ message: error.message }, 400);
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
