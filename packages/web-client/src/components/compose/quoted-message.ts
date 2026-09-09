import type { RemitImapDescribeMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { type RichTextValue, wrapWithLanguage } from "@remit/ui";
import type { ComposeBodyMode } from "@remit/ui/rich-text";
import { formatDate } from "../../lib/format";

type Envelope = RemitImapDescribeMessageResponse["envelope"];
type EnvelopeAddress = Envelope["from"][number];

/** Whether the original is being answered or passed on. */
export type QuoteKind = "reply" | "forward";

/** The message being quoted, in both the representations a send carries. */
export interface QuotedBlock {
	text: string;
	html: string;
}

/**
 * The original's body as the content route hands it over: one part, either
 * HTML or plain text, never both. The other representation is derived here,
 * because a message goes out with both and HTML markup dropped into the
 * `text/plain` part arrives as visible tags.
 */
export type QuotedSourceBody =
	| { kind: "text"; content: string }
	| { kind: "html"; content: string };

export const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

export const textToHtml = (text: string): string =>
	text
		.split("\n")
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join("");

/**
 * Elements that end the line they are on. Everything else is inline and runs
 * into its neighbours, which is what separates a plain-text rendering of a
 * message from its `textContent` — that returns one long line with the words
 * of adjacent paragraphs joined together.
 */
const LINE_BREAKING_TAGS = new Set([
	"ADDRESS",
	"ARTICLE",
	"BLOCKQUOTE",
	"BR",
	"DIV",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HR",
	"LI",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"TABLE",
	"TR",
	"UL",
]);

const htmlToPlainText = (html: string): string => {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const lines: string[] = [];
	let line = "";

	const endLine = (): void => {
		lines.push(line.trim());
		line = "";
	};

	const visit = (node: Node): void => {
		if (node.nodeType === node.TEXT_NODE) {
			line += (node.textContent ?? "").replace(/\s+/g, " ");
			return;
		}
		if (node.nodeType !== node.ELEMENT_NODE) return;
		const breaks = LINE_BREAKING_TAGS.has((node as Element).tagName);
		if (breaks && line !== "") endLine();
		for (const child of node.childNodes) visit(child);
		if (breaks) endLine();
	};

	visit(parsed.body);
	if (line !== "") endLine();
	return lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
};

const addressLabel = (address: EnvelopeAddress): string =>
	address.displayName
		? `${address.displayName} <${address.normalizedEmail}>`
		: address.normalizedEmail;

const addressList = (addresses: readonly EnvelopeAddress[]): string =>
	addresses.map(addressLabel).join(", ");

/**
 * An absolute date, because the attribution outlives the moment it was written
 * — the relative form the message list uses would reach the recipient reading
 * "Yesterday" about a day that is no longer yesterday.
 */
const quotedDate = (date: Envelope["date"]): string =>
	formatDate(date, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	});

/** The form `snippet.ts` and the search chunker both recognise as a quote. */
const attributionLine = (envelope: Envelope): string => {
	const who = addressList(envelope.from) || "the sender";
	const when = quotedDate(envelope.date);
	if (!when) return `${who} wrote:`;
	return `On ${when}, ${who} wrote:`;
};

const FORWARD_RULE = "---------- Forwarded message ----------";

const forwardHeader = (envelope: Envelope): string[] => {
	const lines = [
		FORWARD_RULE,
		`From: ${addressList(envelope.from)}`,
		`Date: ${quotedDate(envelope.date)}`,
		`Subject: ${envelope.subject ?? ""}`,
		`To: ${addressList(envelope.to)}`,
	];
	if (envelope.cc.length > 0) lines.push(`Cc: ${addressList(envelope.cc)}`);
	return lines;
};

const quotePrefixed = (text: string): string[] =>
	text.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));

/**
 * The original, as the message being written will carry it. One value, so what
 * the composer shows under the editor is the same block that leaves for the
 * API rather than a second rendering of the same source (#845.5).
 *
 * A reply indents the original behind an attribution line; a forward passes it
 * on whole under the header block, because a forward is the original message
 * rather than a passage cited from it.
 */
export const buildQuotedBlock = (
	kind: QuoteKind,
	envelope: Envelope,
	body: QuotedSourceBody,
): QuotedBlock => {
	const bodyText =
		body.kind === "text" ? body.content.trim() : htmlToPlainText(body.content);
	const bodyHtml =
		body.kind === "html" ? body.content : textToHtml(body.content.trim());

	if (kind === "forward") {
		const header = forwardHeader(envelope);
		return {
			text: [...header, "", bodyText].join("\n"),
			html: `${textToHtml(header.join("\n"))}${bodyHtml}`,
		};
	}

	const attribution = attributionLine(envelope);
	return {
		text: [attribution, ...quotePrefixed(bodyText)].join("\n"),
		html: `<p>${escapeHtml(attribution)}</p><blockquote type="cite">${bodyHtml}</blockquote>`,
	};
};

const joinText = (written: string, quoted: string): string =>
	written === "" ? quoted : `${written}\n\n${quoted}`;

/**
 * What the two body columns carry for this mode.
 *
 * Plain mode writes the empty string rather than omitting `htmlBody`: absent
 * means "leave alone" at every layer below, so a plain draft that omitted it
 * would send the HTML it was written as before the switch. The empty string is
 * defined, so the repository's update guard clears the column, and nodemailer
 * branches on the value being truthy — an empty one builds no HTML alternative
 * and the message leaves as a single `text/plain` part. It is also why the
 * quote reaches a plain message through `textBody` alone: putting its markup in
 * `htmlBody` would reopen the draft as rich and send the recipient an HTML
 * alternative of a message written as plain text.
 *
 * Rich mode leaves `htmlBody` alone while it has nothing to say, so the moments
 * before the lazily-loaded editor reports its document cannot write a draft
 * back as plain. A quote is something to say, so a send pressed in those
 * moments still carries the message it quotes.
 */
export const outgoingBody = (
	bodyMode: ComposeBodyMode,
	body: RichTextValue,
	language: string,
	quoted: QuotedBlock | undefined,
): { textBody: string | undefined; htmlBody: string | undefined } => {
	const text = quoted ? joinText(body.text, quoted.text) : body.text;
	if (bodyMode === "plain")
		return { textBody: text || undefined, htmlBody: "" };
	const html = quoted ? `${body.html}${quoted.html}` : body.html;
	return {
		textBody: text || undefined,
		htmlBody: html ? wrapWithLanguage(html, language) : undefined,
	};
};
