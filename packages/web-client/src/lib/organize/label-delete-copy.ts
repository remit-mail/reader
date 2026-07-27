/**
 * The delete-confirmation copy for a label (issue #26). Deleting a label
 * cascades in both directions server-side — every filter whose action applies
 * it is deleted outright, never left dangling — so the confirmation names the
 * filter count up front rather than surprising the user after the fact. The
 * API itself never blocks the delete; the confirmation is the only gate.
 */
export const deleteLabelConfirmCopy = (
	labelName: string,
	filterCount: number,
): { title: string; description?: string } => {
	if (filterCount === 0) {
		return { title: `Delete the "${labelName}" label?` };
	}
	const filterNoun = filterCount === 1 ? "filter" : "filters";
	return {
		title: `Delete the "${labelName}" label?`,
		description: `This also deletes ${filterCount} ${filterNoun} that ${
			filterCount === 1 ? "applies" : "apply"
		} it — they can't be recovered.`,
	};
};
