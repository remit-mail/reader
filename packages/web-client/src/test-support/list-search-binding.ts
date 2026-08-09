/**
 * Asserts that each mail list route validates its search with the schema
 * `lib/mail-search.ts` declares for that path. Wire a list to another list's
 * schema and it fails here.
 *
 * It runs as its own process, spawned by `lib/route-search-query.test.ts`.
 * Importing a route file pulls in the whole pane it mounts, and every module a
 * test loads counts in the coverage denominator — reading `validateSearch`
 * in-process dropped web-client's line coverage by ten points with nothing
 * rendered to earn it back.
 */
import assert from "node:assert/strict";
import { mailListSearchSchemas } from "@/lib/mail-search";
import { Route as MailboxRoute } from "@/routes/mail/$mailboxId";
import { Route as BriefRoute } from "@/routes/mail/brief";
import { Route as FlaggedRoute } from "@/routes/mail/flagged";
import { Route as OutboxRoute } from "@/routes/mail/outbox";

const routes = {
	"/mail/brief": BriefRoute,
	"/mail/flagged": FlaggedRoute,
	"/mail/outbox": OutboxRoute,
	"/mail/$mailboxId": MailboxRoute,
} as const;

for (const [path, route] of Object.entries(routes)) {
	const declared =
		mailListSearchSchemas[path as keyof typeof mailListSearchSchemas];
	assert.equal(
		route.options.validateSearch,
		declared,
		`${path} does not validate its search with the schema declared for it`,
	);
}
