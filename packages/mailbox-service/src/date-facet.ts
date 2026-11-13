import { OFFSET_BEARING } from "@remit/calendar-service";
import type { SentDateRange } from "@remit/data-ports";
import { accept, invalid, type Refusable } from "./refusal.js";

export interface DateFacet {
	before?: string;
	after?: string;
}

const instantOf = (
	name: keyof DateFacet,
	value: string | undefined,
): Refusable<number | undefined> => {
	if (value === undefined) return accept(undefined);
	const ms = Date.parse(value);
	if (Number.isNaN(ms) || !OFFSET_BEARING.test(value)) {
		return invalid(
			`\`${name}\` must be an ISO 8601 date-time with a zone offset, such as 2026-08-13T00:00:00+02:00`,
		);
	}
	return accept(ms);
};

export const sentDateRange = (facet: DateFacet): Refusable<SentDateRange> => {
	const before = instantOf("before", facet.before);
	if (!before.ok) return before;
	const after = instantOf("after", facet.after);
	if (!after.ok) return after;
	if (
		before.value !== undefined &&
		after.value !== undefined &&
		after.value >= before.value
	) {
		return invalid("`after` must be earlier than `before`");
	}
	return accept({
		...(after.value === undefined ? {} : { sentAfter: after.value }),
		...(before.value === undefined ? {} : { sentBefore: before.value }),
	});
};
