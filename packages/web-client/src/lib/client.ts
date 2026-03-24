import { client } from "@remit/api-http-client/client.gen.ts";

// Configure for local development - Vite proxy handles /api -> localhost:4321
client.setConfig({
	baseUrl: "/api",
});

export { client };
