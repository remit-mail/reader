import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ClassificationLabel,
	MessageCategory,
	SenderOverride,
} from "@remit/domain-enums";
import type { PlacementVerdict } from "../heuristics/classifyPlacement.js";
import type {
	ClassificationLabelValue,
	ClassifierConfidenceKind,
} from "./classifier-adapter.js";
import {
	classifierVerdict,
	placementWithClassifier,
} from "./classifier-precedence.js";

const answer = (
	confidenceKind: ClassifierConfidenceKind,
	scores: Array<[ClassificationLabelValue, number]>,
) => ({
	confidenceKind,
	scores: scores.map(([label, confidence]) => ({ label, confidence })),
});

const LEAVE: PlacementVerdict = {
	action: "leave",
	confidence: "unsure",
	reasons: ["no-confident-signal"],
};

describe("classifier precedence", () => {
	it("lets a user rule win over a confident spam answer", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [[ClassificationLabel.Spam, 0.99]]),
			true,
		);
		assert.deepEqual(verdict, { kind: "None" });
	});

	it("puts spam above priority and a category", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Marketing, 0.9],
				[ClassificationLabel.Priority, 0.9],
				[ClassificationLabel.Phishing, 0.75],
			]),
			false,
		);
		assert.deepEqual(verdict, { kind: "Junk" });
	});

	it("puts priority above the top category", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Personal, 0.95],
				[ClassificationLabel.Priority, 0.72],
			]),
			false,
		);
		assert.deepEqual(verdict, { kind: "Priority" });
	});

	it("takes the top category at threshold", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Newsletter, 0.71],
				[ClassificationLabel.Social, 0.8],
			]),
			false,
		);
		assert.deepEqual(verdict, {
			kind: "Category",
			category: MessageCategory.social,
		});
	});

	it("holds a calibrated answer to 0.7", () => {
		const below = classifierVerdict(
			answer("Calibrated", [[ClassificationLabel.Spam, 0.69]]),
			false,
		);
		const at = classifierVerdict(
			answer("Calibrated", [[ClassificationLabel.Spam, 0.7]]),
			false,
		);
		assert.deepEqual(below, { kind: "None" });
		assert.deepEqual(at, { kind: "Junk" });
	});

	it("holds an advisory answer to 0.8", () => {
		const below = classifierVerdict(
			answer("Advisory", [[ClassificationLabel.Spam, 0.79]]),
			false,
		);
		const at = classifierVerdict(
			answer("Advisory", [[ClassificationLabel.Spam, 0.8]]),
			false,
		);
		assert.deepEqual(below, { kind: "None" });
		assert.deepEqual(at, { kind: "Junk" });
	});
});

describe("a junk answer in placement", () => {
	it("moves inbox mail to Junk", () => {
		const verdict = placementWithClassifier(
			LEAVE,
			true,
			"inbox",
			SenderOverride.None,
		);
		assert.equal(verdict.action, "move-to-junk");
		assert.equal(verdict.confidence, "confident");
	});

	it("never overrides a never-spam grant or a block", () => {
		for (const override of [SenderOverride.NeverSpam, SenderOverride.Blocked]) {
			assert.deepEqual(
				placementWithClassifier(LEAVE, true, "inbox", override),
				LEAVE,
			);
		}
	});

	it("keeps a built-in rescue from taking mail out of Junk", () => {
		const verdict = placementWithClassifier(
			{
				action: "move-to-inbox",
				confidence: "confident",
				reasons: ["provider=spam", "dmarc=pass", "sender=Vip"],
			},
			true,
			"junk",
			SenderOverride.None,
		);
		assert.equal(verdict.action, "leave");
	});
});
