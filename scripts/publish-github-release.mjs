import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseIsReusable } from "./auto-release.mjs";

// Publishing happens only after the Actions job has verified the package.
export async function publishRelease(env, dependencies = {}) {
  if (env.GITHUB_ACTIONS !== "true") throw new Error("Run this publisher through GitHub Actions.");
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL = "https://api.github.com", GITHUB_SERVER_URL = "https://github.com",
    RELEASE_TAG, RELEASE_SHA, RELEASE_ZIP, RELEASE_PRERELEASE, RELEASE_AUTOMATIC, RELEASE_SOURCE_SHA } = env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !RELEASE_TAG || !RELEASE_SHA || !RELEASE_ZIP) {
    throw new Error("Missing GitHub Actions release metadata.");
  }
  if (!/^[0-9a-f]{40}$/.test(RELEASE_SHA)) throw new Error("Release target must be a full commit SHA.");
  const assetExists = dependencies.assetExists ?? existsSync;
  if (!assetExists(`release-assets/${RELEASE_ZIP}`) || !assetExists("release-assets/preview.png")) {
    throw new Error("Verified release assets are missing.");
  }
  const run = dependencies.run ?? ((command, args) => execFileSync(command, args, { stdio: "inherit" }));
  const github = dependencies.github ?? (async (path) => {
    const response = await fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${GH_TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub release preflight failed (HTTP ${response.status}).`);
    return response.json();
  });

  if (RELEASE_AUTOMATIC === "true") {
    if (!/^[0-9a-f]{40}$/.test(RELEASE_SOURCE_SHA ?? "")) throw new Error("Missing automatic release source SHA.");
    const main = await github("git/ref/heads/main");
    if (main?.object?.sha !== RELEASE_SOURCE_SHA && main?.object?.sha !== RELEASE_SHA) {
      console.log("main advanced during validation; the newer push will release its own version.");
      return false;
    }
  }
  const existing = await github(`releases/tags/${encodeURIComponent(RELEASE_TAG)}`);
  const ref = await github(`git/ref/tags/${encodeURIComponent(RELEASE_TAG)}`);
  let tagSha = null;
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object?.type === "tag" && depth < 8; depth += 1) {
      const annotation = await github(`git/tags/${object.sha}`);
      object = annotation?.object;
    }
    if (object?.type !== "commit" || object.sha !== RELEASE_SHA) {
      throw new Error(`${RELEASE_TAG} points to another commit; existing tags are never moved.`);
    }
    tagSha = object.sha;
  } else if (env.GITHUB_REF_TYPE === "tag") {
    throw new Error("The triggering tag no longer exists.");
  }

  if (existing) {
    if (!releaseIsReusable(existing, { tagSha, sha: RELEASE_SHA, zip: RELEASE_ZIP, prerelease: RELEASE_PRERELEASE === "true" })) {
      throw new Error(`${RELEASE_TAG} exists but is not a complete matching release; existing assets will not be overwritten.`);
    }
    console.log(`Reusing verified release ${RELEASE_TAG}; continuing its deployment.`);
    return true;
  }

  if (RELEASE_AUTOMATIC === "true") {
    // A normal atomic push rejects concurrent main updates and never moves existing tags.
    // GITHUB_TOKEN pushes do not trigger another workflow run.
    const refs = [`${RELEASE_SHA}:refs/heads/main`];
    if (!ref) refs.push(`${RELEASE_SHA}:refs/tags/${RELEASE_TAG}`);
    run("git", ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential",
      "push", "--atomic", `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git`, ...refs]);
  }

  const args = [
    "release", "create", RELEASE_TAG,
    `release-assets/${RELEASE_ZIP}`, "release-assets/preview.png", "release-assets/SHA256SUMS",
    "--repo", GITHUB_REPOSITORY, "--target", RELEASE_SHA,
    "--title", `NodeGet-Theme-SAO ${RELEASE_TAG}`,
    "--notes-file", "release-assets/notes.md",
  ];
  if (ref || RELEASE_AUTOMATIC === "true") args.push("--verify-tag");
  if (RELEASE_PRERELEASE === "true") args.push("--prerelease");
  // gh creates a new release; it cannot replace existing assets.
  run("gh", args);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const published = await publishRelease(process.env);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
}
