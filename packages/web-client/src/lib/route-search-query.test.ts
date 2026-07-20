/**
 * `q` lives on the parent `/mail` route, but every child re-declares it: a
 * child's `validateSearch` is authoritative for its own URL, so a child that
 * omits `q` strips it. The top bar mounts a search field on all four of these
 * routes, so a stripped `q` means typing a query does nothing and the query is
 * lost on the next navigation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { Route as MailboxRoute } from "../routes/mail/$mailboxId";
import { Route as FlaggedRoute } from "../routes/mail/flagged";
import { Route as BriefRoute } from "../routes/mail/index";
import { Route as OutboxRoute } from "../routes/mail/outbox";

const routes = {
	"/mail/ (daily brief)": BriefRoute,
	"/mail/flagged": FlaggedRoute,
	"/mail/outbox": OutboxRoute,
	"/mail/$mailboxId": MailboxRoute,
};

const parse = (route: { options: { validateSearch?: unknown } }) => {
	const schema = route.options.validateSearch;
	assert.ok(
		schema instanceof z.ZodType,
		"route must validate its search with a zod schema",
	);
	return (search: Record<string, unknown>) => schema.parse(search);
};

describe("every /mail child route carries `q` through its own validation", () => {
	for (const [name, route] of Object.entries(routes)) {
		it(`${name} preserves a query`, () => {
			const parsed = parse(route)({ q: "invoice" }) as { q?: string };
			assert.equal(
				parsed.q,
				"invoice",
				`${name} drops q, so the top bar's search field is inert there`,
			);
		});

		it(`${name} leaves q absent when there is none`, () => {
			const parsed = parse(route)({}) as { q?: string };
			assert.equal(parsed.q, undefined);
		});
	}
});
