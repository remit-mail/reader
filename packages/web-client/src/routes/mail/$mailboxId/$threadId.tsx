/**
 * /mail/$mailboxId/$threadId — a conversation open in a folder's reading pane.
 *
 * The folder in the address is the list being browsed, not the thread's home:
 * a cross-folder search hit opens here too, and every message it holds names
 * its own mailbox. A layout, because the message segment nests under it.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/mail/$mailboxId/$threadId")({
	component: Outlet,
});
