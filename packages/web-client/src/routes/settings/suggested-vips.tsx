/**
 * Suggested VIPs — now folded into Senders & Rules (VIP group).
 * This route redirects to /settings/senders so existing deep links
 * and smoke test paths continue to resolve gracefully.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/suggested-vips")({
	component: () => <Navigate to="/settings/senders" replace />,
});
