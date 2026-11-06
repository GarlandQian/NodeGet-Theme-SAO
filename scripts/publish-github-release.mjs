import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// This script publishes only inside the explicitly invoked Actions release job.
if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Run this publisher through GitHub Actions.");
const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL = "https://api.github.com", RELEASE_TAG, RELEASE_SHA, RELEASE_ZIP, RELEASE_PRERELEASE } = process.env;
if (!GH_TOKEN || !GITHUB_REPOSITORY || !RELEASE_TAG || !RELEASE_SHA || !RELEASE_ZIP) {
  throw new Error("Missing GitHub Actions release metadata.");
}
if (!/^[0-9a-f]{40}$/.test(RELEASE_SHA)) throw new Error("Release target must be a full commit SHA.");
if (!existsSync(`release-assets/${RELEASE_ZIP}`) || !existsSync("release-assets/preview.png")) {
  throw new Error("Verified release assets are missing.");
}

async function github(path) {
  const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GH_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub release preflight failed (HTTP ${response.status}).`);
  return response.json();
}

if (await github(`releases/tags/${encodeURIComponent(RELEASE_TAG)}`)) {
  throw new Error(`${RELEASE_TAG} already has a release. Bump the version instead of overwriting it.`);
}
const ref = await github(`git/ref/tags/${encodeURIComponent(RELEASE_TAG)}`);
if (ref) {
  let object = ref.object;
  for (let depth = 0; object?.type === "tag" && depth < 8; depth += 1) {
    const annotation = await github(`git/tags/${object.sha}`);
    object = annotation?.object;
  }
  if (object?.type !== "commit" || object.sha !== RELEASE_SHA) {
    throw new Error(`${RELEASE_TAG} points to another commit; existing tags are never moved.`);
  }
} else if (process.env.GITHUB_REF_TYPE === "tag") {
  throw new Error("The triggering tag no longer exists.");
}

const args = [
  "release", "create", RELEASE_TAG,
  `release-assets/${RELEASE_ZIP}`, "release-assets/preview.png", "release-assets/SHA256SUMS",
  "--repo", GITHUB_REPOSITORY, "--target", RELEASE_SHA,
  "--title", `NodeGet-Theme-SAO ${RELEASE_TAG}`,
  "--notes-file", "release-assets/notes.md",
];
if (ref) args.push("--verify-tag");
if (RELEASE_PRERELEASE === "true") args.push("--prerelease");
// gh creates a new release; unlike update-oriented actions it cannot replace existing assets.
execFileSync("gh", args, { stdio: "inherit" });
