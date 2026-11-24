import assert from "node:assert/strict";
import { it } from "node:test";
import { attachmentUploadFailure } from "./upload-error.js";

it("names the self-hosted server's upload refusal", async () => {
	const message = await attachmentUploadFailure(
		new Response("size-mismatch", { status: 400 }),
	);
	assert.equal(
		message,
		"Attachment upload failed with status 400: The attachment size does not match its reservation",
	);
});

it("names storage's reason without echoing its signed request details", async () => {
	const message = await attachmentUploadFailure(
		new Response(
			"<Error><Code>SignatureDoesNotMatch</Code><Message>Rejected credential: secret</Message><SignatureProvided>secret</SignatureProvided></Error>",
			{ status: 403 },
		),
	);
	assert.equal(
		message,
		"Attachment upload failed with status 403: The upload URL signature is invalid",
	);
	assert.ok(!message.includes("secret"));
});

it("does not echo an unrecognized storage response or reason header", async () => {
	for (const headers of [
		new Headers(),
		new Headers({ "x-remit-upload-reason": "rejected secret" }),
	]) {
		const message = await attachmentUploadFailure(
			new Response('{"message":"Rejected password: secret"}', {
				status: 403,
				headers,
			}),
		);
		assert.ok(!message.includes("secret"));
		assert.match(message, /storage server refused the upload/);
	}
});
