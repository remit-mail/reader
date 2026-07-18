import { messageOperationsDescribeMessageQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchAuthToken } from "@/auth/auth-token";
import {
	type BodyContentKind,
	pickRenderablePart,
	type RenderableBodyPart,
} from "@/lib/message-body-source";
import { useTelemetry } from "@/lib/telemetry-context";
import { messageKeys } from "./queries/keys";

export interface MessageBodyContent {
	kind: BodyContentKind;
	body: string;
}

/**
 * Discriminated reason for a body-fetch failure. The SPA uses this to render
 * a diagnostic banner instead of a generic "Failed to load (403 Forbidden)"
 * string (issue #401 / postmortem #394).
 *
 * - `auth`  — Lambda@Edge denied the request (missing/invalid/expired token,
 *             cross-tenant). The edge sets `x-remit-403-reason` on the deny
 *             response; the user needs to sign in again.
 * - `body-missing` — CloudFront returned a 403/404 with no edge reason header,
 *             which means the request passed the JWT check and S3 had no
 *             object at that key. The S3 bucket policy (OAC) only grants
 *             `s3:GetObject`, so a missing key surfaces as 403 instead of 404
 *             — both shapes are normalised to `body-missing` here.
 * - `content-type-mismatch` — server returned text/html for a plain-text part
 *             (defensive guard against a misconfigured edge or bucket-policy
 *             bypass smuggling HTML into the renderer).
 * - `spa-shell-leak` — CloudFront 403/404 fallback rewrote the response into
 *             the SPA shell HTML. The infra fix (#310) prevents this; this
 *             guard catches a regression.
 * - `not-ready` — the body is not synced yet. The content route answers 202 +
 *             `Retry-After` while the worker (re)fetches it from IMAP; the query
 *             retries on this reason and only surfaces a banner if it never
 *             lands.
 * - `generic` — any other non-2xx, or a fetch-level failure (e.g. offline).
 */
export type BodyFetchReason =
	| "auth"
	| "body-missing"
	| "content-type-mismatch"
	| "spa-shell-leak"
	| "not-ready"
	| "generic";

/**
 * Error thrown by `fetchBodyContent`. Carries a discriminated `reason` so the
 * UI can render a specific banner (see MessageBody). Also exposes the HTTP
 * `status` (when applicable) for log breadcrumbs / debugging.
 */
export class BodyFetchError extends Error {
	readonly reason: BodyFetchReason;
	readonly status?: number;
	/** Seconds to wait before retrying — set from `Retry-After` on a 202. */
	readonly retryAfterSeconds?: number;

	constructor(
		reason: BodyFetchReason,
		message: string,
		status?: number,
		retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "BodyFetchError";
		this.reason = reason;
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * Parse a `Retry-After` header (delta-seconds form) into a bounded number of
 * seconds. Falls back to 1s when the header is absent or unparseable, and caps
 * the delay so a hostile/huge value can't wedge the query.
 */
export const parseRetryAfterSeconds = (headerValue: string | null): number => {
	const parsed = Number.parseInt(headerValue ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return 1;
	return Math.min(parsed, 30);
};

/** Max 202 retries before the body-fetch surfaces a `not-ready` banner. */
export const MAX_NOT_READY_RETRIES = 8;

/**
 * The header set by the Lambda@Edge JWT verifier on its deny responses. When
 * present on a 401/403 the failure was an edge-level auth denial; when absent
 * on a 403/404 the failure originated from the S3 origin (object missing).
 * See `infra/constructs/cloudfront/remit-content-delivery/lambda-edge/jwt.ts`.
 */
const REASON_HEADER = "x-remit-403-reason";

/**
 * Classify a fetch response into a `BodyFetchReason`. Pure so the
 * discrimination can be unit-tested without mocking the network.
 *
 * - 401 → always `auth` (Lambda@Edge denies missing/invalid tokens with 401).
 * - 403 with `x-remit-403-reason` → `auth` (Lambda@Edge tenant-mismatch etc).
 * - 403/404 without the reason header → `body-missing` (S3 origin response).
 * - Anything else → `generic`.
 *
 * Known corner case: CloudFront itself can emit a bare 403 for WAF block,
 * geo-restriction, or signed-URL/cookie failures (none of which we use
 * today, but a future WAF attachment would change that). Those bare-403s
 * also lack `x-remit-403-reason` and therefore classify as `body-missing` —
 * misleading copy, but the user-facing fix is the same in practice
 * (contact support / check status). If WAF is ever added on `/content/*`,
 * revisit and either set a distinct header on the WAF deny or branch on
 * the `X-Amz-Cf-Id` / `Server: CloudFront` headers.
 */
export const classifyBodyFetchFailure = (
	status: number,
	reasonHeader: string | null,
): BodyFetchReason => {
	const edgeReason = reasonHeader?.trim() ?? "";
	if (status === 401) return "auth";
	if (status === 403) return edgeReason.length > 0 ? "auth" : "body-missing";
	if (status === 404) return "body-missing";
	return "generic";
};

/**
 * Defensive guard against the CloudFront-rewrites-403/404-to-/index.html
 * edge case. The infra fix (#310 review) already scopes the SPA-fallback
 * rewrite to the default behaviour only, so `/content/*` 403/404 responses
 * propagate as their real status. This guard is belt-and-suspenders: if a
 * future infra change re-introduces a distribution-wide errorResponse the
 * hook still refuses to hand the SPA shell to the email renderer.
 *
 * Pure (no React, no fetch) so the assertion can be unit-tested without
 * mocking the network.
 */
export const isSpaShellResponse = (
	body: string,
	contentType: string | null,
): boolean => {
	const ct = (contentType ?? "").toLowerCase();
	if (!ct.startsWith("text/html")) return false;
	// `<div id="root"></div>` is the SPA's React mount node and uniquely
	// identifies the index.html shell. The marker is stable across builds
	// (it's the documented React 19 mount target) and absent from any
	// well-formed inbound email.
	return /<div\s+id=["']root["']/i.test(body);
};

/**
 * Validate that the Content-Type matches what the picker expected. text/plain
 * parts must never come back as text/html — the dev-server emits
 * application/octet-stream and CloudFront serves whatever Content-Type S3
 * stored, neither of which is text/html for a plain-text part. Catching the
 * mismatch here means a misconfigured edge or a bucket-policy bypass can't
 * smuggle HTML into the renderer.
 */
export const isContentTypeMismatch = (
	expected: BodyContentKind,
	contentType: string | null,
): boolean => {
	const ct = (contentType ?? "").toLowerCase();
	if (expected === "text" && ct.startsWith("text/html")) return true;
	return false;
};

/**
 * Fetch the renderable body part (HTML preferred, plain-text fallback) for a
 * message via CloudFront. The Lambda@Edge JWT verifier (`/content/*`) accepts
 * both `Cookie: id_token=…` and `Authorization: Bearer …`; same-origin
 * cookies aren't set in the SPA today, so we forward the session bearer token
 * from the auth seam via the Authorization header — same pattern as the API
 * auth interceptor.
 *
 * Throws on non-2xx so the surrounding `useQuery` exposes `isError` and the
 * caller can render an alert banner. Never silently substitutes an empty
 * body — the user must know the difference between "empty" and "failed"
 * (memory: feedback_never_hide_failure).
 */
export const fetchBodyContent = async (
	url: string,
	expected: BodyContentKind,
): Promise<string> => {
	const headers: Record<string, string> = {};
	const token = await fetchAuthToken();
	if (token) headers.Authorization = `Bearer ${token}`;
	const response = await fetch(url, { headers });
	// 202 = the body is not synced yet. The content route has re-armed the sync
	// cue; retry after `Retry-After` seconds rather than rendering the placeholder
	// body (a 202 is `ok`, so this must be caught before the success path).
	if (response.status === 202) {
		throw new BodyFetchError(
			"not-ready",
			"Message body is still syncing",
			202,
			parseRetryAfterSeconds(response.headers.get("Retry-After")),
		);
	}
	if (!response.ok) {
		const edgeReason = response.headers.get(REASON_HEADER);
		const reason = classifyBodyFetchFailure(response.status, edgeReason);
		throw new BodyFetchError(
			reason,
			`Failed to load message body (${response.status} ${response.statusText})`,
			response.status,
		);
	}
	const contentType = response.headers.get("content-type");
	if (isContentTypeMismatch(expected, contentType)) {
		throw new BodyFetchError(
			"content-type-mismatch",
			`Refusing to render message body — expected ${expected}, got Content-Type ${contentType}`,
		);
	}
	const body = await response.text();
	if (isSpaShellResponse(body, contentType)) {
		throw new BodyFetchError(
			"spa-shell-leak",
			"Refusing to render message body — response looks like the SPA shell (CloudFront 403/404 fallback leaked through to /content/*)",
		);
	}
	return body;
};

export interface BodyContentAttemptDeps {
	fetchContent: (url: string, kind: BodyContentKind) => Promise<string>;
	refetchDescribeMessage: () => Promise<unknown>;
}

/**
 * Fetches one attempt at the renderable body part. `isRetryAfterNotReady`
 * marks an attempt that follows a 202 `not-ready` response (after honoring
 * `Retry-After`) — on that attempt, refetch the describe query *before*
 * re-hitting the content URL.
 *
 * Under `DEFER_BODY_PARTS` (default on) the body-sync worker only writes
 * `body.eml`; per-part storage objects are materialized as a side effect of
 * the describe read path (`materializeBodyParts`, backend `describeMessage`).
 * Re-hitting the same part URL alone can never progress past a 202 within one
 * open — the describe refetch is what actually creates the missing object
 * server-side (remit-mail/remit#1240).
 */
export const fetchBodyContentAttempt = async (
	deps: BodyContentAttemptDeps,
	args: {
		contentUrl: string;
		kind: BodyContentKind;
		isRetryAfterNotReady: boolean;
	},
): Promise<string> => {
	if (args.isRetryAfterNotReady) {
		await deps.refetchDescribeMessage();
	}
	return deps.fetchContent(args.contentUrl, args.kind);
};

interface UseMessageBodyContentOptions {
	messageId?: string;
	bodyParts?: readonly RenderableBodyPart[];
	enabled?: boolean;
}

/**
 * React-query wrapper that picks the renderable body part for a message and
 * fetches it. Returns `picked = null` (no error) when the message has no
 * renderable text/html part — e.g. an attachment-only message — so the
 * caller can render an empty-state affordance without surfacing an error.
 */
export const useMessageBodyContent = ({
	messageId,
	bodyParts,
	enabled = true,
}: UseMessageBodyContentOptions) => {
	const picked = bodyParts ? pickRenderablePart(bodyParts) : null;
	const telemetry = useTelemetry();
	const loadStartRef = useRef<number | null>(null);
	const queryClient = useQueryClient();
	// Set by `retryDelay` when a `not-ready` (202) failure is being retried, and
	// consumed by the next `queryFn` call — see `fetchBodyContentAttempt`.
	const pendingDescribeRefetchRef = useRef(false);

	// A new message/part invalidates any pending describe-refetch left over from
	// the previous query — it belongs to a retry sequence that no longer
	// applies. Adjusted during render (React's documented pattern for resetting
	// state derived from a changing prop) rather than a useEffect, so the reset
	// is visible to the very next queryFn call instead of racing it.
	const bodyQueryKeyRef = useRef<string | null>(null);
	const bodyQueryKey =
		messageId && picked ? `${messageId}:${picked.contentUrl}` : null;
	if (bodyQueryKeyRef.current !== bodyQueryKey) {
		bodyQueryKeyRef.current = bodyQueryKey;
		pendingDescribeRefetchRef.current = false;
	}

	const query = useQuery({
		queryKey: messageId
			? [...messageKeys.body(messageId), picked?.contentUrl ?? null]
			: ["messages", "body", "noop"],
		queryFn: () => {
			if (!picked) throw new Error("No renderable body part");
			if (!messageId) throw new Error("No messageId");
			const isRetryAfterNotReady = pendingDescribeRefetchRef.current;
			pendingDescribeRefetchRef.current = false;
			return fetchBodyContentAttempt(
				{
					fetchContent: fetchBodyContent,
					refetchDescribeMessage: () =>
						queryClient.refetchQueries({
							queryKey: messageOperationsDescribeMessageQueryKey({
								path: { messageId },
							}),
						}),
				},
				{
					contentUrl: picked.contentUrl,
					kind: picked.kind,
					isRetryAfterNotReady,
				},
			);
		},
		enabled: enabled && !!messageId && !!picked,
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		// A `not-ready` (202) body is still syncing — keep retrying with the
		// server's `Retry-After` delay until it lands. Every other error keeps the
		// app-wide default (retry once) so a real failure surfaces its banner
		// promptly instead of hanging on repeated attempts.
		retry: (failureCount, error) => {
			if (error instanceof BodyFetchError && error.reason === "not-ready") {
				return failureCount < MAX_NOT_READY_RETRIES;
			}
			return failureCount < 1;
		},
		retryDelay: (_attempt, error) => {
			if (error instanceof BodyFetchError && error.reason === "not-ready") {
				pendingDescribeRefetchRef.current = true;
				return (error.retryAfterSeconds ?? 1) * 1000;
			}
			return 1000;
		},
		// A missing/forbidden body (404/403 body-missing, auth) renders the inline
		// MessageBodyErrorBanner below — a single sub-resource failure must not nuke
		// the whole app to the fatal overlay. A 5xx still escalates globally
		// (meta.softError is ignored for 5xx — #1059 / #1231 / #1232).
		meta: { softError: true },
	});

	const isLoading = query.isLoading && !!picked;

	useEffect(() => {
		if (isLoading) {
			loadStartRef.current = performance.now();
		}
	}, [isLoading]);

	useEffect(() => {
		if (query.isSuccess && loadStartRef.current !== null) {
			telemetry.recordTiming(
				"message.body.load",
				Math.round(performance.now() - loadStartRef.current),
			);
			loadStartRef.current = null;
		}
	}, [query.isSuccess, telemetry]);

	const data: MessageBodyContent | undefined =
		query.data && picked ? { kind: picked.kind, body: query.data } : undefined;

	return {
		picked,
		data,
		isLoading,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
};
