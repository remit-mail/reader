import { useQuery } from "@tanstack/react-query";
import { fetchAuthSession } from "aws-amplify/auth";
import { isCognitoConfigured } from "@/auth/amplify-config";
import {
	type BodyContentKind,
	pickRenderablePart,
	type RenderableBodyPart,
} from "@/lib/message-body-source";
import { messageKeys } from "./queries/keys";

export interface MessageBodyContent {
	kind: BodyContentKind;
	body: string;
}

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
 * cookies aren't set in the SPA today, so we forward the Cognito ID token
 * via the Authorization header — same pattern as the API auth interceptor.
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
	if (isCognitoConfigured()) {
		const session = await fetchAuthSession();
		const token = session.tokens?.idToken?.toString();
		if (token) headers.Authorization = `Bearer ${token}`;
	}
	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(
			`Failed to load message body (${response.status} ${response.statusText})`,
		);
	}
	const contentType = response.headers.get("content-type");
	if (isContentTypeMismatch(expected, contentType)) {
		throw new Error(
			`Refusing to render message body — expected ${expected}, got Content-Type ${contentType}`,
		);
	}
	const body = await response.text();
	if (isSpaShellResponse(body, contentType)) {
		throw new Error(
			"Refusing to render message body — response looks like the SPA shell (CloudFront 403/404 fallback leaked through to /content/*)",
		);
	}
	return body;
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
	const query = useQuery({
		queryKey: messageId
			? [...messageKeys.body(messageId), picked?.contentUrl ?? null]
			: ["messages", "body", "noop"],
		queryFn: () => {
			if (!picked) throw new Error("No renderable body part");
			return fetchBodyContent(picked.contentUrl, picked.kind);
		},
		enabled: enabled && !!messageId && !!picked,
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
	});

	const data: MessageBodyContent | undefined =
		query.data && picked ? { kind: picked.kind, body: query.data } : undefined;

	return {
		picked,
		data,
		isLoading: query.isLoading && !!picked,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
};
