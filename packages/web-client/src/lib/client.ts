import { client } from "@remit/api-http-client/client.gen.ts";
import { toast } from "sonner";

const getErrorMessage = (error: unknown): string => {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}
		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}
	}
	return "An unexpected error occurred";
};

// Configure for local development - Vite proxy handles /api -> localhost:4321
client.setConfig({
	baseUrl: "/api",
});

// Global error handler - show toast for all API errors
client.interceptors.error.use((error) => {
	toast.error(getErrorMessage(error));
	return error;
});

export { client };
