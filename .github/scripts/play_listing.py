"""Uploads the store listing pictures in apps/android/store/ to Google Play.

Runs in the Play listing workflow with the same Play-only service account as play.yml. It
replaces the icon, the feature graphic and the phone screenshots in every listing language the
app has, in one edit, so the listing never shows half old and half new pictures.
"""

import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PACKAGE = "dev.johnlaff.neko"
STORE = Path("apps/android/store")
IMAGES = {
    "icon": ["icon-512.png"],
    "featureGraphic": ["feature-graphic.png"],
    "phoneScreenshots": sorted(p.name for p in STORE.glob("phone-*.png")),
}

info = json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"])
creds = service_account.Credentials.from_service_account_info(
    info, scopes=["https://www.googleapis.com/auth/androidpublisher"]
)
edits = build("androidpublisher", "v3", credentials=creds, cache_discovery=False).edits()

edit = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
listings = edits.listings().list(packageName=PACKAGE, editId=edit).execute().get("listings", [])
languages = [listing["language"] for listing in listings]
if not languages:
    sys.exit("The app has no store listing yet: fill one in Play Console first.")

for language in languages:
    for kind, files in IMAGES.items():
        edits.images().deleteall(packageName=PACKAGE, editId=edit, language=language, imageType=kind).execute()
        for name in files:
            edits.images().upload(
                packageName=PACKAGE,
                editId=edit,
                language=language,
                imageType=kind,
                media_body=MediaFileUpload(str(STORE / name), mimetype="image/png"),
            ).execute()
        print(f"{language} {kind}: {', '.join(files)}")

try:
    edits.commit(packageName=PACKAGE, editId=edit).execute()
except HttpError as e:
    # Apps with changes waiting in the Publishing overview only accept edits sent this way.
    if "changesNotSentForReview" not in str(e):
        raise
    edits.commit(packageName=PACKAGE, editId=edit, changesNotSentForReview=True).execute()
print("Listing pictures updated.")
