/**
 * `/mail` has no view of its own: the daily brief is one of the four lists and
 * lives at its own path, so every link into the mail app that names no list
 * lands here and is sent on to the brief carrying whatever it arrived with.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { mailIndexSearchSchema } from "@/lib/mail-search";

export const Route = createFileRoute("/mail/")({
	validateSearch: mailIndexSearchSchema,
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/mail/brief", search, replace: true });
	},
});
