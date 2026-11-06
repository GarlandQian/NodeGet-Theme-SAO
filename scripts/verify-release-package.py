"""Check the distribution ZIP before attaching it to a GitHub Release."""
import json
import sys
import zipfile
from pathlib import PurePosixPath

archive_path, expected_version = sys.argv[1:]
with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    required = {"index.html", "nodeget-theme.json", "nodeget-theme-files.json", "config.json", "custom.css", "custom.js", "preview.png", "LICENSE"}
    assert len(names) == len(set(names)), "Duplicate ZIP entries"
    assert required <= set(names), "Missing root theme files"
    assert any(name.startswith("assets/") for name in names), "Missing assets"
    assert all(not name.startswith(("/", "dist/")) and ".." not in PurePosixPath(name).parts for name in names), "Invalid ZIP layout"
    assert archive.testzip() is None, "Corrupt ZIP entry"
    manifest = json.loads(archive.read("nodeget-theme.json"))
    assert manifest["version"] == expected_version, "ZIP version differs from release version"
    assert manifest["name"] == "NodeGet-Theme-SAO", "Unexpected theme name"
    filelist = json.loads(archive.read("nodeget-theme-files.json"))
    assert isinstance(filelist, list) and all(isinstance(name, str) for name in filelist), "Invalid theme file list"
    assert len(filelist) == len(set(filelist)), "Duplicate file list entries"
    assert set(filelist) <= set(names), "File list references missing ZIP entries"
    assert "index.html" in filelist and "nodeget-theme.json" in filelist, "Incomplete theme file list"
    if "config.json" in names:
        config = json.loads(archive.read("config.json"))
        assert config.get("site_tokens") == [], "Distribution ZIP must not contain configured connections"
    print(f"Verified {archive_path}: {len(names)} files, version {expected_version}.")
