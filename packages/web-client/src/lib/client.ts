import { client } from "@remit/api-http-client/client.gen.ts";
import { getRuntimeConfig } from "../runtime-config";
import { ApiError } from "./api";

// In production, the config.js apiUrl points at the deployed API Gateway.
// In local dev, the Vite proxy forwards /api -> localhost:4321 (see vite.config.ts).
const baseUrl = getRuntimeConfig().apiUrl;

client.setConfig({
	baseUrl,
});

/**
 * The hey-api client throws the parsed JSON error *body* on a non-ok response —
 * a shape with no HTTP status. That makes it impossible to tell a 404 (expected)
 * from a 500 (fatal) at the call site, which is the whole point of the fail-fast
 * classifier. This error interceptor re-wraps every HTTP error as an `ApiError`
 * carrying `response.status`, so `shouldEscalate` / `getErrorStatus` work
 * uniformly across both clients. The body's `message` is preserved on the
 * `ApiError` so existing message-prefix checks (e.g. `isMessageNotFoundError`)
 * keep working.
 */
client.interceptors.error.use((error, response) => {
	if (error instanceof ApiError) return error;
	if (!response) return error;

	const body = error;
	const message =
		body && typeof body === "object" && "message" in body
			? String((body as { message: unknown }).message)
			: `Request failed with status ${response.status}`;

	return new ApiError(message, response.status, body);
});

export { client };
