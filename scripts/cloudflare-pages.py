"""Deploy verified release files as a public NodeGet theme distribution."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
import zipfile


HEADERS = """/*
  Access-Control-Allow-Origin: *
/config.json
  Cache-Control: no-store
/nodeget-theme.json
  Cache-Control: no-cache
/nodeget-theme-files.json
  Cache-Control: no-cache
"""
CONTROL_FILES = {"_headers", "_redirects", "_routes.json", ".assetsignore"}
FILE_LIST = "nodeget-theme-files.json"
VERIFIER_USER_AGENT = "NodeGet-Theme-SAO-Release-Verifier/1.0"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def distribution_url(value):
    url = urlsplit(value)
    check(url.scheme == "https" and not url.username and not url.password
          and not url.port and not url.query and not url.fragment
          and url.path in ("", "/")
          and re.fullmatch(r"[a-z0-9-]+\.pages\.dev", url.hostname or ""),
          "Expected the project's HTTPS pages.dev address")
    return f"https://{url.hostname}"


def ensure_project():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    project = os.environ.get("CLOUDFLARE_PAGES_PROJECT", "")
    check(re.fullmatch(r"[a-fA-F0-9]{32}", account),
          "Configure the CLOUDFLARE_ACCOUNT_ID repository secret")
    check(bool(token), "Configure the CLOUDFLARE_API_TOKEN repository secret")
    check(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?", project),
          "Configure CLOUDFLARE_PAGES_PROJECT as a lowercase Pages project name")
    base = f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects"

    def call(url, payload=None):
        request = Request(url, data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": f"Bearer {token}",
                                   "Content-Type": "application/json"})
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
        check(data.get("success") is True, "Cloudflare rejected the Pages project request")
        return data["result"]

    try:
        try:
            result = call(f"{base}/{project}")
        except HTTPError as error:
            if error.code != 404:
                raise
            result = call(base, {"name": project, "production_branch": "main"})
    except HTTPError as error:
        raise ValueError(f"Cloudflare Pages request failed (HTTP {error.code})") from None
    except URLError:
        raise ValueError("Unable to connect to the Cloudflare Pages API") from None
    check(result.get("name") == project, "Unexpected Pages project returned")
    check(result.get("production_branch") == "main",
          "This Pages project must use main as its production branch")
    url = distribution_url(f"https://{result.get('subdomain', '')}")
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"url={url}\n")
    print(f"Pages distribution project: {url}")


def prepare(archive_path, directory, url):
    url = distribution_url(url)
    root = Path(directory)
    check(not root.exists(), "The deployment staging directory must not already exist")
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        check(len(names) == len(set(names)), "Duplicate ZIP entries")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            check(not path.is_absolute() and ".." not in path.parts
                  and "\\" not in entry.filename and ":" not in entry.filename
                  and not stat.S_ISLNK(entry.external_attr >> 16), "Unsafe ZIP entry")
            check(path.parts and path.parts[0] not in {"functions", "_worker.js"},
                  "The distribution must contain static files only")
            check(not any(part.startswith(".env") for part in path.parts),
                  "Environment files must not be deployed")
        config = json.loads(archive.read("config.json"))
        check(config.get("site_tokens") == [], "Distribution config must have empty site_tokens")
        manifest = json.loads(archive.read("nodeget-theme.json"))
        check(manifest.get("name") == "NodeGet-Theme-SAO", "Unexpected theme name")
        original_files = json.loads(archive.read(FILE_LIST))
        check(isinstance(original_files, list) and all(isinstance(name, str) for name in original_files)
              and set(original_files) <= set(names), "Invalid theme file list")
        # Validate everything before writing the staging directory.
        check(archive.testzip() is None, "Corrupt ZIP entry")
        root.mkdir(parents=True)
        archive.extractall(root)
    manifest["dist_page"] = url
    (root / "nodeget-theme.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                            encoding="utf-8")
    # Pages consumes _headers; NodeGet must not try to download it as a theme asset.
    files = sorted(name for name in names if not name.endswith("/")
                   and name != FILE_LIST and name not in CONTROL_FILES)
    (root / FILE_LIST).write_text(json.dumps(files, indent=2) + "\n", encoding="utf-8")
    (root / "_headers").write_text(HEADERS, encoding="utf-8")
    print(f"Prepared {len(files)} importable files for theme v{manifest['version']}")


def verify(directory, url):
    url = distribution_url(url)
    root = Path(directory)
    files = json.loads((root / FILE_LIST).read_text(encoding="utf-8")) + [FILE_LIST]

    def verify_file(name):
        expected = hashlib.sha256((root / name).read_bytes()).digest()
        # Cache-busting checks the newly deployed content, including immutable assets.
        target = f"{url}/{quote(name, safe='/')}?verify={expected.hex()[:16]}"
        failure = "request failed"
        for attempt in range(3):
            try:
                # Pages can reject urllib's default UA; identify the application.
                request = Request(target, headers={"Origin": "https://dash.nodeget.com",
                                                   "Cache-Control": "no-cache",
                                                   "User-Agent": VERIFIER_USER_AGENT})
                with urlopen(request, timeout=20) as response:
                    data = response.read()
                    cors = response.headers.get("Access-Control-Allow-Origin")
                failures = []
                if hashlib.sha256(data).digest() != expected:
                    failures.append("SHA256 mismatch")
                if cors != "*":
                    failures.append("Access-Control-Allow-Origin must be *")
                if not failures:
                    return
                failure = "; ".join(failures)
            except HTTPError as error:
                failure = f"HTTP {error.code}"
            except TimeoutError:
                failure = "request timed out"
            except URLError as error:
                failure = "request timed out" if isinstance(error.reason, TimeoutError) else "network request failed"
            if attempt < 2:
                time.sleep(2)
        raise ValueError(f"Content or cross-origin verification failed: {name} ({failure})")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify_file, files))
    print(f"Verified all {len(files)} public files and NodeGet cross-origin access: {url}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("project")
    prepare_args = commands.add_parser("prepare")
    prepare_args.add_argument("archive")
    prepare_args.add_argument("directory")
    prepare_args.add_argument("url")
    verify_args = commands.add_parser("verify")
    verify_args.add_argument("directory")
    verify_args.add_argument("url")
    args = parser.parse_args()
    try:
        if args.command == "project":
            ensure_project()
        elif args.command == "prepare":
            prepare(args.archive, args.directory, args.url)
        else:
            verify(args.directory, args.url)
    except (ValueError, KeyError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
