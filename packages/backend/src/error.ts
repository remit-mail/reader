import { isPublicApiError } from "@remit/data-ports/errors";
import { logger } from "@remit/logger-lambda";
import type { APIGatewayProxyResult } from "aws-lambda";
import { formatResponse } from "./response.js";

/**
 * The `code` a refusal carries when it does not name its own. Every error body
 * the API emits is flat `{ code, message }` (issue #371), and `code` is the
 * only field a client may branch on — a message is a sentence for a person and
 * is free to change.
 *
 * A 5xx always answers `internal_error`, whatever the throw site said: a coded
 * 5xx is a mistake at the throw site, not a contract, and a fixed token cannot
 * carry anything about the failure out of the process.
 */
export const INTERNAL_ERROR_CODE = "internal_error";

/**
 * The one sentence any 5xx answers with. A thrown message is written for a log
 * line, not for a stranger — it names hosts, queries and ids — so it is
 * replaced rather than trusted. The real message is already on the error log
 * beside the correlation id the response carries.
 */
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

const CODE_BY_STATUS: Record<number, string> = {
	400: "invalid_request",
	401: "unauthorized",
	403: "forbidden",
	404: "not_found",
	409: "conflict",
	412: "precondition_failed",
	413: "payload_too_large",
	422: "unprocessable_entity",
};

export const defaultErrorCode = (statusCode: number): string => {
	if (statusCode >= 500) return INTERNAL_ERROR_CODE;
	return CODE_BY_STATUS[statusCode] ?? "request_refused";
};

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
			// An error that opted in names its own code and details, and only below
			// 500: the status bound keeps a coded 5xx from reaching a client rather
			// than trusting every future thrower to leave `publicApiError` alone.
			// Everything else takes the status class's code, so no response goes out
			// without one. A 5xx keeps neither the thrower's code nor its message —
			// one status, one code, one sentence, whatever failed.
			const statusCode =
				typeof error.statusCode === "number" ? error.statusCode : 500;
			if (statusCode >= 500) {
				return formatResponse(
					{ code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE },
					statusCode,
				);
			}
			const publicApiError =
				"publicApiError" in error && isPublicApiError(error.publicApiError)
					? error.publicApiError
					: undefined;
			return formatResponse(
				{
					code: defaultErrorCode(statusCode),
					message: error.message,
					...publicApiError,
				},
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

			return formatResponse(
				{ code: defaultErrorCode(statusCode), message: responseMessage },
				statusCode,
			);
		}

		logger.error(
			{ error: error.message, name: error.name, stack: error.stack },
			"Unhandled Error",
		);
		return formatResponse(
			{ code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE },
			500,
		);
	}

	logger.error({ error: JSON.stringify(error) }, "Unknown error type");
	return formatResponse(
		{ code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE },
		500,
	);
};
