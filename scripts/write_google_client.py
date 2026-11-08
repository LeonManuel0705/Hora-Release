# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""Writes the Google OAuth client a desktop build carries into app/google_client.json.

The client comes from GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, which the release workflow fills from
repository secrets. It is a Google "Desktop app" client, whose secret Google does not treat as confidential, but it
never belongs in the repository, so the file is ignored by git. Without both values an earlier file is removed and the
build offers no Google sign-in.
"""

import json
import os
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "app" / "google_client.json"


def write(target: Path = TARGET) -> bool:
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    if not (client_id and secret):
        if target.exists():
            target.unlink()
        return False
    client = {
        "installed": {
            "client_id": client_id,
            "client_secret": secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    target.write_text(json.dumps(client, indent=2) + "\n", encoding="utf-8")
    return True


if __name__ == "__main__":
    if write():
        print("=== The build carries the Google OAuth client from GOOGLE_OAUTH_CLIENT_ID ===")
    else:
        print("=== No GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, the build offers no Google sign-in ===")
