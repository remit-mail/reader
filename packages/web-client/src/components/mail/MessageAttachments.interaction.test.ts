/**
 * The attachment list wired to the real download (#683): a click fetches the
 * part's `contentUrl` and hands the bytes to the browser under the sanitized
 * name, and a fetch that fails says what failed instead of doing nothing.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { messageOperationsDescribeMessageQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapBodyPartResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { MessageAttachments } from "./MessageAttachments";

let harness: DomHarness | undefined;
const originalFetch = globalThis.fetch;
const originalCreateElement = document.createElement.bind(document);
const objectUrls = globalThis.URL as unknown as {
	createObjectURL?: (blob: Blob) => string;
	revokeObjectURL?: (value: string) => void;
};
const originalCreateObjectURL = objectUrls.createObjectURL;
const originalRevokeObjectURL = objectUrls.revokeObjectURL;

afterEach(() => {
	harness?.close();
	harness = undefined;
	globalThis.fetch = originalFetch;
	document.createElement = originalCreateElement;
	objectUrls.createObjectURL = originalCreateObjectURL;
	objectUrls.revokeObjectURL = originalRevokeObjectURL;
});

const bodyParts = (
	...overrides: Partial<RemitImapBodyPartResponse>[]
): RemitImapBodyPartResponse[] =>
	overrides.map(
		(override, index) =>
			({
				bodyPartId: `part-${index + 1}`,
				mediaType: "APPLICATION",
				mediaSubtype: "PDF",
				sizeOctets: 4096,
				disposition: "attachment",
				dispositionFilename: "report.pdf",
				contentUrl: `https://cdn.test/content/parts/${index + 2}`,
				isMultipart: false,
				...override,
			}) as RemitImapBodyPartResponse,
	);

interface SavedFile {
	filename: string;
	url: string;
}

const captureSaves = (): SavedFile[] => {
	const saved: SavedFile[] = [];
	objectUrls.createObjectURL = () => "blob:test";
	objectUrls.revokeObjectURL = () => undefined;

	document.createElement = ((tag: string) => {
		const element = originalCreateElement(tag);
		if (tag === "a") {
			const anchor = element as HTMLAnchorElement;
			anchor.click = () =>
				saved.push({ filename: anchor.download, url: anchor.href });
		}
		return element;
	}) as typeof document.createElement;
	return saved;
};

const MESSAGE_ID = "msg-1";

const mount = (parts?: RemitImapBodyPartResponse[], hasAttachment = true) => {
	harness = createDomHarness();
	harness.renderApp(
		createElement(MessageAttachments, {
			messageId: MESSAGE_ID,
			bodyParts: parts,
			hasAttachment,
		}),
	);
	return harness;
};

describe("MessageAttachments", () => {
	it("lists each attachment part with a download control", () => {
		const dom = mount(
			bodyParts(
				{ dispositionFilename: "board-pack.pdf" },
				{
					dispositionFilename: "site-plan.png",
					mediaType: "IMAGE",
					mediaSubtype: "PNG",
					sizeOctets: 1024,
				},
			),
		);

		assert.match(dom.text(), /2 attachments/);
		assert.ok(dom.byLabel("Download board-pack.pdf"));
		assert.ok(dom.byLabel("Download site-plan.png"));
		assert.match(dom.text(), /PNG · 1 KB/);
	});

	it("renders nothing for a message with no attachments", () => {
		const dom = mount(
			bodyParts({ disposition: "inline", mediaSubtype: "HTML" }),
			false,
		);
		assert.equal(dom.html(), "");
	});

	it("downloads the part's content URL and saves it under the sanitized name", async () => {
		const requested: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requested.push(String(url));
			return new Response("payload", { status: 200 });
		}) as unknown as typeof fetch;
		const saved = captureSaves();

		const dom = mount(
			bodyParts({
				dispositionFilename: "../../../etc/passwd",
				contentUrl: "https://cdn.test/content/parts/2",
			}),
		);
		dom.click(dom.byLabel("Download passwd"));
		await dom.flush();

		assert.deepEqual(requested, ["https://cdn.test/content/parts/2"]);
		assert.deepEqual(saved, [{ filename: "passwd", url: "blob:test" }]);
	});

	it("states what failed and offers a retry instead of doing nothing", async () => {
		globalThis.fetch = (async () =>
			new Response("gone", {
				status: 404,
				statusText: "Not Found",
			})) as unknown as typeof fetch;

		const dom = mount(bodyParts({ dispositionFilename: "board-pack.pdf" }));
		dom.click(dom.byLabel("Download board-pack.pdf"));
		await dom.flush();

		const alert = dom.query('[data-testid="attachment-error"]');
		assert.ok(alert, "a failed download must render an alert");
		assert.match(alert.textContent ?? "", /missing from storage/);
		assert.match(alert.textContent ?? "", /Re-sync the account/);
		assert.match(alert.textContent ?? "", /Try again/);
		assert.match(alert.innerHTML, /issues\/new/);
	});

	it("retries the same part when the failure's retry is taken", async () => {
		let attempts = 0;
		globalThis.fetch = (async () => {
			attempts += 1;
			return attempts === 1
				? new Response("gone", { status: 404, statusText: "Not Found" })
				: new Response("payload", { status: 200 });
		}) as unknown as typeof fetch;
		const saved = captureSaves();

		const dom = mount(bodyParts({ dispositionFilename: "board-pack.pdf" }));
		dom.click(dom.byLabel("Download board-pack.pdf"));
		await dom.flush();

		dom.click(dom.byText("button", "Try again"));
		await dom.flush();

		assert.equal(attempts, 2);
		assert.deepEqual(saved, [{ filename: "board-pack.pdf", url: "blob:test" }]);
		assert.equal(dom.query('[data-testid="attachment-error"]'), null);
	});

	// The signed content URL outlives neither an hour nor a re-signing, and a
	// deferred part is materialized by the describe read itself. Re-hitting the
	// same URL cannot fix either, so the retry goes back through describeMessage
	// and uses the URL that read minted.
	it("renews the content URL through describeMessage when the link expired", async () => {
		const requested: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requested.push(String(url));
			return requested.length === 1
				? new Response("expired", {
						status: 403,
						headers: { "x-remit-403-reason": "expired" },
					})
				: new Response("payload", { status: 200 });
		}) as unknown as typeof fetch;
		const saved = captureSaves();

		const dom = mount(
			bodyParts({ contentUrl: "https://cdn.test/parts/2?exp=1&sig=old" }),
		);
		dom.queryClient.setQueryData(
			messageOperationsDescribeMessageQueryKey({
				path: { messageId: MESSAGE_ID },
			}),
			{
				bodyParts: bodyParts({
					contentUrl: "https://cdn.test/parts/2?exp=2&sig=new",
				}),
			},
		);

		dom.click(dom.byLabel("Download report.pdf"));
		await dom.flush();
		await dom.flush();

		assert.deepEqual(requested, [
			"https://cdn.test/parts/2?exp=1&sig=old",
			"https://cdn.test/parts/2?exp=2&sig=new",
		]);
		assert.equal(saved.length, 1);
		assert.equal(dom.query('[data-testid="attachment-error"]'), null);
	});

	it("does not re-read the message for a failure a re-read cannot fix", async () => {
		let attempts = 0;
		globalThis.fetch = (async () => {
			attempts += 1;
			return new Response("gone", { status: 404, statusText: "Not Found" });
		}) as unknown as typeof fetch;

		const dom = mount(bodyParts({}));
		dom.click(dom.byLabel("Download report.pdf"));
		await dom.flush();

		assert.equal(attempts, 1);
		assert.ok(dom.query('[data-testid="attachment-error"]'));
	});

	it("says so when the server flags an attachment no part describes", () => {
		const dom = mount([], true);
		assert.match(dom.text(), /none of its parts describe one/);
	});

	it("claims nothing while the message is still loading", () => {
		const dom = mount(undefined, true);
		assert.equal(dom.html(), "");
	});
});
