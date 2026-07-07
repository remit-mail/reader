import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSqsCredentials } from "./index.js";

test("returns the SQS pair when both are set", () => {
	const creds = resolveSqsCredentials({
		SQS_ACCESS_KEY_ID: "SCWXXX",
		SQS_SECRET_ACCESS_KEY: "secret",
	});
	assert.deepEqual(creds, { accessKeyId: "SCWXXX", secretAccessKey: "secret" });
});

test("falls back to the default chain when the access key is missing", () => {
	assert.equal(
		resolveSqsCredentials({ SQS_SECRET_ACCESS_KEY: "secret" }),
		undefined,
	);
});

test("falls back to the default chain when the secret is missing", () => {
	assert.equal(
		resolveSqsCredentials({ SQS_ACCESS_KEY_ID: "SCWXXX" }),
		undefined,
	);
});

test("falls back to the default chain when neither is set", () => {
	assert.equal(resolveSqsCredentials({}), undefined);
});

test("ignores the AWS S3 credentials — reads only the SQS pair", () => {
	assert.equal(
		resolveSqsCredentials({
			AWS_ACCESS_KEY_ID: "AKIA",
			AWS_SECRET_ACCESS_KEY: "aws-secret",
		}),
		undefined,
	);
});
