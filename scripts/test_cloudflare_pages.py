"""Regression checks for public Pages distribution and restricted project setup."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import zipfile


spec = importlib.util.spec_from_file_location("pages", Path(__file__).with_name("cloudflare-pages.py"))
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
SITE = "https://sao-test.pages.dev"


class Response(io.BytesIO):
    def __init__(self, data, cors="*"):
        super().__init__(data)
        self.headers = {"Access-Control-Allow-Origin": cors}


class PagesDistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "release.zip"
        self.output = self.root / "pages-dist"

    def make_zip(self, connections=None, extra=None):
        files = {
            "index.html": "<html>SAO</html>", "assets/app.js": "void 0;",
            "config.json": json.dumps({"site_tokens": connections or []}),
            "nodeget-theme.json": json.dumps({"name": "NodeGet-Theme-SAO", "version": "1.3.8", "dist_page": ""}),
            "_headers": "/*\n  Access-Control-Allow-Origin: *\n",
        }
        files[pages.FILE_LIST] = json.dumps(sorted(files))
        with zipfile.ZipFile(self.archive, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
            if extra:
                archive.writestr(*extra)

    def prepare(self):
        with redirect_stdout(io.StringIO()):
            pages.prepare(self.archive, self.output, SITE)

    def test_static_release_becomes_an_importable_distribution(self):
        self.make_zip()
        self.prepare()
        manifest = json.loads((self.output / "nodeget-theme.json").read_text())
        self.assertEqual(manifest["dist_page"], SITE)
        self.assertEqual(manifest["version"], "1.3.8")
        self.assertEqual(json.loads((self.output / "config.json").read_text())["site_tokens"], [])
        self.assertNotIn("_headers", json.loads((self.output / pages.FILE_LIST).read_text()))
        self.assertIn("Access-Control-Allow-Origin: *", (self.output / "_headers").read_text())
        self.assertEqual((self.output / "assets/app.js").read_text(), "void 0;")

    def test_configured_connections_are_rejected_before_extraction(self):
        self.make_zip(connections=[{"token": "fake-test-credential"}])
        with self.assertRaisesRegex(ValueError, "empty site_tokens"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_unsafe_archives_do_not_write_files(self):
        link = zipfile.ZipInfo("link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for extra in [("../outside", "bad"), ("_worker.js", "bad"),
                      ("functions/api.js", "bad"), (".env.local", "bad"), (link, "../outside")]:
            with self.subTest(entry=str(extra[0])):
                self.make_zip(extra=extra)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_existing_directory_is_not_overwritten(self):
        self.make_zip()
        self.output.mkdir()
        marker = self.output / "keep"
        marker.write_text("keep")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(marker.read_text(), "keep")

    def test_distribution_url_requires_the_canonical_pages_origin(self):
        self.assertEqual(pages.distribution_url(SITE + "/"), SITE)
        for url in ["http://sao-test.pages.dev", "https://example.com", SITE + "/nested", SITE + "?x=1",
                    "https://user@sao-test.pages.dev", SITE + ":443"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pages.distribution_url(url)

    def test_online_verification_requires_matching_bytes_and_cors(self):
        self.make_zip()
        self.prepare()

        def response(request, timeout, corrupt=False, cors="*"):
            name = request.full_url.split("?", 1)[0][len(SITE) + 1:]
            self.assertEqual(request.headers["Origin"], "https://dash.nodeget.com")
            self.assertEqual(request.headers["User-agent"], "NodeGet-Theme-SAO-Release-Verifier/1.0")
            return Response(b"wrong content" if corrupt else (self.output / name).read_bytes(), cors)

        with patch.object(pages, "urlopen", side_effect=response), redirect_stdout(io.StringIO()):
            pages.verify(self.output, SITE)
        for corrupt, cors, reason in [(True, "*", "SHA256 mismatch"),
                                      (False, None, "Access-Control-Allow-Origin must be"),
                                      (False, "https://other.example", "Access-Control-Allow-Origin must be")]:
            with self.subTest(reason=reason, cors=cors), \
                 patch.object(pages, "urlopen", side_effect=lambda *a, **k: response(*a, **k, corrupt=corrupt, cors=cors)), \
                 patch.object(pages.time, "sleep"), self.assertRaisesRegex(ValueError, reason):
                pages.verify(self.output, SITE)

    def test_online_request_failures_report_safe_diagnostics(self):
        self.output.mkdir()
        (self.output / "LICENSE").write_text("license")
        (self.output / pages.FILE_LIST).write_text(json.dumps(["LICENSE"]))
        cases = [
            (HTTPError(SITE, 403, "private-response-detail", None, None), "HTTP 403"),
            (TimeoutError("private-response-detail"), "request timed out"),
            (URLError(TimeoutError("private-response-detail")), "request timed out"),
            (URLError("private-response-detail"), "network request failed"),
        ]
        for error, reason in cases:
            with self.subTest(reason=reason), patch.object(pages, "urlopen", side_effect=error), \
                 patch.object(pages.time, "sleep"), self.assertRaises(ValueError) as raised:
                pages.verify(self.output, SITE)
            self.assertEqual(str(raised.exception),
                             f"Content or cross-origin verification failed: LICENSE ({reason})")


class PagesProjectTests(unittest.TestCase):
    def setUp(self):
        env = {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN": "fake-test-credential",
               "CLOUDFLARE_PAGES_PROJECT": "sao-test"}
        self.env = patch.dict(os.environ, env, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def response(self, branch="main"):
        return Response(json.dumps({"success": True, "result": {
            "name": "sao-test", "production_branch": branch, "subdomain": "sao-test.pages.dev",
        }}).encode())

    def test_missing_project_is_created_with_main_and_reused_later(self):
        missing = HTTPError("https://api.cloudflare.com/", 404, "Not found", None, None)
        with patch.object(pages, "urlopen", side_effect=[missing, self.response()]) as call, \
             redirect_stdout(io.StringIO()):
            pages.ensure_project()
        payload = json.loads(call.call_args_list[1].args[0].data)
        self.assertEqual(payload, {"name": "sao-test", "production_branch": "main"})
        with patch.object(pages, "urlopen", return_value=self.response()) as call, redirect_stdout(io.StringIO()):
            pages.ensure_project()
        self.assertEqual(call.call_count, 1)

    def test_authorization_failure_does_not_create_or_echo_credentials(self):
        denied = HTTPError("https://api.cloudflare.com/", 403, "fake-test-credential", None, None)
        with patch.object(pages, "urlopen", side_effect=denied) as call:
            with self.assertRaisesRegex(ValueError, r"^Cloudflare Pages request failed \(HTTP 403\)$"):
                pages.ensure_project()
        self.assertEqual(call.call_count, 1)

    def test_existing_project_branch_is_not_changed(self):
        with patch.object(pages, "urlopen", return_value=self.response("other")) as call:
            with self.assertRaisesRegex(ValueError, "main"):
                pages.ensure_project()
        self.assertEqual(call.call_count, 1)


if __name__ == "__main__":
    unittest.main()
