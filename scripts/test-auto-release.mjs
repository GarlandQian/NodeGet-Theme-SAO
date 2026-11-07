import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { automaticReleaseSource, nextReleaseVersion, prepareRelease, releaseIsReusable } from "./auto-release.mjs";
import { publishRelease } from "./publish-github-release.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "nodeget-auto-release-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "release-test@example.invalid");
  const files = {
    "package.json": { name: "nodeget-theme-sao", version: "1.3.8" },
    "package-lock.json": { version: "1.3.8", packages: { "": { version: "1.3.8" } } },
    "nodeget-theme.json": { name: "NodeGet-Theme-SAO", version: "1.3.8" },
  };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(cwd, name), `${JSON.stringify(value, null, 2)}\n`);
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Initial version");
  git(cwd, "tag", "v1.3.8");
  writeFileSync(join(cwd, "change.txt"), "new source\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Update source");
  const sourceSha = git(cwd, "rev-parse", "HEAD");
  git(cwd, "update-ref", "refs/remotes/origin/main", sourceSha);
  return { cwd, sourceSha, eventName: "push", refType: "branch", refName: "main" };
}
const versions = (cwd) => ["package.json", "package-lock.json", "nodeget-theme.json"].map((name) => JSON.parse(readFileSync(join(cwd, name), "utf8")));

test("patch selection uses the highest stable tag and respects a higher declared version", () => {
  assert.equal(nextReleaseVersion("1.3.8", ["v1.3.8", "v1.3.10", "v1.3.9", "v2.0.0-beta.1", "misc"]), "1.3.11");
  assert.equal(nextReleaseVersion("1.4.0", ["v1.3.8"]), "1.4.0");
  assert.equal(nextReleaseVersion("1.0.0", []), "1.0.0");
  assert.throws(() => nextReleaseVersion("1.4.0-beta.1", []), /stable/);
});

test("preparation aligns all versions in a local commit without changing remote main or creating a tag", (t) => {
  const args = fixture(t);
  assert.deepEqual(prepareRelease(args), { skip: false, automatic: true, source_sha: args.sourceSha });
  const [pkg, lock, manifest] = versions(args.cwd);
  assert.equal(pkg.version, "1.3.9");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(git(args.cwd, "rev-parse", "origin/main"), args.sourceSha);
  assert.equal(git(args.cwd, "tag", "--list", "v1.3.9"), "");
  assert.equal(automaticReleaseSource(args.cwd, "HEAD"), args.sourceSha);
});

test("rerunning a source commit resumes its already pushed version commit", (t) => {
  const args = fixture(t);
  prepareRelease(args);
  const releaseSha = git(args.cwd, "rev-parse", "HEAD");
  git(args.cwd, "update-ref", "refs/remotes/origin/main", releaseSha);
  git(args.cwd, "checkout", "--detach", args.sourceSha);
  const resumed = prepareRelease(args);
  assert.equal(resumed.skip, false);
  assert.equal(git(args.cwd, "rev-parse", "HEAD"), releaseSha);
  assert.equal(versions(args.cwd)[0].version, "1.3.9");
});

test("automatic version pushes do not release recursively and manual recovery reuses the version", (t) => {
  const args = fixture(t);
  prepareRelease(args);
  const releaseSha = git(args.cwd, "rev-parse", "HEAD");
  git(args.cwd, "update-ref", "refs/remotes/origin/main", releaseSha);
  assert.equal(prepareRelease({ ...args, sourceSha: releaseSha }).skip, true);
  assert.deepEqual(prepareRelease({ ...args, sourceSha: releaseSha, eventName: "workflow_dispatch" }),
    { skip: false, automatic: true, source_sha: args.sourceSha });
  assert.equal(versions(args.cwd)[0].version, "1.3.9");
});

test("an unrelated newer main push supersedes an older run", (t) => {
  const args = fixture(t);
  writeFileSync(join(args.cwd, "change.txt"), "newer source\n");
  git(args.cwd, "commit", "-am", "Newer source");
  git(args.cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(args.cwd, "checkout", "--detach", args.sourceSha);
  assert.equal(prepareRelease(args).skip, true);
  assert.equal(git(args.cwd, "rev-parse", "HEAD"), args.sourceSha);
  assert.equal(versions(args.cwd)[0].version, "1.3.8");
});

test("an exact already tagged main commit can resume without bumping again", (t) => {
  const args = fixture(t);
  git(args.cwd, "tag", "-d", "v1.3.8");
  git(args.cwd, "tag", "v1.3.8");
  assert.equal(prepareRelease({ ...args, eventName: "workflow_dispatch" }).skip, false);
  assert.equal(git(args.cwd, "rev-parse", "HEAD"), args.sourceSha);
  assert.equal(versions(args.cwd)[0].version, "1.3.8");
});

test("manual higher versions are used as declared and non-main branches are rejected", (t) => {
  const args = fixture(t);
  for (const name of ["package.json", "package-lock.json", "nodeget-theme.json"]) {
    const value = JSON.parse(readFileSync(join(args.cwd, name), "utf8"));
    value.version = "1.4.0";
    if (value.packages) value.packages[""].version = "1.4.0";
    writeFileSync(join(args.cwd, name), JSON.stringify(value));
  }
  git(args.cwd, "commit", "-am", "Select next minor version");
  args.sourceSha = git(args.cwd, "rev-parse", "HEAD");
  git(args.cwd, "update-ref", "refs/remotes/origin/main", args.sourceSha);
  assert.throws(() => prepareRelease({ ...args, refName: "feature" }), /main/);
  prepareRelease(args);
  assert.equal(git(args.cwd, "rev-parse", "HEAD"), args.sourceSha);
  assert.equal(versions(args.cwd)[0].version, "1.4.0");
});

const sha = "a".repeat(40);
const sourceSha = "b".repeat(40);
const zip = "NodeGet-Theme-SAO-v1.3.9.zip";
const completeRelease = { draft: false, prerelease: false, assets: [zip, "preview.png", "SHA256SUMS"].map((name) => ({ name })) };
const env = { GITHUB_ACTIONS: "true", GH_TOKEN: "fake-test-token", GITHUB_REPOSITORY: "test/theme", GITHUB_REF_TYPE: "branch",
  RELEASE_TAG: "v1.3.9", RELEASE_SHA: sha, RELEASE_ZIP: zip, RELEASE_PRERELEASE: "false", RELEASE_AUTOMATIC: "true", RELEASE_SOURCE_SHA: sourceSha };
function publisherFixture(overrides = {}) {
  const calls = [];
  const data = { "git/ref/heads/main": { object: { sha: sourceSha } }, ...overrides };
  return { calls, dependencies: { assetExists: () => true, github: async (path) => data[path] ?? null,
    run: (command, args) => calls.push({ command, args }) } };
}

test("only complete releases with the same resolved tag can be reused", () => {
  const metadata = { tagSha: sha, sha, zip, prerelease: false };
  assert.equal(releaseIsReusable(completeRelease, metadata), true);
  assert.equal(releaseIsReusable(completeRelease, { ...metadata, tagSha: sourceSha }), false);
  assert.equal(releaseIsReusable({ ...completeRelease, draft: true }, metadata), false);
  assert.equal(releaseIsReusable({ ...completeRelease, assets: [] }, metadata), false);
});

test("publication atomically pushes main and a new tag before creating the release", async () => {
  const fixture = publisherFixture();
  assert.equal(await publishRelease(env, fixture.dependencies), true);
  assert.equal(fixture.calls[0].command, "git");
  assert.ok(fixture.calls[0].args.includes("--atomic"));
  assert.ok(fixture.calls[0].args.includes(`${sha}:refs/heads/main`));
  assert.ok(fixture.calls[0].args.includes(`${sha}:refs/tags/v1.3.9`));
  assert.equal(fixture.calls[1].command, "gh");
  assert.ok(fixture.calls[1].args.includes("--verify-tag"));
});

test("a matching annotated tag is preserved when retrying publication", async () => {
  const fixture = publisherFixture({ "git/ref/tags/v1.3.9": { object: { type: "tag", sha: "annotation" } },
    "git/tags/annotation": { object: { type: "commit", sha } } });
  assert.equal(await publishRelease(env, fixture.dependencies), true);
  assert.ok(fixture.calls[0].args.includes(`${sha}:refs/heads/main`));
  assert.equal(fixture.calls[0].args.some((value) => value.includes(":refs/tags/")), false);
});

test("a complete existing release continues deployment without writes", async () => {
  const fixture = publisherFixture({ "releases/tags/v1.3.9": completeRelease,
    "git/ref/tags/v1.3.9": { object: { type: "commit", sha } } });
  assert.equal(await publishRelease(env, fixture.dependencies), true);
  assert.equal(fixture.calls.length, 0);
});

test("conflicting tags and incomplete releases are never overwritten", async () => {
  for (const overrides of [
    { "git/ref/tags/v1.3.9": { object: { type: "commit", sha: sourceSha } } },
    { "releases/tags/v1.3.9": { ...completeRelease, assets: [] }, "git/ref/tags/v1.3.9": { object: { type: "commit", sha } } },
  ]) {
    const fixture = publisherFixture(overrides);
    await assert.rejects(publishRelease(env, fixture.dependencies));
    assert.equal(fixture.calls.length, 0);
  }
});

test("main advancing during validation skips publication and deployment", async () => {
  const fixture = publisherFixture({ "git/ref/heads/main": { object: { sha: "c".repeat(40) } } });
  assert.equal(await publishRelease(env, fixture.dependencies), false);
  assert.equal(fixture.calls.length, 0);
});

test("a failed atomic push cannot create a release", async () => {
  const fixture = publisherFixture();
  fixture.dependencies.run = (command) => { fixture.calls.push(command); throw new Error("push rejected"); };
  await assert.rejects(publishRelease(env, fixture.dependencies), /push rejected/);
  assert.deepEqual(fixture.calls, ["git"]);
});
