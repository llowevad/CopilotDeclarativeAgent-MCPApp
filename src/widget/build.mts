import { build } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const widgetRoot = path.join(__dirname, "src", "questionnaire");
const assetsDir = path.join(__dirname, "..", "server", "assets");

fs.mkdirSync(assetsDir, { recursive: true });

await build({
  root: widgetRoot,
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: assetsDir,
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: "questionnaire.js" },
    },
  },
  logLevel: "warn",
});

const sourceHtml = path.join(assetsDir, "index.html");
const targetHtml = path.join(assetsDir, "questionnaire.html");
if (!fs.existsSync(sourceHtml)) {
  throw new Error(`Expected Vite output missing: ${sourceHtml}`);
}
if (fs.existsSync(targetHtml)) fs.rmSync(targetHtml);
fs.renameSync(sourceHtml, targetHtml);
console.log(`Built ${targetHtml}`);
