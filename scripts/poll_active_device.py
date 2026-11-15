import json
import subprocess
import time
import urllib.request
import urllib.error
import sys

CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com"
CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT"
REPO = "vxillannnnnn-hub/lava-link"
DEVICE_CODE = "AF7uZ7D-POHlsZtWzZxymIOOHtJjzGDG5Z0wstMf9metMOgmhxIBpiVlE_iHv6mqiJ-22UAahua9-JLWGzvnJGI"

token_url = "https://www.youtube.com/o/oauth2/token"
payload = json.dumps({
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "code": DEVICE_CODE,
    "grant_type": "http://oauth.net/grant_type/device/1.0"
}).encode("utf-8")

print("Polling for device authorization...", flush=True)
start_time = time.time()
while time.time() - start_time < 1800:
    req = urllib.request.Request(token_url, data=payload, headers={"Content-Type": "application/json"})
    try:
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode("utf-8"))
        refresh_token = data.get("refresh_token")
        if refresh_token:
            print(f"Got refresh token: {refresh_token[:10]}...", flush=True)
            subprocess.run(["gh", "secret", "set", "YOUTUBE_REFRESH_TOKEN", "--repo", REPO], input=refresh_token.encode("utf-8"), check=True)
            print("Successfully updated YOUTUBE_REFRESH_TOKEN secret in GitHub!", flush=True)
            sys.exit(0)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        if "authorization_pending" in body:
            time.sleep(5)
            continue
        elif "slow_down" in body:
            time.sleep(10)
            continue
        else:
            print("HTTP error:", body, flush=True)
            break
    except Exception as ex:
        print("Error:", ex, flush=True)
        time.sleep(5)
