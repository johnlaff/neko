import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The big figures are set in Geist, and the browser only finds the font after parsing the CSS.
 * Preloading the Latin subset starts that download with the HTML, so the first paint already
 * uses the right face.
 */
const preloadUiFont = (): Plugin => ({
  name: "neko:preload-ui-font",
  transformIndexHtml: {
    order: "post",
    handler: (_html, ctx) => {
      const font = Object.keys(ctx.bundle ?? {}).find((f) =>
        /geist-latin-wght-normal-[\w-]+\.woff2$/.test(f),
      );
      return font
        ? [
            {
              tag: "link",
              attrs: {
                rel: "preload",
                href: `/${font}`,
                as: "font",
                type: "font/woff2",
                crossorigin: "",
              },
              injectTo: "head",
            },
          ]
        : [];
    },
  },
});

/**
 * Every build gets its own service-worker cache, filled at install with that build's code, styles
 * and Latin fonts: every tab opens offline from the first visit, and the copies of older builds are
 * dropped on activate instead of piling up on the phone with each deploy.
 */
const precacheBuild = (): Plugin => ({
  name: "neko:precache-build",
  applyToEnvironment: (env) => env.name === "client",
  async writeBundle(options, bundle) {
    const files = Object.keys(bundle)
      .filter(
        (f) => /^assets\/.+\.(js|css)$/.test(f) || /-latin-wght-normal-[\w-]+\.woff2$/.test(f),
      )
      .sort()
      .map((f) => `/${f}`);
    const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
    const path = join(options.dir ?? "dist/client", "sw.js");
    const source = await readFile(path, "utf8");
    const filled = source
      .replace('const BUILD = "dev";', `const BUILD = ${JSON.stringify(version)};`)
      .replace("const ASSETS = [];", `const ASSETS = ${JSON.stringify(files)};`);
    if (filled === source) this.error("sw.js lost its BUILD/ASSETS placeholders");
    await writeFile(path, filled);
  },
});

export default defineConfig({
  plugins: [react(), cloudflare(), preloadUiFont(), precacheBuild()],
});
