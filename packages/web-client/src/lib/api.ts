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

	const response = await fetch(url, {
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
		throw new ApiError(
			errorBody?.message || `Request failed with status ${response.status}`,
			response.status,
			errorBody,
		);
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
