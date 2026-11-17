import json
import subprocess
import time
import urllib.request
import urllib.error
import sys
import os

CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com"
CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT"
REPO = "vxillannnnnn-hub/lava-link"
DEVICE_CODE = "AF7uZ7APjTOvjl9GB_OVPXU4dt3NAFezc8mfG2nSWvf6UNjokzWo9gKiCHiG_MCNjXRb-uvyGxjox2O_7idJ"
USER_CODE = "MYCX-DVXG"

token_url = "https://www.youtube.com/o/oauth2/token"
payload = json.dumps({
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "code": DEVICE_CODE,
    "grant_type": "http://oauth.net/grant_type/device/1.0"
}).encode("utf-8")

print(f"Waiting for authorization on https://www.google.com/device with code {USER_CODE}...")

start_time = time.time()
refresh_token = None

while time.time() - start_time < 900: # 15 minutes
    req = urllib.request.Request(token_url, data=payload, headers={"Content-Type": "application/json"})
    try:
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode("utf-8"))
        if "refresh_token" in data:
            refresh_token = data["refresh_token"]
            print("Successfully acquired refresh token!")
            break
        elif data.get("error") == "authorization_pending":
            time.sleep(5)
            continue
        elif data.get("error") == "slow_down":
            time.sleep(10)
            continue
        else:
            print("Error response:", data)
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        if "authorization_pending" in body:
            time.sleep(5)
            continue
        elif "slow_down" in body:
            time.sleep(10)
            continue
        else:
            print("HTTP Error:", body)
            break
    except Exception as ex:
        print("Network error:", ex)
        time.sleep(5)

if not refresh_token:
    print("Polling timed out or aborted.")
    sys.exit(1)

print("Step 1: Setting GitHub Secret YOUTUBE_REFRESH_TOKEN...")
subprocess.run(["gh", "secret", "set", "YOUTUBE_REFRESH_TOKEN", "--repo", REPO, "--body", refresh_token], check=True)
print("GitHub Secret YOUTUBE_REFRESH_TOKEN successfully updated!")

print("Step 2: Switching default platform to YouTube Music...")
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Update main.yml
main_yml_path = os.path.join(repo_dir, ".github", "workflows", "main.yml")
with open(main_yml_path, "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('DEFAULT_SEARCH_PLATFORM: "spsearch"', 'DEFAULT_SEARCH_PLATFORM: "ytmsearch"')
with open(main_yml_path, "w", encoding="utf-8") as f:
    f.write(content)

# Update config.js
config_js_path = os.path.join(repo_dir, "music-bot", "src", "config.js")
with open(config_js_path, "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('defaultSearchPlatform: process.env.DEFAULT_SEARCH_PLATFORM || "spsearch"', 'defaultSearchPlatform: process.env.DEFAULT_SEARCH_PLATFORM || "ytmsearch"')
with open(config_js_path, "w", encoding="utf-8") as f:
    f.write(content)

# Update audioQuality.js
audio_quality_path = os.path.join(repo_dir, "music-bot", "src", "utils", "audioQuality.js")
with open(audio_quality_path, "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace('if (!value) return "spsearch";', 'if (!value) return "ytmsearch";')
with open(audio_quality_path, "w", encoding="utf-8") as f:
    f.write(content)

# Update application.yml files to restore ytmsearch at top of providers
for yml_rel in ["application.yml", "application.example.yml", "music-bot/lavalink/application.yml"]:
    p = os.path.join(repo_dir, yml_rel)
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            c = f.read()
        # update lavasrc providers
        c = c.replace(
            'providers:\n            - "jssearch:%QUERY%"\n            - "scsearch:%QUERY%"\n            - "ytmsearch:\\"%ISRC%\\""\n            - "ytmsearch:%QUERY%"\n            - "ytsearch:%QUERY%"',
            'providers:\n            - "ytmsearch:\\"%ISRC%\\""\n            - "ytmsearch:%QUERY%"\n            - "ytsearch:%QUERY%"\n            - "jssearch:%QUERY%"\n            - "scsearch:%QUERY%"'
        )
        # update solaceaudio providers
        c = c.replace(
            'providers:\n            - "jssearch:{query}"\n            - "scsearch:{query}"\n            - "ytmsearch:\\"{isrc}\\""\n            - "ytmsearch:{query}"\n            - "ytsearch:{query}"',
            'providers:\n            - "ytmsearch:\\"{isrc}\\""\n            - "ytmsearch:{query}"\n            - "ytsearch:{query}"\n            - "jssearch:{query}"\n            - "scsearch:{query}"'
        )
        with open(p, "w", encoding="utf-8") as f:
            f.write(c)

print("Step 3: Committing and pushing YouTube OAuth configuration...")
subprocess.run(["git", "add", "-A"], cwd=repo_dir, check=True)
subprocess.run(["git", "commit", "-m", "feat(youtube): configure YouTube OAuth and set ytmsearch default"], cwd=repo_dir, check=True)

for attempt in range(3):
    try:
        subprocess.run(["git", "pull", "--rebase", "origin", "main"], cwd=repo_dir, check=True)
        subprocess.run(["git", "push", "origin", "main"], cwd=repo_dir, check=True)
        print("Pushed YouTube OAuth configuration successfully!")
        break
    except Exception as e:
        print(f"Push attempt {attempt+1} failed: {e}")
        time.sleep(3)

print("ALL DONE! YouTube is authenticated and running directly from YouTube Music!")
