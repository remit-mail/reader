/**
 * /mail/flagged/$threadId — a conversation open in the flagged list's reading
 * pane.
 *
 * Starred mail spans accounts and folders, and the thread is still the whole
 * address: the folder its mail is filed in comes from the thread's own data,
 * since `GET /threads/{threadId}/messages` answers with rows that each name
 * their mailbox.
 *
 * A layout, because the message segment nests under it.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/mail/flagged/$threadId")({
	component: Outlet,
});
