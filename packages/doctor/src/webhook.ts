import { attempt } from "./attempt.js";
import type { Fetcher } from "./scrape.js";
import type { CheckResult, Verdict } from "./verdict.js";

/**
 * D12. One URL, one template, one content type — not an integration registry.
 *
 * The default template is Slack-shaped JSON, which Mattermost and Discord also
 * accept. A plain-text content type covers ntfy and anything else that takes a
 * raw body. A named integration per provider — a Slack block builder, a Discord
 * embed, a Teams card — makes every provider our maintenance; a template covers
 * providers we have never heard of, and the operator owns it.
 *
 * Substitutions are `{{verdict}}`, `{{summary}}` and `{{reasons}}`. Anything
 * else in braces is left alone, so a template can carry the literal braces some
 * targets use.
 */
export const PLACEHOLDERS = ["verdict", "summary", "reasons"] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

const DEFAULT_JSON_TEMPLATE = '{"text":"{{summary}}\\n{{reasons}}"}';
const DEFAULT_TEXT_TEMPLATE = "{{summary}}\n{{reasons}}";

export const isJsonContentType = (contentType: string): boolean =>
	contentType.toLowerCase().includes("json");

/**
 * JSON string escaping for a value that lands between quotes the template
 * supplies. `JSON.stringify` handles the quote, the backslash, the newline and
 * every control character in one pass, and stripping its own quotes is what
 * makes it composable into a template rather than a whole document.
 *
 * A malformed payload fails silently under D8 — the transition is spent and the
 * next thing the operator hears is the recovery — so this is the one place in
 * the alert path where getting it wrong costs an outage nobody is told about.
 */
export const escapeFor =
	(contentType: string): ((value: string) => string) =>
	(value) =>
		isJsonContentType(contentType) ? JSON.stringify(value).slice(1, -1) : value;

/**
 * `\n` and `\t` in a plain-text template become real characters. A `.env` file
 * has no escape sequences and compose passes the value through verbatim, so
 * without this a multi-line plain-text template cannot be configured at all. A
 * JSON template is left exactly as written — JSON has its own escapes and
 * rewriting them here would corrupt the document.
 */
export const expandTemplate = (
	template: string,
	contentType: string,
): string =>
	isJsonContentType(contentType)
		? template
		: template.replace(/\\n/g, "\n").replace(/\\t/g, "\t");

export const defaultTemplate = (contentType: string): string =>
	isJsonContentType(contentType)
		? DEFAULT_JSON_TEMPLATE
		: DEFAULT_TEXT_TEMPLATE;

export const render = (
	template: string,
	values: Readonly<Record<Placeholder, string>>,
	escapeValue: (value: string) => string,
): string =>
	template.replace(
		/\{\{(verdict|summary|reasons)\}\}/g,
		(_match, name: Placeholder) => escapeValue(values[name]),
	);

/**
 * The payload's whole vocabulary: a verdict, a headline, and the reason
 * summaries. D10 — no address, no subject, no sender, no message id, no folder
 * name, and no account id. `Reason.detail`, which holds the account ids, is
 * structurally out of reach here: this function never receives it.
 */
export const payloadValues = (
	result: CheckResult,
): Record<Placeholder, string> => ({
	verdict: result.verdict,
	summary: result.summary,
	reasons:
		result.reasons.length === 0
			? "no problems found"
			: result.reasons.map((reason) => `• ${reason.summary}`).join("\n"),
});

export interface WebhookRequest {
	readonly url: string;
	readonly template: string | undefined;
	readonly contentType: string;
	readonly timeoutMs: number;
}

export const buildBody = (
	result: CheckResult,
	template: string | undefined,
	contentType: string,
): string =>
	render(
		expandTemplate(template ?? defaultTemplate(contentType), contentType),
		payloadValues(result),
		escapeFor(contentType),
	);

/**
 * What happened to one delivery attempt, split by whether attempting again
 * could plausibly work.
 *
 * `rejected` is a decision the endpoint made about this payload — a template
 * the operator wrote wrong, a revoked URL. Repeating it produces the same
 * answer forever, so the transition is spent and the operator gets one error
 * line naming the status.
 *
 * `unreachable` is not a decision. A timeout, a refused connection, a 5xx or a
 * 429 says nothing about the payload, and a transition dropped for one of them
 * is an outage nobody is ever told about: the dead-man's switch cannot catch it,
 * because it is a different URL at a different provider and it keeps answering
 * 200 while the webhook is down.
 */
export type Delivery =
	| { readonly kind: "sent" }
	| { readonly kind: "rejected"; readonly detail: string }
	| { readonly kind: "unreachable"; readonly detail: string };

// 429 is the endpoint asking for later, not refusing the content.
const isRetryable = (status: number): boolean =>
	status >= 500 || status === 429;

export const postWebhook = async (
	request: WebhookRequest,
	result: CheckResult,
	fetcher: Fetcher = fetch,
): Promise<Delivery> => {
	const attempted = await attempt(
		fetcher(request.url, {
			method: "POST",
			headers: { "content-type": request.contentType },
			body: buildBody(result, request.template, request.contentType),
			signal: AbortSignal.timeout(request.timeoutMs),
		}),
	);
	if (!attempted.ok) {
		return { kind: "unreachable", detail: attempted.error };
	}
	const { status } = attempted.value;
	if (attempted.value.ok) return { kind: "sent" };
	return isRetryable(status)
		? { kind: "unreachable", detail: `HTTP ${status}` }
		: { kind: "rejected", detail: `HTTP ${status}` };
};

export type { Verdict };
