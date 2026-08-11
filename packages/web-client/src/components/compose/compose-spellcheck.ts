/**
 * The checker the composer writes against. The engine runs in a worker, opened
 * once per language and taken down with the surface, and the module holding it
 * is loaded on demand so the worker chunk stays out of every other screen.
 *
 * A language with no dictionary is not a failure: the provider answers null,
 * the editor leaves the browser's own checking switched on, and the writer
 * still gets underlines. A checker that was supposed to come up and did not is
 * a failure, and it says so — an editor that has quietly stopped marking
 * anything reads exactly like text with nothing wrong in it.
 */

import type { ProviderStatus, SpellcheckOptions } from "@remit/ui/rich-text";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import type { PushErrorInput } from "../ui/error-banners.js";

const WHAT_FAILED: Record<"download" | "engine" | "worker", string> = {
	download: "its dictionary could not be downloaded",
	engine: "the checker could not start",
	worker: "the checker stopped running",
};

export const spellcheckFailure = (
	status: Extract<ProviderStatus, { state: "failed" }>,
): PushErrorInput => {
	const summary = `Spellcheck for ${status.language} is off: ${WHAT_FAILED[status.reason]}.`;
	return {
		severity: "warning",
		title: "Spellcheck stopped",
		detail: `${summary} Your browser is checking this message instead. ${status.detail}`,
		action: {
			label: "Report this",
			href: buildGitHubIssueUrl(
				buildBugReportContext({
					title: `Spellcheck stopped: ${status.reason} (${status.language})`,
					errorMessage: `${summary} ${status.detail}`,
				}),
			),
		},
	};
};

export const composeSpellcheck = (
	report: (input: PushErrorInput) => void,
): SpellcheckOptions => ({
	provider: async (language) => {
		const { openSpellcheckWorker } = await import(
			"@remit/ui/spellcheck-worker"
		);
		return openSpellcheckWorker(language);
	},
	onStatus: (status) => {
		if (status.state !== "failed") return;
		report(spellcheckFailure(status));
	},
});
