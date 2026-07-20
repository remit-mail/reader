import { z } from "zod";

export const SUMMARY_MAX_LENGTH = 140;

export const UpdateManifestSchema = z.object({
	version: z.string().regex(/^v\d+\.\d+\.\d+$/),
	publishedAt: z.string().datetime(),
	summary: z.string().min(1).max(SUMMARY_MAX_LENGTH),
	releaseNotesUrl: z
		.string()
		.url()
		.refine((url) => url.startsWith("https://"), {
			message: "releaseNotesUrl must be an https:// URL",
		}),
	registry: z.string().min(1),
});

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;
