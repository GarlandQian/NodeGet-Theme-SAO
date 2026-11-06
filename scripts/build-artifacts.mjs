import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { parseBuildConfig, readConfigTemplate } from "./theme-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "nodeget-theme.json"), "utf8"));
const environment = loadEnv("production", root, "NODEGET_");
const config = parseBuildConfig(
  process.env.NODEGET_CONFIG ?? environment.NODEGET_CONFIG,
  readConfigTemplate(root),
);

function jsonFile(name, value) {
  writeFileSync(resolve(dist, name), `${JSON.stringify(value, null, 2)}\n`);
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : entry.isFile() ? [relative(dist, path).replaceAll("\\", "/")] : [];
  });
}

// 版本号以 package.json 为准，构建结果与更新检测使用同一版本。
jsonFile("nodeget-theme.json", { ...manifest, version: pkg.version });
jsonFile("config.json", config);
copyFileSync(resolve(root, "docs/images/theme-preview.png"), resolve(root, "preview.png"));
copyFileSync(resolve(root, "preview.png"), resolve(dist, "preview.png"));
copyFileSync(resolve(root, "LICENSE"), resolve(dist, "LICENSE"));
jsonFile(
  "nodeget-theme-files.json",
  listFiles(dist).filter((file) => file !== "nodeget-theme-files.json" && !file.endsWith(".zip")).sort(),
);
console.log(`Prepared NodeGet theme v${pkg.version} in dist/.`);
