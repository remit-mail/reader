import { client } from "@remit/api-http-client/client.gen.ts";

// In production, VITE_API_URL points at the deployed API Gateway.
// In local dev, the Vite proxy forwards /api -> localhost:4321 (see vite.config.ts).
const baseUrl = import.meta.env.VITE_API_URL ?? "/api";

client.setConfig({
	baseUrl,
});

export { client };
