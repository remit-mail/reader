/**
 * The selection wizard's step in the URL, and the history entries it owns
 * (#477 clause 1.6). TanStack Router owns history here: the step is a validated
 * `wizard` search param on /mail, pushed with `navigate({ search })`, so
 * `router.state.location` and `window.location` never disagree.
 *
 * The wizard is rooted on an entry that carries no step, so the entries it owns
 * are the pushes that reached the current step: one for the opening step, one
 * per advance. A document that loads straight into a step has no such root, and
 * no answers behind the step either, so it is re-rooted at the opening step
 * before anything else — otherwise the number of entries to rewind is a guess
 * about a tab this code never saw.
 *
 * Which steps Back leaves the wizard from is `backExits` in the step model, and
 * the shell reads it to route Back to exit rather than to a step. These are the
 * two movements it routes between: `goBack` pops one entry, `closeWizard`
 * rewinds every entry the wizard owns.
 */

import { type StepId, stepIndex } from "@remit/ui";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { z } from "zod";

const stepId = z.enum([
	"match",
	"properties",
	"folder",
	"rule",
	"name",
	"review",
	"run",
]);

export const wizardStepFromParam = (value: unknown): StepId | undefined => {
	const parsed = stepId.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

/**
 * Which affordance opened the wizard. Absent is the selection bar; `search` is
 * the make-filter affordance in the search results header, whose clauses come
 * from the query rather than from ticked rows (#477 1.8).
 *
 * It rides the URL beside the step for the same reason the step does: a
 * reloaded document has to know which walk it is in the middle of, and the
 * query it was seeded from is in the URL already. It changes nothing about how
 * the wizard behaves once it is open (#477 3.4) — it only says which surface
 * hosts it, so two mounts of the same host cannot both answer one step.
 */
const wizardEntry = z.literal("search");

export type WizardEntry = z.infer<typeof wizardEntry>;

export const wizardEntryFromParam = (
	value: unknown,
): WizardEntry | undefined => {
	const parsed = wizardEntry.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

export const wizardEntryValue = z.unknown().transform(wizardEntryFromParam);

export const useWizardEntryValue = (): WizardEntry | undefined =>
	useSearch({ from: "/mail", select: (search) => search.wizardFrom });

/**
 * The route's `wizard` field. A value the wizard cannot be on reads as no step
 * rather than as a validation failure, so a truncated or hand-typed link lands
 * on the mail list instead of the router's error screen.
 */
export const wizardStepValue = z.unknown().transform(wizardStepFromParam);

export const ownedHistoryEntries = (
	steps: readonly StepId[],
	step: StepId,
): number => stepIndex(steps, step) + 1;

export const useWizardStepValue = (): StepId | undefined =>
	useSearch({ from: "/mail", select: (search) => search.wizard });

/**
 * Opens the wizard on a step, from a surface that does not drive it — a verb on
 * the selection bar, or the make-filter affordance on a search. The push is the
 * wizard's first owned entry, so the back that leaves it lands on the list with
 * the selection still ticked.
 */
export const useOpenWizard = (): ((
	step: StepId,
	entry?: WizardEntry,
) => void) => {
	const navigate = useNavigate();
	return useCallback(
		(step: StepId, entry?: WizardEntry) => {
			navigate({
				to: ".",
				search: (prev) => ({ ...prev, wizard: step, wizardFrom: entry }),
			});
		},
		[navigate],
	);
};

export interface WizardStepNavigation {
	step: StepId | undefined;
	goToStep: (step: StepId) => void;
	goBack: () => void;
	closeWizard: (steps: readonly StepId[], step: StepId) => void;
}

/**
 * The step in the URL and the movements between them.
 *
 * `hosts` is whether this mount is the one the held step belongs to. Both the
 * selection bar's host and the search's host stay mounted beside the list, and
 * exactly one of them owns any given walk; the other must not re-root the
 * wizard, or the entries to rewind on the way out are counted twice.
 */
export const useWizardStep = (
	openingStep: StepId,
	hosts = true,
): WizardStepNavigation => {
	const router = useRouter();
	const navigate = useNavigate();
	const step = useWizardStepValue();
	// Whether this document loaded already holding a step, which is the one
	// entrance that leaves the wizard unrooted. A step the app itself pushed
	// arrives rooted, so re-rooting it would duplicate the entry underneath it.
	const loadedHoldingStep = useRef(hosts && step !== undefined);
	const pushedTo = useRef<StepId | undefined>(undefined);

	// Two taps on Continue land before the URL settles, and both would push the
	// same step — leaving a back that appears to do nothing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the guard is cleared because the step changed, which is only knowable from the dependency.
	useEffect(() => {
		pushedTo.current = undefined;
	}, [step]);

	useEffect(() => {
		if (!loadedHoldingStep.current) return;
		loadedHoldingStep.current = false;
		void (async () => {
			await navigate({
				to: ".",
				search: (prev) => ({ ...prev, wizard: undefined }),
				replace: true,
			});
			await navigate({
				to: ".",
				search: (prev) => ({ ...prev, wizard: openingStep }),
			});
		})();
	}, [openingStep, navigate]);

	const goToStep = useCallback(
		(next: StepId) => {
			if (next === step || pushedTo.current === next) return;
			pushedTo.current = next;
			navigate({ to: ".", search: (prev) => ({ ...prev, wizard: next }) });
		},
		[navigate, step],
	);

	const goBack = useCallback(() => {
		router.history.back();
	}, [router]);

	const closeWizard = useCallback(
		(steps: readonly StepId[], current: StepId) => {
			router.history.go(-ownedHistoryEntries(steps, current));
		},
		[router],
	);

	return { step, goToStep, goBack, closeWizard };
};
