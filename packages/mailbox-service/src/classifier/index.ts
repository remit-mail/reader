import { ClassificationLabel } from "@remit/domain-enums";
import type { ClassificationLabelValue } from "./classifier-adapter.js";
import type { ClassifierMessage } from "./classifier-request.js";

export {
	type ClassifierLogger,
	type ClassifierResult,
	type ClassifierScore,
	classifyWithProvider,
} from "./classifier-adapter.js";

export const CLASSIFIER_LABELS: readonly ClassificationLabelValue[] =
	Object.values(ClassificationLabel);

export const CLASSIFIER_SAMPLE_MESSAGE: ClassifierMessage = {
	headers: [
		{ name: "From", value: "Field Notes <hello@fieldnotes.example>" },
		{ name: "To", value: "reader@example.com" },
		{ name: "Subject", value: "This week: three walks along the coast" },
		{ name: "Date", value: "Tue, 10 Nov 2026 08:00:00 +0100" },
		{
			name: "List-Id",
			value: "Field Notes weekly <weekly.fieldnotes.example>",
		},
		{
			name: "List-Unsubscribe",
			value: "<https://fieldnotes.example/unsubscribe>",
		},
		{
			name: "Authentication-Results",
			value: "mx.example.com; dkim=pass header.d=fieldnotes.example; spf=pass",
		},
	],
	text: "Hello reader,\n\nThis week we walked three stretches of the coast path and wrote up the best of them. Read on for routes, tide times and where to stop for lunch.\n\nYou receive this because you subscribed to Field Notes weekly.",
};
