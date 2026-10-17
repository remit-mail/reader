import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AttachmentList, type AttachmentListProps } from "./attachment-list.js";

const render = (
	props: Omit<AttachmentListProps, "onToggleOpen"> &
		Partial<Pick<AttachmentListProps, "onToggleOpen">>,
): string =>
	renderToString(
		createElement(AttachmentList, { onToggleOpen: () => undefined, ...props }),
	);

const item = (
	overrides: Partial<AttachmentListProps["attachments"][number]>,
) => ({
	attachmentId: "part-1",
	kind: "file" as const,
	filename: "Quarterly report.pdf",
	typeLabel: "PDF",
	sizeOctets: 1024 * 512,
	download: { status: "idle" } as const,
	...overrides,
});

describe("AttachmentList", () => {
	it("gives every attachment a labelled download control", () => {
		const html = render({
			attachments: [
				item({}),
				item({ attachmentId: "part-2", filename: "photo.png" }),
			],
			onDownload: () => undefined,
		});
		assert.match(html, /aria-label="Download Quarterly report\.pdf"/);
		assert.match(html, /aria-label="Download photo\.png"/);
		assert.match(html, /2 attachments/);
	});

	it("counts a single attachment in the singular", () => {
		const html = render({
			attachments: [item({})],
			onDownload: () => undefined,
		});
		assert.match(html, /1 attachment</);
	});

	it("disables the control while a download is in flight", () => {
		const html = render({
			attachments: [item({ download: { status: "downloading" } })],
			onDownload: () => undefined,
		});
		assert.match(html, /disabled=""/);
	});

	it("states what failed, the likely fix, and offers a retry", () => {
		const html = render({
			attachments: [
				item({
					download: {
						status: "failed",
						title: "Your session expired",
						detail: "Sign in again, then download it once more.",
					},
				}),
			],
			onDownload: () => undefined,
		});
		assert.match(html, /role="alert"/);
		assert.match(html, /Your session expired/);
		assert.match(html, /Sign in again, then download it once more\./);
		assert.match(html, /Try again/);
	});

	it("offers a report link when the failure came with one", () => {
		const html = render({
			attachments: [
				item({
					download: {
						status: "failed",
						title: "Couldn't download this attachment",
						detail: "The server refused the request.",
						reportUrl:
							"https://github.com/remit-mail/reader/issues/new?title=x",
					},
				}),
			],
			onDownload: () => undefined,
		});
		assert.match(html, /Report this/);
		assert.match(html, /issues\/new\?title=x/);
	});

	it("says so when the server promised an attachment no part describes", () => {
		const html = render({
			attachments: [],
			onDownload: () => undefined,
			hasUnlistedAttachment: true,
		});
		assert.match(html, /carries an attachment, but none of/);
		assert.match(html, /Attachment</);
	});

	it("opens a forwarded message in place and still offers to save it", () => {
		const forwarded = item({
			attachmentId: "part-2",
			kind: "message",
			filename: "forwarded.eml",
		});
		const closed = render({
			attachments: [forwarded],
			onDownload: () => undefined,
			onToggleOpen: () => undefined,
		});
		assert.match(closed, /aria-label="Open forwarded\.eml"/);
		assert.match(closed, /aria-expanded="false"/);
		assert.match(closed, /aria-label="Download forwarded\.eml"/);
		assert.doesNotMatch(closed, /data-testid="forwarded-message"/);

		const open = render({
			attachments: [forwarded],
			onDownload: () => undefined,
			onToggleOpen: () => undefined,
			opened: {
				attachmentId: "part-2",
				content: createElement("p", null, "Original message body"),
			},
		});
		assert.match(open, /aria-label="Close forwarded\.eml"/);
		assert.match(open, /aria-expanded="true"/);
		assert.match(
			open,
			/data-testid="forwarded-message"[^>]*>.*Original message body/,
		);
	});
});
