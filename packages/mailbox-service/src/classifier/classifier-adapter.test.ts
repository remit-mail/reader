import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	ClassificationAdapterShape,
	ClassificationFailureKind,
} from "@remit/domain-enums";
import {
	type StubHttpServer,
	type StubReply,
	type StubRequest,
	startStubHttpServer,
} from "../test-helpers/stub-http-server.js";
import {
	type ClassificationAdapterShapeValue,
	type ClassifierResult,
	classifyWithProvider,
} from "./classifier-adapter.js";
import { CLASSIFIER_LABELS, CLASSIFIER_SAMPLE_MESSAGE } from "./index.js";

const API_KEY = "sk-test-0123456789abcdef";

let stub: StubHttpServer | undefined;

afterEach(async () => {
	await stub?.close();
	stub = undefined;
});

const json = (status: number, body: unknown): StubReply => ({
	status,
	body: JSON.stringify(body),
});

const decisionAnswer = (label: string, probability: number): StubReply =>
	json(200, {
		model: "jev-2026-10",
		answers: {
			label: {
				type: "choice",
				choice: label,
				confidence: probability,
				probabilities: Object.fromEntries(
					CLASSIFIER_LABELS.map((option) => [
						option,
						option === label ? probability : 0.01,
					]),
				),
			},
		},
		usage: { input_tokens: 212, output_tokens: 1 },
	});

const chatAnswer = (content: string): StubReply =>
	json(200, {
		choices: [{ message: { role: "assistant", content } }],
	});

const jinaAnswer = (label: string, score: number): StubReply =>
	json(200, {
		data: [
			{
				object: "classification",
				index: 0,
				prediction: label,
				score,
			},
		],
	});

interface Warned {
	obj: Record<string, unknown>;
	msg: string;
}

const run = async (
	adapterShape: ClassificationAdapterShapeValue,
	reply: (request: StubRequest) => StubReply,
	options: { timeoutMs?: number; warned?: Warned[] } = {},
): Promise<ClassifierResult> => {
	await stub?.close();
	stub = await startStubHttpServer(reply);
	const warned = options.warned ?? [];
	return classifyWithProvider(
		{
			provider: {
				adapterShape,
				baseUrl: stub.baseUrl,
				model: "test-model",
				apiKey: API_KEY,
			},
			labels: CLASSIFIER_LABELS,
			message: CLASSIFIER_SAMPLE_MESSAGE,
		},
		{
			logger: { warn: (obj, msg) => warned.push({ obj, msg }) },
			timeoutMs: options.timeoutMs,
		},
	);
};

const sent = (): StubRequest => {
	const [request] = stub?.requests ?? [];
	assert.ok(request, "the provider received no request");
	return request;
};

describe("every adapter shape", () => {
	it("DecisionApi reads a calibrated score per label from /v1/systemone", async () => {
		const result = await run(ClassificationAdapterShape.DecisionApi, () =>
			decisionAnswer("Newsletter", 0.93),
		);

		assert.equal(sent().path, "/v1/systemone");
		assert.equal(sent().headers.authorization, `Bearer ${API_KEY}`);
		const body = JSON.parse(sent().body);
		assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
		assert.equal(body.questions.label.type, "choice");
		assert.deepEqual(
			Object.keys(body.questions.label.criteria),
			CLASSIFIER_LABELS,
		);
		assert.ok(result.ok);
		assert.equal(result.confidenceKind, "Calibrated");
		assert.equal(result.scores.length, CLASSIFIER_LABELS.length);
		const top = result.scores.find((score) => score.label === "Newsletter");
		assert.equal(top?.confidence, 0.93);
		assert.ok(result.inputWords > 0);
	});

	it("ChatJsonSchema asks for an enum of the labels and reads one advisory label", async () => {
		const result = await run(ClassificationAdapterShape.ChatJsonSchema, () =>
			chatAnswer(JSON.stringify({ label: "Newsletter", confidence: 0.88 })),
		);

		assert.equal(sent().path, "/chat/completions");
		const body = JSON.parse(sent().body);
		assert.deepEqual(
			body.response_format.json_schema.schema.properties.label.enum,
			CLASSIFIER_LABELS,
		);
		assert.ok(result.ok);
		assert.equal(result.confidenceKind, "Advisory");
		assert.deepEqual(result.scores, [
			{ label: "Newsletter", confidence: 0.88 },
		]);
	});

	it("JinaClassify posts to /v1/classify and reads its prediction and score", async () => {
		const result = await run(ClassificationAdapterShape.JinaClassify, () =>
			jinaAnswer("Marketing", 0.61),
		);

		assert.equal(sent().path, "/v1/classify");
		const body = JSON.parse(sent().body);
		assert.deepEqual(body.labels, CLASSIFIER_LABELS);
		assert.equal(body.input.length, 1);
		assert.equal(typeof body.input[0].text, "string");
		assert.ok(result.ok);
		assert.equal(result.confidenceKind, "Advisory");
		assert.deepEqual(result.scores, [{ label: "Marketing", confidence: 0.61 }]);
	});
});

describe("an answer the adapter cannot use", () => {
	const unparseable = (result: ClassifierResult): void => {
		assert.equal(result.ok, false);
		assert.equal(
			!result.ok && result.kind,
			ClassificationFailureKind.Unparseable,
		);
	};

	it("is unparseable when it names a label outside the set", async () => {
		unparseable(
			await run(ClassificationAdapterShape.DecisionApi, () =>
				decisionAnswer("urgent", 0.9),
			),
		);
		unparseable(
			await run(ClassificationAdapterShape.ChatJsonSchema, () =>
				chatAnswer(JSON.stringify({ label: "urgent", confidence: 0.9 })),
			),
		);
		unparseable(
			await run(ClassificationAdapterShape.JinaClassify, () =>
				jinaAnswer("urgent", 0.9),
			),
		);
	});

	it("is unparseable when the body is not JSON or not the expected shape", async () => {
		unparseable(
			await run(ClassificationAdapterShape.DecisionApi, () => ({
				status: 200,
				body: "<html>gateway</html>",
			})),
		);
		unparseable(
			await run(ClassificationAdapterShape.ChatJsonSchema, () =>
				chatAnswer("newsletter, I think"),
			),
		);
		unparseable(
			await run(ClassificationAdapterShape.JinaClassify, () =>
				json(200, { data: [] }),
			),
		);
	});

	it("is unparseable when a confidence falls outside 0 to 1", async () => {
		unparseable(
			await run(ClassificationAdapterShape.ChatJsonSchema, () =>
				chatAnswer(JSON.stringify({ label: "Spam", confidence: 1.4 })),
			),
		);
	});
});

describe("a silent provider", () => {
	it("fails as timed out once the timeout passes", async () => {
		const result = await run(
			ClassificationAdapterShape.DecisionApi,
			() => "Silent",
			{ timeoutMs: 150 },
		);

		assert.equal(result.ok, false);
		assert.equal(!result.ok && result.kind, ClassificationFailureKind.TimedOut);
		assert.equal(!result.ok && result.status, undefined);
		assert.ok(result.latencyMs >= 100);
	});
});

describe("the request body", () => {
	it("holds only the listed headers and the first 1,500 tokens of the text body", async () => {
		const words = Array.from({ length: 2_000 }, (_, i) => `w${i}`);
		stub = await startStubHttpServer(() => decisionAnswer("Personal", 0.8));
		await classifyWithProvider(
			{
				provider: {
					adapterShape: ClassificationAdapterShape.DecisionApi,
					baseUrl: stub.baseUrl,
					model: "test-model",
					apiKey: "",
				},
				labels: CLASSIFIER_LABELS,
				message: {
					headers: [
						{ name: "Received", value: "from relay.example" },
						{ name: "From", value: "a@example.com" },
						{ name: "Cc", value: "c@example.com" },
						{ name: "To", value: "b@example.com" },
						{ name: "Subject", value: "Hello" },
						{ name: "Date", value: "Tue, 10 Nov 2026 08:00:00 +0100" },
						{ name: "X-Attachment-Id", value: "invoice.pdf" },
						{ name: "List-Id", value: "<list.example>" },
						{ name: "list-unsubscribe", value: "<https://list.example/u>" },
						{ name: "Authentication-Results", value: "dkim=pass" },
					],
					text: words.join(" \n"),
				},
			},
			{ logger: { warn: () => undefined } },
		);

		const request = sent();
		assert.equal(request.headers.authorization, undefined);
		const body = JSON.parse(request.body);
		assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"]);
		assert.equal(
			body.state,
			[
				"From: a@example.com",
				"To: b@example.com",
				"Subject: Hello",
				"Date: Tue, 10 Nov 2026 08:00:00 +0100",
				"List-Id: <list.example>",
				"list-unsubscribe: <https://list.example/u>",
				"Authentication-Results: dkim=pass",
				"",
				words.slice(0, 1_500).join(" \n"),
			].join("\n"),
		);
	});
});

describe("a failure log line", () => {
	it("holds no key", async () => {
		const warned: Warned[] = [];
		const result = await run(
			ClassificationAdapterShape.ChatJsonSchema,
			() => json(401, { error: `invalid key ${API_KEY}` }),
			{ warned },
		);

		assert.equal(result.ok, false);
		assert.equal(warned.length, 1);
		assert.equal(warned[0]?.obj.kind, ClassificationFailureKind.Unauthorized);
		assert.doesNotMatch(JSON.stringify(warned), new RegExp(API_KEY));
	});
});
