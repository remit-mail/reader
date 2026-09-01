import type { ApiError as ApiErrorWireBody } from "@remit/api-http-client/types.gen.ts";
import { taggedFetch } from "./network-error";

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public body?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/**
 * The wire body's coded half, re-checked at runtime. `ApiErrorWireBody` is the
 * generated flat shape the API sends; `ApiError` is the class every HTTP
 * failure arrives in, carrying that body at `.body`. Reading `code` off the
 * class is the bug #1004 is about, so nothing outside this module reaches for
 * either shape directly.
 */
export interface CodedApiErrorBody {
	code: ApiErrorWireBody["code"];
	details: Record<string, unknown> | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const codedApiErrorBody = (
	error: unknown,
): CodedApiErrorBody | undefined => {
	const body = error instanceof ApiError ? error.body : error;
	if (!isRecord(body)) return undefined;
	const { code, details } = body;
	if (typeof code !== "string") return undefined;
	return { code, details: isRecord(details) ? details : undefined };
};

const failureMessage = (body: unknown, status: number): string => {
	if (isRecord(body) && body.message !== undefined && body.message !== null) {
		const message = String(body.message);
		if (message) return message;
	}
	return `Request failed with status ${status}`;
};

/**
 * The one place an HTTP failure becomes an `ApiError`, so a test can hand a
 * consumer the exact value the error interceptor produces.
 */
export const wrapHttpFailure = (body: unknown, status: number): ApiError =>
	new ApiError(failureMessage(body, status), status, body);

interface RequestOptions extends Omit<RequestInit, "body"> {
	params?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
}

const buildUrl = (
	path: string,
	params?: Record<string, string | number | boolean | undefined>,
): string => {
	const url = new URL(path, window.location.origin);
	if (params) {
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined) {
				url.searchParams.set(key, String(value));
			}
		});
	}
	return url.toString();
};

const request = async <T>(
	method: string,
	path: string,
	options: RequestOptions = {},
): Promise<T> => {
	const { params, body, headers, ...rest } = options;

	const url = buildUrl(path, params);

	const response = await taggedFetch(url, {
		method,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: body ? JSON.stringify(body) : undefined,
		...rest,
	});

	if (!response.ok) {
		const errorBody = await response.json().catch(() => undefined);
		throw wrapHttpFailure(errorBody, response.status);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json();
};

export const api = {
	get: <T>(path: string, options?: RequestOptions) =>
		request<T>("GET", path, options),

	post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
		request<T>("POST", path, { ...options, body }),

	put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
		request<T>("PUT", path, { ...options, body }),

	patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
		request<T>("PATCH", path, { ...options, body }),

	delete: <T>(path: string, options?: RequestOptions) =>
		request<T>("DELETE", path, options),
};
