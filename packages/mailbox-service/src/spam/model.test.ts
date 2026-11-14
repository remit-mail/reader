import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
	type SpamPipeline,
	type SpamRequest,
	spamPipelineFromEnv,
} from "@remit/data-ports";
import {
	ClassificationAdapterShape,
	SpamAction,
	SpamModelOutcome,
	SpamReasonName,
} from "@remit/domain-enums";
import {
	type StubHttpServer,
	startStubHttpServer,
} from "../test-helpers/stub-http-server.js";
import { spamServiceFor } from "./index.js";
import { SPAM_MODEL_OFF, type SpamModelAccess } from "./model.js";

const THRESHOLDS = { state: "Set", cleanBelow: 0.2, spamAt: 0.8 } as const;

const REQUEST: SpamRequest = {
	message: {
		raw: "",
		headers: [{ name: "From", value: "Desk <desk@parcel-notice.example>" }],
		text: "Your parcel is waiting.",
		html: "",
		links: [],
	},
	envelope: { mailFrom: "", rcpt: [], ip: "", helo: "", hostname: "" },
	authentication: {
		dmarc: "Pass",
		spf: "Pass",
		dkim: "Pass",
		signerDomain: "parcel-notice.example",
		envelopeDomain: "parcel-notice.example",
	},
	provider: { verdict: "Absent", score: "", headers: [] },
	context: {
		knownSender: false,
		senderMessagesSeen: 0,
		senderDomainMessagesSeen: 0,
		receivedAt: "2026-11-13T10:00:00Z",
		classifierScores: [],
		modelAllowed: true,
	},
};

const decision = (choice: string, clean: number) => ({
	status: 200,
	body: JSON.stringify({
		answers: {
			label: {
				type: "choice",
				choice,
				confidence: 1 - clean,
				probabilities: {
					Impersonation: choice === "Impersonation" ? 1 - clean : 0,
					Spam: choice === "Spam" ? 1 - clean : 0,
					Clean: clean,
				},
			},
		},
	}),
});

let provider: StubHttpServer;
let answer = decision("Clean", 0.9);

before(async () => {
	provider = await startStubHttpServer(() => answer);
});

after(() => provider.close());

const access = (claims: string[]): SpamModelAccess => ({
	state: "On",
	gate: {
		provider: {
			adapterShape: ClassificationAdapterShape.DecisionApi,
			baseUrl: provider.baseUrl,
			model: "jev-test",
			apiKey: "",
		},
		dailyLimit: 500,
	},
	config: {
		accountSetting: {
			claimDailyCount: async ({ name }) => {
				claims.push(name);
				return { state: "Claimed", calls: claims.length };
			},
		},
		logger: { warn: () => {} },
	},
	account: { accountId: "acct", accountConfigId: "cfg" },
});

const IN_BAND = { state: "Set", cleanBelow: 0.01, spamAt: 0.99 } as const;

const pipeline = (model: SpamPipeline[number]): SpamPipeline => [
	{ name: "Inline", thresholds: IN_BAND },
	model,
];

describe("the model judge", () => {
	it("decides with its own thresholds after the inline judge is unsure", async () => {
		answer = decision("Spam", 0.05);
		const claims: string[] = [];

		const verdict = await spamServiceFor(
			pipeline({ name: "Model", thresholds: THRESHOLDS }),
			access(claims),
			Date.now(),
		).check(REQUEST);

		assert.equal(claims.length, 1);
		assert.equal(verdict.state, "Checked");
		if (verdict.state !== "Checked") return;
		assert.equal(verdict.action, SpamAction.Junk);
		assert.equal(verdict.score, 0.95);
		assert.equal(verdict.decidedBy, "Model");
		assert.equal(verdict.modelOutcome, SpamModelOutcome.Answered);
		assert.equal(verdict.reasons.at(-1)?.name, SpamReasonName.ModelSpam);
		assert.ok(verdict.reasons.length > 1);
	});

	it("warns for a model score inside its own band", async () => {
		answer = decision("Spam", 0.5);

		const verdict = await spamServiceFor(
			pipeline({ name: "Model", thresholds: THRESHOLDS }),
			access([]),
			Date.now(),
		).check(REQUEST);

		assert.equal(
			verdict.state === "Checked" && verdict.action,
			SpamAction.Warn,
		);
	});

	it("is not asked when the inline judge is sure", async () => {
		answer = decision("Spam", 0.05);
		const claims: string[] = [];

		const verdict = await spamServiceFor(
			[
				{
					name: "Inline",
					thresholds: { state: "Set", cleanBelow: 0.99, spamAt: 1 },
				},
				{ name: "Model", thresholds: THRESHOLDS },
			],
			access(claims),
			Date.now(),
		).check(REQUEST);

		assert.equal(claims.length, 0);
		assert.equal(
			verdict.state === "Checked" && verdict.action,
			SpamAction.None,
		);
		assert.equal(
			verdict.state === "Checked" && verdict.modelOutcome,
			SpamModelOutcome.OutOfBand,
		);
	});

	it("abstains for an account without a model, leaving the inline warning", async () => {
		const verdict = await spamServiceFor(
			pipeline({ name: "Model", thresholds: THRESHOLDS }),
			SPAM_MODEL_OFF,
			Date.now(),
		).check(REQUEST);

		assert.equal(verdict.state, "Checked");
		if (verdict.state !== "Checked") return;
		assert.equal(verdict.action, SpamAction.Warn);
		assert.equal(verdict.decidedBy, "Inline");
		assert.equal(verdict.modelOutcome, SpamModelOutcome.NotConfigured);
	});
});

describe("the default pipeline", () => {
	it("records the inline score and neither acts nor asks the model", async () => {
		answer = decision("Spam", 0.05);
		const claims: string[] = [];

		const verdict = await spamServiceFor(
			spamPipelineFromEnv({}),
			access(claims),
			Date.now(),
		).check(REQUEST);

		assert.equal(claims.length, 0);
		assert.equal(verdict.state, "Checked");
		if (verdict.state !== "Checked") return;
		assert.ok(verdict.score > 0);
		assert.equal(verdict.action, SpamAction.None);
		assert.equal(verdict.decidedBy, "Inline");
		assert.equal(verdict.modelOutcome, SpamModelOutcome.OutOfBand);
	});
});
