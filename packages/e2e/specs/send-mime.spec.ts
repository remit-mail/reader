/**
 * What a recipient actually receives.
 *
 * Every other spec about composing stops at the outbox row — the message as the
 * server holds it before anything serializes it. The MIME is built after that,
 * twice: `buildMailMessage` (smtp-service) produces the bytes that go on the
 * wire, and `buildRawMessage` (imap-worker) independently rebuilds the same
 * message to APPEND into Sent. Both ran unobserved until there was somewhere for
 * a submission to land, so a body that never made it into a part, a missing
 * `multipart/alternative`, or an HTML part surviving into a plain-text send were
 * all invisible — and the two builders drifting apart was invisible twice over.
 *
 * The sink is Mailpit, which accepts the submission and hands the accepted bytes
 * back over HTTP. Structure comes from Dovecot: both messages are parked in a
 * throwaway mailbox and read through BODYSTRUCTURE, so the wire copy and the
 * Sent copy are compared through a parser that knows nothing about either.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";
import {
	readMimeShape,
	readMimeShapeOfRaw,
	serverRawSourceForSubject,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const RECIPIENT = "recipient@remit.test";

/**
 * The headers both builds have to agree on, addressing and identity. Not `Date`:
 * the wire copy is stamped when the submission goes out and the Sent copy from
 * the moment the send was recorded, so the two legitimately differ by a second.
 */
const COMPARED_HEADERS = ["From", "To", "Subject", "Message-ID"];

const headersOf = (raw: string): Record<string, string> => {
	const head = raw.split(/\r?\n\r?\n/, 1)[0];
	// Unfold first: a long header continues on lines that start with whitespace,
	// and reading those as headers of their own loses the value's tail.
	const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
	const found: Record<string, string> = {};
	for (const line of unfolded.split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator < 0) continue;
		const name = line.slice(0, separator).trim().toLowerCase();
		const compared = COMPARED_HEADERS.find(
			(header) => header.toLowerCase() === name,
		);
		if (!compared) continue;
		found[compared] = line.slice(separator + 1).trim();
	}
	return found;
};

const PLAIN_TEXT = "Numbers attached. Nothing else to report.";
const RICH_TEXT = "The renewal lands on the 14th.";
const RICH_HTML = "<p>The renewal lands on the <strong>14th</strong>.</p>";

test.describe("A sent message on the wire", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Send MIME");
		api = new ApiClient(run);

		// The Sent copy is APPENDed to whichever mailbox carries the \Sent
		// special-use, and the worker skips the APPEND outright when the account
		// has no Sent folder yet. Dovecot creates one on first login, so this is a
		// wait on the sync having seen it, not on it existing.
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
	});

	test("a rich message goes out as multipart/alternative carrying both bodies", async () => {
		test.setTimeout(180_000);
		const subject = `Wire rich ${Date.now()}`;

		await api.sendMessage({
			accountId: run.accountId,
			toAddresses: [RECIPIENT],
			subject,
			textBody: RICH_TEXT,
			htmlBody: RICH_HTML,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const wire = await readMimeShapeOfRaw(accepted.raw);

		expect(wire.contentType).toBe("multipart/alternative");
		expect(wire.parts.map((part) => part.contentType)).toEqual([
			"text/plain",
			"text/html",
		]);
		expect(wire.parts[0].content.trim()).toBe(RICH_TEXT);
		expect(wire.parts[1].content.trim()).toBe(RICH_HTML);
	});

	test("a plain message goes out as text/plain with no HTML alternative", async () => {
		test.setTimeout(180_000);
		const subject = `Wire plain ${Date.now()}`;

		await api.sendMessage({
			accountId: run.accountId,
			toAddresses: [RECIPIENT],
			subject,
			textBody: PLAIN_TEXT,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const wire = await readMimeShapeOfRaw(accepted.raw);

		expect(wire.contentType).toBe("text/plain");
		expect(wire.parts.map((part) => part.contentType)).toEqual(["text/plain"]);
		expect(wire.parts[0].content.trim()).toBe(PLAIN_TEXT);

		// The negative is the point: an htmlBody the compose path failed to clear
		// would ride along as a second alternative and nothing above would notice.
		expect(accepted.raw).not.toContain("text/html");
	});

	test("the copy filed in Sent is the message that was sent", async () => {
		test.setTimeout(240_000);
		const subject = `Wire agreement ${Date.now()}`;

		await api.sendMessage({
			accountId: run.accountId,
			toAddresses: [RECIPIENT],
			subject,
			textBody: RICH_TEXT,
			htmlBody: RICH_HTML,
		});

		const accepted = await waitForAcceptedMessage(subject);

		const filed = await waitFor(
			() => readMimeShape(run.imapUser, "Sent", subject),
			(shape) => shape !== null,
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		if (!filed)
			throw new Error("unreachable: the Sent copy was matched as present");

		// Two independent builds of one message, so the comparison is on what the
		// recipient and the sender's own archive each end up holding — not on
		// bytes, which differ by MIME boundary and by the headers the sink stamps
		// on receipt.
		const wire = await readMimeShapeOfRaw(accepted.raw);
		expect(filed.contentType).toBe(wire.contentType);
		expect(filed.parts.map((part) => part.contentType)).toEqual(
			wire.parts.map((part) => part.contentType),
		);
		expect(filed.parts.map((part) => part.content.trim())).toEqual(
			wire.parts.map((part) => part.content.trim()),
		);

		// Who it is from, who it is to, and which message it is. A Message-ID each
		// builder minted for itself would split the conversation in every client
		// that threads by it.
		const filedSource = await serverRawSourceForSubject(
			run.imapUser,
			"Sent",
			subject,
		);
		expect(filedSource).not.toBeNull();
		const wireHeaders = headersOf(accepted.raw);
		expect(Object.keys(wireHeaders).sort()).toEqual(
			[...COMPARED_HEADERS].sort(),
		);
		expect(headersOf(filedSource ?? "")).toEqual(wireHeaders);
	});
});
