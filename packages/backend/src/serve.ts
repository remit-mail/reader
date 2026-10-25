import { redactCalendarFeedPath } from "@remit/calendar-service";
import { logger, withLogContext } from "@remit/logger";
import type { APIGatewayProxyResult } from "aws-lambda";
import type {
	Context as OpenAPIContext,
	Request as OpenAPIRequest,
} from "openapi-backend";
import { api } from "./api.js";
import type { ApiConfig } from "./config/api-config.js";
import { defaultErrorCode, handleError } from "./error.js";
import { normalizeRequest } from "./request.js";
import { envelopeHeaders } from "./response.js";
import type { RemitClient } from "./service/data-client.js";
import type { QueueName } from "./service/queues.js";
import type {
	HandlerIdentity,
	OperationHandler,
	OperationIds,
	PublicOperationHandler,
	PublicOperationIds,
} from "./types.js";

export type { ApiConfig } from "./config/api-config.js";
export type {
	HandlerContext,
	HandlerIdentity,
	PublicHandlerContext,
	UserIdentity,
} from "./types.js";

const unauthenticated = () => ({
	statusCode: 401,
	body: { code: defaultErrorCode(401), message: "Unauthorized" },
});

export interface RequestHost<K extends QueueName> {
	config: ApiConfig;
	client: () => Promise<RemitClient<K>>;
	identity: () => Promise<HandlerIdentity>;
}

/**
 * The operations a host serves, each typed by the queues it sends to. An
 * operation the host leaves out answers 501.
 */
export interface ApiRegistry<K extends QueueName> {
	handlers: Partial<
		Record<
			Exclude<OperationIds, PublicOperationIds>,
			OperationHandler<OperationIds, K>
		>
	>;
	publicHandlers: Partial<
		Record<PublicOperationIds, PublicOperationHandler<K>>
	>;
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const entriesOf = <T>(record: Partial<Record<string, T>>): Array<[string, T]> =>
	Object.entries(record).flatMap(([key, value]) =>
		isDefined(value) ? [[key, value]] : [],
	);

export interface ServedApi<K extends QueueName> {
	dispatch: (
		request: OpenAPIRequest,
		host: RequestHost<K>,
		correlationId: string,
	) => Promise<APIGatewayProxyResult>;
	handleFetch: (
		request: Request,
		host: RequestHost<K>,
		correlationId: string,
	) => Promise<Response>;
}

/**
 * Register a host's operations and return the two ways in: a normalised
 * request, or a Fetch `Request`. Each request's host supplies the client, and
 * the client's queues must cover every operation in the registry.
 */
export const serveApi = <K extends QueueName>(
	registry: ApiRegistry<NoInfer<K>>,
): ServedApi<K> => {
	api.register({
		...Object.fromEntries(
			entriesOf(registry.handlers).map(([operationId, handler]) => [
				operationId,
				async (c: OpenAPIContext, host: RequestHost<K>) => {
					const identity = await host.identity();
					if (identity.kind === "anonymous") return unauthenticated();
					return handler(c, {
						client: await host.client(),
						identity,
						config: host.config,
					});
				},
			]),
		),
		...Object.fromEntries(
			entriesOf(registry.publicHandlers).map(([operationId, handler]) => [
				operationId,
				async (c: OpenAPIContext, host: RequestHost<K>) =>
					handler(c, { client: await host.client(), config: host.config }),
			]),
		),
	});
	return { dispatch, handleFetch };
};

const readHeader = (
	headers: OpenAPIRequest["headers"],
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === name && typeof value === "string") return value;
	}
	return undefined;
};

const dispatch = async (
	request: OpenAPIRequest,
	host: { config: ApiConfig },
	correlationId: string,
): Promise<APIGatewayProxyResult> => {
	// A calendar feed carries its credential in the path, so the raw path is a
	// secret and cannot be a log field (issue #1065). Redacted once, here, where
	// every line inside the request picks it up from the scope.
	const path = redactCalendarFeedPath(request.path);
	const { method } = request;

	return withLogContext({ path, method }, async () => {
		logger.debug({ method, path }, "Request received");

		const startedAt = Date.now();
		const answered: APIGatewayProxyResult = await api
			.handleRequest(request, host)
			.catch(handleError);
		const result: APIGatewayProxyResult = {
			...answered,
			headers: {
				...envelopeHeaders({
					origin: readHeader(request.headers, "origin"),
					allowedOrigins: host.config.corsAllowedOrigins,
					correlationId,
				}),
				...answered.headers,
			},
		};

		// One structured access line per request: method, path, status, and
		// duration. The correlation id is inlined as a top-level field so a bug
		// report quoting the id can grep logs by it directly, and emitted at
		// info so it is on by default in production (the debug "Request
		// received" above already filters out under normal log levels).
		// biome-ignore lint/plugin/no-logger-info: one access line per request is an audit-grade signal (issue #1054)
		logger.info(
			{
				method,
				path,
				statusCode: result.statusCode,
				durationMs: Date.now() - startedAt,
				correlationId,
			},
			"Request completed",
		);

		return result;
	});
};

const queryOf = (
	params: URLSearchParams,
): Record<string, readonly string[]> => {
	const query: Record<string, string[]> = {};
	for (const [key, value] of params) {
		query[key] = [...(query[key] ?? []), value];
	}
	return query;
};

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const toFetchResponse = (result: APIGatewayProxyResult): Response => {
	const headers = new Headers();
	for (const [name, value] of Object.entries(result.headers ?? {})) {
		headers.set(name, String(value));
	}
	for (const [name, values] of Object.entries(result.multiValueHeaders ?? {})) {
		for (const value of values) headers.append(name, String(value));
	}
	const body = NULL_BODY_STATUSES.has(result.statusCode) ? null : result.body;
	return new Response(body, { status: result.statusCode, headers });
};

const handleFetch = async (
	request: Request,
	host: { config: ApiConfig },
	correlationId: string,
): Promise<Response> => {
	const url = new URL(request.url);
	const body = request.body === null ? null : await request.text();
	const result = await dispatch(
		normalizeRequest({
			method: request.method,
			path: url.pathname,
			query: queryOf(url.searchParams),
			headers: Object.fromEntries(request.headers),
			body,
		}),
		host,
		correlationId,
	);
	return toFetchResponse(result);
};
