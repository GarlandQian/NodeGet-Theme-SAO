import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(new URL(name, new URL("../", import.meta.url)), "utf8"));
const pkg = readJson("package.json");
const manifest = readJson("nodeget-theme.json");
const lock = readJson("package-lock.json");
const version = pkg.version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (typeof version !== "string" || !semver.test(version)) {
  throw new Error("package.json version must be a valid release version.");
}
if (manifest.name !== "NodeGet-Theme-SAO") {
  throw new Error("Unexpected NodeGet theme package name.");
}
if (manifest.version !== version || lock.version !== version || lock.packages?.[""]?.version !== version) {
  throw new Error("Align package.json, package-lock.json and nodeget-theme.json versions before releasing.");
}
const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(`Release tag must match package.json: expected ${tag}.`);
}
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
for (const [key, value] of Object.entries({ version, tag, sha, zip: `NodeGet-Theme-SAO-${tag}.zip`, prerelease: version.includes("-") })) {
  console.log(`${key}=${value}`);
}
