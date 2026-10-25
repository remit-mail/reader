import { fileURLToPath, URL } from "node:url";
import type { StoriesEntry } from "storybook/internal/types";
import type { AliasOptions, InlineConfig, PluginOption } from "vite";

const fromUi = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

export const uiStories: StoriesEntry = {
	directory: fromUi("../src"),
	files: "**/*.stories.@(ts|tsx)",
};

export const uiFramework = {
	name: "@storybook/react-vite",
	options: {},
} as const;

type UiViteConfig = InlineConfig & {
	plugins: PluginOption[];
	resolve: NonNullable<InlineConfig["resolve"]> & { alias: AliasOptions };
};

export const withUiVite = async (
	config: InlineConfig,
): Promise<UiViteConfig> => {
	const { default: tailwindcss } = await import("@tailwindcss/vite");
	const plugins = [...(config.plugins ?? []), tailwindcss()];
	// In a git worktree the shared node_modules symlinks resolve @remit/*
	// packages back to the main checkout. Override here so Storybook picks
	// up the worktree's own source (needed for design-token / component changes).
	const alias = {
		...(config.resolve?.alias ?? {}),
		"@remit/ui/tokens.css": fromUi("../src/tokens.css"),
		// Ordered before the bare package alias: Vite matches string aliases by
		// prefix, so "@remit/ui" alone would rewrite this subpath into
		// index.ts/rich-text.
		"@remit/ui/rich-text": fromUi("../src/rich-text.ts"),
		"@remit/ui/spellcheck-worker": fromUi(
			"../src/components/rich-text-spellcheck-worker-provider.ts",
		),
		"@remit/ui": fromUi("../src/index.ts"),
	};
	return { ...config, plugins, resolve: { ...config.resolve, alias } };
};
