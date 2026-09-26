import { codedApiErrorBody } from "@/lib/api";
import { formatErrorDetail } from "../ui/error-banners.js";

export const mailSyncOffReason = (error: unknown): string | undefined => {
	if (codedApiErrorBody(error)?.code !== "mail_sync_off") return undefined;
	return formatErrorDetail(error);
};
