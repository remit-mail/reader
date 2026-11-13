import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SpamRequest, SpamResponse } from "@remit/data-ports";
import {
	ClassificationAdapterShape,
	SpamAction,
	SpamModelOutcome,
} from "@remit/domain-enums";
import {
	type StubHttpServer,
	startStubHttpServer,
} from "../test-helpers/stub-http-server.js";
import { consultSpamModel, type SpamModelAccess } from "./model.js";

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

const checked = (score: number): SpamResponse => ({
	state: "Checked",
	score,
	action: score < 0.2 ? SpamAction.None : SpamAction.Warn,
	kind: "Spam",
	reasons: [],
	modelOutcome:
		score < 0.2 ? SpamModelOutcome.OutOfBand : SpamModelOutcome.NotConfigured,
});

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

describe("consultSpamModel", () => {
	const cases = [
		{
			name: "in band, the model calls it clean",
			score: 0.5,
			reply: decision("Clean", 0.9),
			claims: 1,
			action: SpamAction.None,
		},
		{
			name: "in band, the model calls it spam",
			score: 0.5,
			reply: decision("Spam", 0.05),
			claims: 1,
			action: SpamAction.Junk,
		},
		{
			name: "out of band",
			score: 0.1,
			reply: decision("Spam", 0.05),
			claims: 0,
			action: SpamAction.None,
		},
	];
	for (const row of cases) {
		it(row.name, async () => {
			answer = row.reply;
			const claims: string[] = [];

			const verdict = await consultSpamModel(
				access(claims),
				REQUEST,
				checked(row.score),
				THRESHOLDS,
				Date.now(),
			);

			assert.equal(claims.length, row.claims);
			assert.equal(verdict.state === "Checked" && verdict.action, row.action);
			assert.equal(
				verdict.state === "Checked" && verdict.modelOutcome,
				row.claims === 1
					? SpamModelOutcome.Answered
					: SpamModelOutcome.OutOfBand,
			);
		});
	}
});
