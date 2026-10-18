"""Copy captured cloud browser evidence to Git blobs for authenticated pixel review.

No branch or hosting mutation. The original Actions artifact remains authoritative.
Only file names, sizes and blob identifiers are printed. Authentication is the
existing job token and is never inspected or logged.
"""
import base64
import json
import os
from pathlib import Path
import urllib.request

root = Path(os.environ["REVIEW_ROOT"])
repo = os.environ["GITHUB_REPOSITORY"]
for image in sorted(root.glob("*.png")):
    data = image.read_bytes()
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/git/blobs",
        data=json.dumps({"content": base64.b64encode(data).decode("ascii"), "encoding": "base64"}).encode(),
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
    # The connector reads UTF-8 blobs. Preserve the identical PNG as ASCII
    # base64 as well so the reviewer can emit its actual pixels without files.
    text_request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/git/blobs",
        data=json.dumps({"content": base64.b64encode(data).decode("ascii"), "encoding": "utf-8"}).encode(),
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
        method="POST",
    )
    with urllib.request.urlopen(text_request) as response:
        text_result = json.load(response)
    print("BROWSER_REVIEW_BLOB " + json.dumps({"file": image.name, "sha": result["sha"],
          "base64_text_sha": text_result["sha"], "bytes": len(data)}))
