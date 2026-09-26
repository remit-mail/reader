import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ComposeActionBar } from "./compose-action-bar.js";
import {
	type ComposeAttachmentItem,
	ComposeAttachments,
} from "./compose-attachments.js";

const render = (items: ComposeAttachmentItem[]): string =>
	renderToString(
		createElement(ComposeAttachments, {
			items,
			onRemove: () => undefined,
			onRetry: () => undefined,
		}),
	);

const item = (
	overrides: Partial<ComposeAttachmentItem> = {},
): ComposeAttachmentItem => ({
	key: "att-1",
	filename: "report.pdf",
	sizeBytes: 1024 * 512,
	state: { status: "attached" },
	...overrides,
});

describe("ComposeAttachments", () => {
	it("renders nothing for a draft with no files", () => {
		assert.equal(render([]), "");
	});

	it("names each file and its size, with a labelled control to remove it", () => {
		const html = render([item()]);
		assert.match(html, /report\.pdf/);
		assert.match(html, /512 KB/);
		assert.match(html, /aria-label="Remove report\.pdf"/);
	});

	it("says a file is still uploading", () => {
		assert.match(
			render([item({ state: { status: "uploading" } })]),
			/Uploading/,
		);
	});

	it("states a refusal and offers no retry when the same file would be refused again", () => {
		const html = render([
			item({
				state: {
					status: "failed",
					reason:
						'"report.pdf" is 30.0 MB, over the 25.0 MB a message can carry.',
					retryable: false,
				},
			}),
		]);
		assert.match(html, /role="alert"/);
		assert.match(html, /over the 25\.0 MB a message can carry/);
		assert.doesNotMatch(html, /Try again/);
	});

	it("offers a retry for an upload that can succeed on a second attempt", () => {
		const html = render([
			item({
				state: {
					status: "failed",
					reason: '"report.pdf" did not finish uploading.',
					retryable: true,
				},
			}),
		]);
		assert.match(html, /Try again/);
	});
});

describe("ComposeActionBar attach control", () => {
	const baseProps = {
		send: { status: "ready" } as const,
		onSend: () => undefined,
		onBlocked: () => undefined,
		onDiscard: () => undefined,
	};

	it("offers a file picker taking several files when the composer can attach", () => {
		const html = renderToString(
			createElement(ComposeActionBar, {
				...baseProps,
				onAttach: () => undefined,
			}),
		);
		assert.match(html, /aria-label="Attach files"/);
		assert.match(html, /type="file"/);
		assert.match(html, /multiple=""/);
	});

	it("offers no attach control where the composer cannot attach", () => {
		const html = renderToString(createElement(ComposeActionBar, baseProps));
		assert.doesNotMatch(html, /Attach files/);
	});
});
