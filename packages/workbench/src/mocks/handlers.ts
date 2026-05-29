import { account, mailboxes, messages } from "@remit/ui/fixtures";
import { HttpResponse, http } from "msw";

/**
 * MSW handlers serving the remit-ui fixtures, shaped after the generated
 * API surface (account / mailboxes / messages). Lets data-driven stories
 * render with no backend.
 */
export const handlers = [
	http.get("/api/account", () => HttpResponse.json(account)),

	http.get("/api/mailboxes", () =>
		HttpResponse.json({ items: mailboxes, cursor: null }),
	),

	http.get("/api/mailboxes/:mailboxId/messages", ({ params }) => {
		const items = messages.filter(
			(m) => m.message.mailboxId === params.mailboxId,
		);
		return HttpResponse.json({ items, cursor: null });
	}),

	http.get("/api/messages/:messageId", ({ params }) => {
		const found = messages.find(
			(m) => m.message.messageId === params.messageId,
		);
		return found
			? HttpResponse.json(found)
			: new HttpResponse(null, { status: 404 });
	}),
];
