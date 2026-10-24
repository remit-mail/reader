import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	base: "/assets/",
	plugins: [tailwindcss()],
	publicDir: false,
	build: {
		outDir: "dist/pages",
		emptyOutDir: true,
		assetsInlineLimit: 0,
		rollupOptions: {
			input: { pages: "src/pages/pages.css" },
			output: {
				assetFileNames: "[name][extname]",
				entryFileNames: "[name].js",
			},
		},
	},
});
