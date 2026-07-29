import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isConvertible,
	type SearchConversion,
	searchConversionNotice,
} from "./search-rule.js";

const conversion = (
	overrides: Partial<SearchConversion> = {},
): SearchConversion => ({
	clauses: [],
	matchOperator: "all",
	droppedFacets: [],
	keptTerms: false,
	droppedSemantic: false,
	...overrides,
});

describe("isConvertible", () => {
	it("is false when the search yields no clause", () => {
		assert.equal(
			isConvertible(
				conversion({
					droppedFacets: [{ type: "hasAttachment", label: "Has attachment" }],
					scopedOut: { mailboxId: "mbx-archive", label: "archive" },
				}),
			),
			false,
		);
	});

	it("is true once a term or sender is present", () => {
		assert.equal(
			isConvertible(
				conversion({
					clauses: [{ field: "HasWords", value: "receipts" }],
					keptTerms: true,
				}),
			),
			true,
		);
	});
});

describe("searchConversionNotice", () => {
	it("names the folder the search was scoped to and every facet dropped", () => {
		const notice = searchConversionNotice(
			conversion({
				clauses: [{ field: "HasWords", value: "npm" }],
				keptTerms: true,
				scopedOut: { mailboxId: "mbx-archive", label: "Archive" },
				droppedFacets: [{ type: "isUnread", label: "Unread" }],
				droppedSemantic: true,
			}),
		);
		assert.deepEqual(notice, {
			scopedOutFolder: "Archive",
			droppedFacets: ["Unread"],
			droppedSemantic: true,
		});
	});

	it("states nothing for a conversion that carried everything", () => {
		const notice = searchConversionNotice(
			conversion({ clauses: [{ field: "From", value: "a@b.com" }] }),
		);
		assert.deepEqual(notice, {
			scopedOutFolder: undefined,
			droppedFacets: [],
			droppedSemantic: false,
		});
	});
});
