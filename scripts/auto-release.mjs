import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionFiles = ["package.json", "package-lock.json", "nodeget-theme.json"];
const botEmail = "41898282+github-actions[bot]@users.noreply.github.com";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    const difference = BigInt(a.split(".")[index]) - BigInt(b.split(".")[index]);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
  }
  return 0;
}

export function nextReleaseVersion(current, tags) {
  if (!stableVersion.test(current)) throw new Error("Automatic main releases require a stable x.y.z version.");
  const versions = tags.filter((tag) => tag.startsWith("v") && stableVersion.test(tag.slice(1))).map((tag) => tag.slice(1));
  const latest = versions.sort(compareVersions).at(-1);
  if (!latest || compareVersions(current, latest) > 0) return current;
  const [major, minor, patch] = latest.split(".");
  return `${major}.${minor}.${BigInt(patch) + 1n}`;
}

export function releaseIsReusable(release, { tagSha, sha, zip, prerelease }) {
  return tagSha === sha && release?.draft === false && release.prerelease === prerelease
    && [zip, "preview.png", "SHA256SUMS"].every((name) => release.assets?.some((asset) => asset.name === name));
}

function readVersions(cwd) {
  const values = versionFiles.map((name) => JSON.parse(readFileSync(resolve(cwd, name), "utf8")));
  const [pkg, lock, manifest] = values;
  if (manifest.name !== "NodeGet-Theme-SAO" || manifest.version !== pkg.version
      || lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error("Align package.json, package-lock.json and nodeget-theme.json versions before releasing.");
  }
  return values;
}

export function automaticReleaseSource(cwd, sha) {
  const parentLine = git(cwd, "rev-list", "--parents", "-n", "1", sha).split(" ");
  if (parentLine.length !== 2 || git(cwd, "show", "-s", "--format=%ae", sha) !== botEmail) return null;
  const source = git(cwd, "show", "-s", "--format=%B", sha).match(/^NodeGet-Release-Source: ([a-f0-9]{40})$/m)?.[1];
  if (source !== parentLine[1]) return null;
  const changed = git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n");
  return changed.length > 0 && changed.every((name) => versionFiles.includes(name)) ? source : null;
}

// This only creates a local version commit. The publisher pushes it after all checks pass.
export function prepareRelease({ cwd, eventName, refType, refName, sourceSha }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || git(cwd, "rev-parse", "HEAD") !== sourceSha) {
    throw new Error("The checkout must match the triggering commit.");
  }
  if (git(cwd, "status", "--porcelain", "--untracked-files=no")) throw new Error("Release checkout must be clean.");
  if (refType === "tag") {
    git(cwd, "merge-base", "--is-ancestor", sourceSha, "origin/main");
    readVersions(cwd);
    return { skip: false, automatic: false, source_sha: sourceSha };
  }
  if (refType !== "branch" || refName !== "main") throw new Error("Automatic releases must run from main.");
  const remote = git(cwd, "rev-parse", "origin/main");
  if (remote !== sourceSha) {
    if (automaticReleaseSource(cwd, remote) !== sourceSha) return { skip: true, automatic: false, source_sha: sourceSha };
    // A previous attempt pushed its verified version commit; finish that same release.
    git(cwd, "checkout", "--detach", remote);
    readVersions(cwd);
    return { skip: false, automatic: true, source_sha: sourceSha };
  }
  const previousSource = automaticReleaseSource(cwd, sourceSha);
  if (previousSource) {
    readVersions(cwd);
    return { skip: eventName === "push", automatic: true, source_sha: previousSource };
  }
  const [pkg, lock, manifest] = readVersions(cwd);
  const tags = git(cwd, "tag", "--list").split("\n");
  if (tags.includes(`v${pkg.version}`) && git(cwd, "rev-parse", `v${pkg.version}^{commit}`) === sourceSha) {
    return { skip: false, automatic: true, source_sha: sourceSha };
  }
  const version = nextReleaseVersion(pkg.version, tags);
  if (version !== pkg.version) {
    pkg.version = lock.version = lock.packages[""].version = manifest.version = version;
    [pkg, lock, manifest].forEach((value, index) => writeFileSync(resolve(cwd, versionFiles[index]), `${JSON.stringify(value, null, 2)}\n`));
    git(cwd, "add", "--", ...versionFiles);
    git(cwd, "-c", "user.name=github-actions[bot]", "-c", `user.email=${botEmail}`, "commit",
      "-m", `chore(release): v${version}`, "-m", `NodeGet-Release-Source: ${sourceSha}`);
  }
  return { skip: false, automatic: true, source_sha: sourceSha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Run automatic releases through GitHub Actions.");
  const result = prepareRelease({ cwd: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE, refName: process.env.GITHUB_REF_NAME, sourceSha: process.env.GITHUB_SHA });
  const output = Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(result.skip ? "Skipped a superseded push or automatic version commit." : "Prepared the release commit locally.");
}
