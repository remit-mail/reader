import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
} from "@remit/domain-enums";
import {
	closedPortBaseUrl,
	type StubHttpServer,
	startStubHttpServer,
} from "../test-helpers/stub-http-server.js";
import {
	type ClassifierResult,
	classifyWithProvider,
} from "./classifier-adapter.js";
import { CLASSIFIER_LABELS, CLASSIFIER_SAMPLE_MESSAGE } from "./index.js";

let stub: StubHttpServer | undefined;

afterEach(async () => {
	await stub?.close();
	stub = undefined;
});

const classifyAt = (baseUrl: string): Promise<ClassifierResult> =>
	classifyWithProvider(
		{
			provider: {
				adapterShape: ClassificationAdapterShape.ChatJsonSchema,
				baseUrl,
				model: "test-model",
				apiKey: "sk-test",
			},
			labels: CLASSIFIER_LABELS,
			message: CLASSIFIER_SAMPLE_MESSAGE,
		},
		{ logger: { warn: () => undefined } },
	);

const answeredWith = async (status: number): Promise<ClassifierResult> => {
	stub = await startStubHttpServer(() => ({
		status,
		body: JSON.stringify({ error: "refused" }),
	}));
	const result = await classifyAt(stub.baseUrl);
	await stub.close();
	stub = undefined;
	return result;
};

describe("a provider status", () => {
	for (const [status, kind] of [
		[401, ClassificationFailureKind.Unauthorized],
		[403, ClassificationFailureKind.Unauthorized],
		[404, ClassificationFailureKind.ModelNotFound],
		[429, ClassificationFailureKind.RateLimited],
		[400, ClassificationFailureKind.Rejected],
		[500, ClassificationFailureKind.ProviderError],
		[503, ClassificationFailureKind.ProviderError],
	] as const) {
		it(`${status} maps to ${kind}`, async () => {
			const result = await answeredWith(status);

			assert.equal(result.ok, false);
			assert.ok(!result.ok);
			assert.equal(result.kind, kind);
			assert.equal(result.status, status);
		});
	}
});

describe("a refused connection", () => {
	it("maps to unreachable, with no status", async () => {
		const result = await classifyAt(await closedPortBaseUrl());

		assert.ok(!result.ok);
		assert.equal(result.kind, ClassificationFailureKind.Unreachable);
		assert.equal(result.status, undefined);
	});
});
