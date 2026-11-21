import { createClient } from "@remit/api-http-client/client/index.js";
import type { RemitClient } from "@remit/backend/create-remit-client";
import { handlers, publicHandlers } from "@remit/backend/handlers";
import type { ApiConfig } from "@remit/backend/serve";
import { serveApi } from "@remit/backend/serve";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { CalendarClient } from "./calendar-tools.js";

const api = serveApi({ handlers, publicHandlers });

export const createCalendarClient = (
	origin: string,
	config: ApiConfig,
	client: RemitClient,
	userId: string,
): CalendarClient =>
	createClient({
		baseUrl: origin,
		fetch: (request, init) =>
			api.handleFetch(
				request instanceof Request ? request : new Request(request, init),
				{
					config,
					client: async () => client,
					identity: async () => ({
						kind: "user",
						accountConfigId: deriveAccountConfigId(userId),
						sub: userId,
						email: `${userId}@subject.invalid`,
					}),
					operator: async () => false,
					operatorGrant: async () => false,
					peopleDirectory: async () => null,
				},
				"mcp-calendar",
			),
	});
