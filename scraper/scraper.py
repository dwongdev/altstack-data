#!/usr/bin/env python3
"""
AltStack Data Scraper — Nightly GitHub Enrichment

Reads data/tools.json, updates live GitHub metadata for every tool
that has a `github_repo` field, and writes the enriched file back.

Enriched fields:
  - stars          (stargazers_count)
  - last_commit    (pushed_at)
  - language       (language)
  - license        (license.spdx_id)
  - description    (description, only if repo has one)

Usage:
  GITHUB_TOKEN=ghp_xxx python scraper/scraper.py
"""

import json
import os
import sys
import time

import requests

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "tools.json")
API_BASE = "https://api.github.com"


def get_headers():
    token = os.environ.get("GITHUB_TOKEN", "")
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_repo(owner_repo: str):
    """Fetch repository metadata from the GitHub API."""
    url = f"{API_BASE}/repos/{owner_repo}"
    try:
        resp = requests.get(url, headers=get_headers(), timeout=15)
        if resp.status_code == 200:
            return resp.json()
        print(f"  ⚠  {owner_repo}: HTTP {resp.status_code}", file=sys.stderr)
    except requests.RequestException as exc:
        print(f"  ⚠  {owner_repo}: {exc}", file=sys.stderr)
    return None


def enrich_tool(tool):
    """Enrich a single tool dict in-place. Returns True if anything changed."""
    repo_slug = tool.get("github_repo")
    if not repo_slug:
        return False

    data = fetch_repo(repo_slug)
    if data is None:
        return False

    changed = False

    # Stars
    new_stars = data.get("stargazers_count")
    if new_stars is not None and new_stars != tool.get("stars"):
        tool["stars"] = new_stars
        changed = True

    # Last commit (pushed_at)
    pushed = data.get("pushed_at")
    if pushed and pushed != tool.get("last_commit"):
        tool["last_commit"] = pushed
        changed = True

    # Language
    lang = data.get("language")
    if lang and lang != tool.get("language"):
        tool["language"] = lang
        changed = True

    # License
    lic = data.get("license")
    if lic and isinstance(lic, dict):
        spdx = lic.get("spdx_id") or lic.get("name")
        if spdx and spdx != "NOASSERTION" and spdx != tool.get("license"):
            tool["license"] = spdx
            changed = True

    # Description — only update if repo has one and tool doesn't already
    desc = data.get("description")
    if desc and not tool.get("description"):
        tool["description"] = desc
        changed = True

    return changed


def main():
    # Load
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        tools = json.load(f)

    print(f"Loaded {len(tools)} tools from {DATA_FILE}")

    updated = 0
    for tool in tools:
        repo = tool.get("github_repo")
        if not repo:
            continue
        print(f"  -> {repo}", end="")
        if enrich_tool(tool):
            print(" updated")
            updated += 1
        else:
            print(" — no changes")
        # Respect rate limits
        time.sleep(0.5)

    # Write back
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(tools, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nDone. {updated}/{len(tools)} tools enriched.")


if __name__ == "__main__":
    main()
