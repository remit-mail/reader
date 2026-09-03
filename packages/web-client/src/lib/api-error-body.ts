import type { ApiErrorBody } from "@remit/api-http-client/types.gen.ts";
import { ApiError } from "./api";

/**
 * The coded body of a failed request, wherever it arrives.
 *
 * Every HTTP failure reaches a call site as an `ApiError` carrying the wire
 * body at `.body` — both clients wrap it, `client.ts`'s error interceptor for
 * the generated one and `api.ts`'s own `request` for the other. Reading `code`
 * off the top level therefore matches nothing, which is how the appointment
 * prompt shipped dead (#1004). The flat form is accepted too, because a body
 * read straight off a response is still the same shape.
 */
export const apiErrorBody = (
	error: unknown,
): Partial<ApiErrorBody> | undefined => {
	const candidate = error instanceof ApiError ? error.body : error;
	if (typeof candidate !== "object" || candidate === null) return undefined;
	return candidate as Partial<ApiErrorBody>;
};

/**
 * Wrap a failed request as an `ApiError`. The hey-api client throws the parsed
 * JSON body, which carries no HTTP status, so a call site cannot tell a 404
 * from a 500 — the whole point of the fail-fast classifier. Registered as the
 * generated client's error interceptor in `client.ts`, and exported here so a
 * test can exercise the shape a call site actually receives rather than the
 * flat body the wire declares.
 */
export const toApiError = (error: unknown, response?: Response): unknown => {
	if (error instanceof ApiError) return error;
	if (!response) return error;

	const message =
		typeof error === "object" && error !== null && "message" in error
			? String((error as { message: unknown }).message)
			: `Request failed with status ${response.status}`;

	return new ApiError(message, response.status, error);
};

export const apiErrorDetail = (
	details: ApiErrorBody["details"],
	key: string,
): string | undefined => {
	const value = details?.[key];
	return typeof value === "string" ? value : undefined;
};
