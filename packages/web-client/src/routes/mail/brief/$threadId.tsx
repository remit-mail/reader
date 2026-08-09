/**
 * /mail/brief/$threadId — a conversation open in the brief's reading pane.
 *
 * The brief is cross-mailbox, and the thread is still the whole address: the
 * folder its mail is filed in comes from the thread's own data, since
 * `GET /threads/{threadId}/messages` answers with rows that each name their
 * mailbox. A segment for the folder would be a second owner of a fact the
 * thread already carries.
 *
 * A layout, because the message segment nests under it.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/mail/brief/$threadId")({
	component: Outlet,
});
