import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	AttachmentFetchError,
	attachmentFailureContent,
	attachmentReportUrl,
	classifyAttachmentFailure,
	extractAttachmentFailureDetail,
	extractAttachmentFailureReason,
	fetchAttachment,
	isRepairableByRefetch,
	saveBlob,
} from "./attachment-download";

const originalFetch = globalThis.fetch;

const respondWith = (
	init: {
		status: number;
		statusText?: string;
		headers?: Record<string, string>;
	},
	body: string = "bytes",
) => {
	globalThis.fetch = (async () =>
		new Response(init.status === 204 ? null : body, {
			status: init.status,
			statusText: init.statusText ?? "",
			headers: init.headers,
		})) as typeof fetch;
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("classifyAttachmentFailure", () => {
	it("reads an edge denial as an expired session", () => {
		assert.equal(classifyAttachmentFailure(401, null), "auth");
		assert.equal(classifyAttachmentFailure(403, "tenant-mismatch"), "auth");
	});

	it("reads an origin 403/404 as a missing object", () => {
		assert.equal(classifyAttachmentFailure(403, null), "missing");
		assert.equal(classifyAttachmentFailure(404, null), "missing");
	});

	// A stale signature is not a stale session — telling the user to sign in
	// again would send them somewhere that cannot help.
	it("separates an aged-out content signature from an expired session", () => {
		assert.equal(classifyAttachmentFailure(403, "expired"), "link-expired");
		assert.equal(isRepairableByRefetch("link-expired"), true);
		assert.equal(isRepairableByRefetch("not-ready"), true);
		assert.equal(isRepairableByRefetch("auth"), false);
		assert.equal(isRepairableByRefetch("missing"), false);
	});

	it("reads anything else as generic", () => {
		assert.equal(classifyAttachmentFailure(500, null), "generic");
	});
});

describe("fetchAttachment", () => {
	it("returns the bytes on a 200", async () => {
		respondWith({ status: 200 }, "payload");
		const blob = await fetchAttachment("https://cdn.test/x", async () => null);
		assert.equal(await blob.text(), "payload");
	});

	it("sends the session token when there is one", async () => {
		let seen: string | null = null;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			seen = new Headers(init?.headers).get("Authorization") ?? null;
			return new Response("payload", { status: 200 });
		}) as unknown as typeof fetch;
		await fetchAttachment("https://cdn.test/x", async () => "tok");
		assert.equal(seen, "Bearer tok");
	});

	it("treats a 202 as not-ready rather than as an empty file", async () => {
		respondWith({ status: 202 });
		await assert.rejects(
			fetchAttachment("https://cdn.test/x", async () => null),
			(error: unknown) =>
				error instanceof AttachmentFetchError && error.reason === "not-ready",
		);
	});

	it("throws with the classified reason on a failure status", async () => {
		respondWith({ status: 404, statusText: "Not Found" });
		await assert.rejects(
			fetchAttachment("https://cdn.test/x", async () => null),
			(error: unknown) =>
				error instanceof AttachmentFetchError &&
				error.reason === "missing" &&
				error.status === 404,
		);
	});
});

describe("attachmentFailureContent", () => {
	it("tells an expired session what to do, and names the file", () => {
		const content = attachmentFailureContent(
			"auth",
			"report.pdf",
			"irrelevant",
		);
		assert.match(content.title, /session expired/i);
		assert.match(content.detail, /report\.pdf/);
	});

	it("distinguishes a missing object from a slow one", () => {
		assert.notEqual(
			attachmentFailureContent("missing", "x", "f").title,
			attachmentFailureContent("not-ready", "x", "f").title,
		);
	});

	it("surfaces the underlying error for an unclassified failure", () => {
		const content = attachmentFailureContent(
			"generic",
			"x",
			"Failed to download attachment (500 )",
		);
		assert.equal(content.detail, "Failed to download attachment (500 )");
	});
});

describe("failure extraction", () => {
	it("reads the reason off an AttachmentFetchError", () => {
		assert.equal(
			extractAttachmentFailureReason(
				new AttachmentFetchError("missing", "gone", 404),
			),
			"missing",
		);
	});

	it("treats an unrecognised throw as generic", () => {
		assert.equal(extractAttachmentFailureReason("boom"), "generic");
		assert.equal(extractAttachmentFailureDetail("boom"), "boom");
		assert.equal(
			extractAttachmentFailureDetail(new Error("transport lost")),
			"transport lost",
		);
		assert.match(extractAttachmentFailureDetail({}), /unexpected error/);
	});
});

describe("attachmentReportUrl", () => {
	it("offers a prefilled issue for a failure the user cannot fix", () => {
		const url = attachmentReportUrl("missing", "report.pdf", "gone");
		assert.ok(url, "a reportable failure must carry an issue URL");
		assert.ok(
			url.startsWith("https://github.com/remit-mail/reader/issues/new?"),
		);
		assert.match(decodeURIComponent(url), /report\.pdf/);
	});

	it("offers none for an expired session, which is not a bug", () => {
		assert.equal(
			attachmentReportUrl("auth", "report.pdf", "denied"),
			undefined,
		);
	});
});

describe("saveBlob", () => {
	it("saves under the name it was given and cleans up the anchor", async () => {
		const created: string[] = [];
		const revoked: string[] = [];
		const url = globalThis.URL as unknown as {
			createObjectURL?: (blob: Blob) => string;
			revokeObjectURL?: (value: string) => void;
		};
		url.createObjectURL = () => {
			created.push("blob:test");
			return "blob:test";
		};
		url.revokeObjectURL = (value) => revoked.push(value);

		let clickedName: string | null = null;
		const anchor = document.createElement("a");
		anchor.click = () => {
			clickedName = anchor.download;
		};
		const originalCreateElement = document.createElement.bind(document);
		document.createElement = ((tag: string) =>
			tag === "a"
				? anchor
				: originalCreateElement(tag)) as typeof document.createElement;

		try {
			saveBlob(new Blob(["x"]), "report.pdf");
		} finally {
			document.createElement = originalCreateElement;
		}

		assert.equal(clickedName, "report.pdf");
		assert.deepEqual(created, ["blob:test"]);
		assert.equal(document.body.contains(anchor), false);
		assert.deepEqual(revoked, [], "revoking in the click's task cancels it");

		await new Promise((resolve) => setTimeout(resolve, 5));
		assert.deepEqual(revoked, ["blob:test"]);
	});
});
