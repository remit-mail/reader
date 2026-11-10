import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
	ClassificationField,
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
import {
	CLASSIFIER_FAILURE_HELP,
	type ClassificationFailureKindValue,
} from "./classifier-failure.js";
import { CLASSIFIER_LABELS, CLASSIFIER_SAMPLE_MESSAGE } from "./index.js";

let stub: StubHttpServer | undefined;

const fieldOf = (kind: ClassificationFailureKindValue) => {
	const help = CLASSIFIER_FAILURE_HELP[kind];
	return "field" in help ? help.field : undefined;
};

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
	for (const [status, kind, field] of [
		[401, ClassificationFailureKind.Unauthorized, ClassificationField.ApiKey],
		[403, ClassificationFailureKind.Unauthorized, ClassificationField.ApiKey],
		[404, ClassificationFailureKind.ModelNotFound, ClassificationField.Model],
		[429, ClassificationFailureKind.RateLimited, undefined],
		[400, ClassificationFailureKind.Rejected, ClassificationField.Model],
		[500, ClassificationFailureKind.ProviderError, undefined],
		[503, ClassificationFailureKind.ProviderError, undefined],
	] as const) {
		it(`${status} maps to ${kind} on ${field ?? "no field"}`, async () => {
			const result = await answeredWith(status);

			assert.equal(result.ok, false);
			assert.ok(!result.ok);
			assert.equal(result.kind, kind);
			assert.equal(result.status, status);
			assert.equal(fieldOf(result.kind), field);
		});
	}
});

describe("a refused connection", () => {
	it("maps to unreachable on the base URL, with no status", async () => {
		const result = await classifyAt(await closedPortBaseUrl());

		assert.ok(!result.ok);
		assert.equal(result.kind, ClassificationFailureKind.Unreachable);
		assert.equal(result.status, undefined);
		assert.equal(fieldOf(result.kind), ClassificationField.BaseUrl);
	});
});

describe("every failure kind", () => {
	it("has fix text", () => {
		for (const kind of Object.values(ClassificationFailureKind)) {
			assert.ok(CLASSIFIER_FAILURE_HELP[kind].fix.length > 0, kind);
		}
	});
});
