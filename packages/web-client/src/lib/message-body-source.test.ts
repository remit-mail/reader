import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	pickRenderablePart,
	type RenderableBodyPart,
} from "./message-body-source";

const make = (overrides: Partial<RenderableBodyPart>): RenderableBodyPart => ({
	partPath: "1",
	mediaType: "TEXT",
	mediaSubtype: "PLAIN",
	contentUrl: "https://cdn.test/content/x",
	isMultipart: false,
	...overrides,
});

describe("pickRenderablePart", () => {
	it("prefers the first text/html part over text/plain", () => {
		const html = make({
			mediaSubtype: "HTML",
			contentUrl: "https://cdn.test/html",
		});
		const text = make({
			mediaSubtype: "PLAIN",
			contentUrl: "https://cdn.test/text",
		});
		const picked = pickRenderablePart([text, html]);
		assert.deepEqual(picked, {
			kind: "html",
			contentUrl: "https://cdn.test/html",
		});
	});

	it("falls back to text/plain when no html part exists", () => {
		const text = make({
			mediaSubtype: "PLAIN",
			contentUrl: "https://cdn.test/text",
		});
		const picked = pickRenderablePart([text]);
		assert.deepEqual(picked, {
			kind: "text",
			contentUrl: "https://cdn.test/text",
		});
	});

	it("ignores multipart container rows", () => {
		const container = make({
			mediaType: "MULTIPART",
			mediaSubtype: "ALTERNATIVE",
			isMultipart: true,
		});
		const text = make({ mediaSubtype: "PLAIN" });
		const picked = pickRenderablePart([container, text]);
		assert.equal(picked?.kind, "text");
	});

	it("ignores attachment-disposition parts so a PDF doesn't shadow the body", () => {
		const attachment = make({
			mediaSubtype: "HTML",
			disposition: "attachment",
			contentUrl: "https://cdn.test/attachment.html",
		});
		const text = make({
			mediaSubtype: "PLAIN",
			contentUrl: "https://cdn.test/text",
		});
		const picked = pickRenderablePart([attachment, text]);
		assert.deepEqual(picked, {
			kind: "text",
			contentUrl: "https://cdn.test/text",
		});
	});

	it("returns null when nothing renderable is present", () => {
		const image = make({ mediaType: "IMAGE", mediaSubtype: "PNG" });
		assert.equal(pickRenderablePart([image]), null);
	});

	it("treats casing variants of the subtype as equivalent (mailers are inconsistent)", () => {
		const html = make({
			mediaSubtype: "html",
			contentUrl: "https://cdn.test/lower",
		});
		const picked = pickRenderablePart([html]);
		assert.deepEqual(picked, {
			kind: "html",
			contentUrl: "https://cdn.test/lower",
		});
	});

	it("skips parts with an empty contentUrl so the fetch never fires against the API root", () => {
		const broken = make({ mediaSubtype: "HTML", contentUrl: "" });
		assert.equal(pickRenderablePart([broken]), null);
	});

	it("never renders a forwarded message's body as the body carrying it", () => {
		const outer = make({ partPath: "1", contentUrl: "https://cdn.test/outer" });
		const forwarded = make({
			partPath: "2",
			mediaType: "MESSAGE",
			mediaSubtype: "rfc822",
			disposition: "attachment",
			contentUrl: "https://cdn.test/forwarded",
		});
		const innerHtml = make({
			partPath: "2.1",
			mediaSubtype: "HTML",
			contentUrl: "https://cdn.test/inner",
		});
		assert.deepEqual(pickRenderablePart([outer, forwarded, innerHtml]), {
			kind: "text",
			contentUrl: "https://cdn.test/outer",
		});
	});
});
