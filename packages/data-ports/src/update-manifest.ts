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
	// The highest schema migration the release applies, as a count of the
	// migrations shipped at that release. The updater compares it against the
	// running instance's version to tell whether installing this release runs a
	// migration. Optional so a manifest published before this field validates and
	// reads as an unknown schema version rather than an error.
	schemaVersion: z.number().int().nonnegative().optional(),
});

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;
