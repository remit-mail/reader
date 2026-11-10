import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClassificationLabel, MessageCategory } from "@remit/domain-enums";
import type {
	ClassificationLabelValue,
	ClassifierConfidenceKind,
} from "./classifier-adapter.js";
import { classifierVerdict } from "./classifier-precedence.js";

const answer = (
	confidenceKind: ClassifierConfidenceKind,
	scores: Array<[ClassificationLabelValue, number]>,
) => ({
	confidenceKind,
	scores: scores.map(([label, confidence]) => ({ label, confidence })),
});

describe("classifier precedence", () => {
	it("puts spam above priority and a category", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Marketing, 0.9],
				[ClassificationLabel.Priority, 0.9],
				[ClassificationLabel.Phishing, 0.75],
			]),
		);
		assert.deepEqual(verdict, { kind: "Junk" });
	});

	it("puts priority above the top category", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Personal, 0.95],
				[ClassificationLabel.Priority, 0.72],
			]),
		);
		assert.deepEqual(verdict, { kind: "Priority" });
	});

	it("takes the top category at threshold", () => {
		const verdict = classifierVerdict(
			answer("Calibrated", [
				[ClassificationLabel.Newsletter, 0.71],
				[ClassificationLabel.Social, 0.8],
			]),
		);
		assert.deepEqual(verdict, {
			kind: "Category",
			category: MessageCategory.social,
		});
	});

	it("holds a calibrated answer to 0.7", () => {
		const below = classifierVerdict(
			answer("Calibrated", [[ClassificationLabel.Spam, 0.69]]),
		);
		const at = classifierVerdict(
			answer("Calibrated", [[ClassificationLabel.Spam, 0.7]]),
		);
		assert.deepEqual(below, { kind: "None" });
		assert.deepEqual(at, { kind: "Junk" });
	});

	it("holds an advisory answer to 0.8", () => {
		const below = classifierVerdict(
			answer("Advisory", [[ClassificationLabel.Spam, 0.79]]),
		);
		const at = classifierVerdict(
			answer("Advisory", [[ClassificationLabel.Spam, 0.8]]),
		);
		assert.deepEqual(below, { kind: "None" });
		assert.deepEqual(at, { kind: "Junk" });
	});
});
