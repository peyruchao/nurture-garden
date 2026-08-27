import { defineConfig, loadEnv } from "vite";
import { plsCliUploadPlugin } from "./tools/plsCliUploadMiddleware";
import { giftVaultPlugin } from "./tools/giftVaultMiddleware";

export default defineConfig(({ mode }) => ({
  // PLS_* stays server-only. It is loaded here for the dev middleware and is
  // never exposed through import.meta.env in the browser bundle.
  plugins: [plsCliUploadPlugin(loadEnv(mode, process.cwd(), "")), giftVaultPlugin(loadEnv(mode, process.cwd(), ""))],
  // Keep every generated URL relative so the uploaded folder works from any
  // hosting subdirectory instead of assuming deployment at the domain root.
  base: "./",
  build: {
    assetsInlineLimit: 0,
  },
}));
