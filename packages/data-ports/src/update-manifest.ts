import { z } from "zod";

export const UpdateManifestSchema = z.object({
	version: z.string().regex(/^v\d+\.\d+\.\d+$/),
	publishedAt: z.string().datetime(),
	summary: z.string().min(1).max(140),
	releaseNotesUrl: z.string().url(),
	registry: z.string().min(1),
});

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;
