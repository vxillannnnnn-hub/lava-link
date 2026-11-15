import json
import subprocess
import time
import urllib.request
import urllib.error
import sys

CLIENT_ID = "861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com"
CLIENT_SECRET = "SboVhoG9s0rNafixCSGGKXAT"
REPO = "vxillannnnnn-hub/lava-link"

def get_device_code():
    url = "https://www.youtube.com/o/oauth2/device/code"
    payload = json.dumps({
        "client_id": CLIENT_ID,
        "scope": "https://www.googleapis.com/auth/youtube"
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        res = urllib.request.urlopen(req)
        return json.loads(res.read().decode("utf-8"))
    except Exception as e:
        print(f"Error requesting device code: {e}")
        sys.exit(1)

def poll():
    print("==================================================")
    print("🔑 YouTube OAuth Token Generator for Lava-Link")
    print("==================================================")
    
    device_data = get_device_code()
    device_code = device_data["device_code"]
    user_code = device_data["user_code"]
    verification_url = device_data.get("verification_url", "https://www.google.com/device")
    interval = device_data.get("interval", 5)

    print(f"\n👉 1. Open your browser and go to: {verification_url}")
    print(f"👉 2. Enter this code: {user_code}\n")
    print("Waiting for approval (you have 15 minutes)...")
    
    token_url = "https://www.youtube.com/o/oauth2/token"
    payload = json.dumps({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": device_code,
        "grant_type": "http://oauth.net/grant_type/device/1.0"
    }).encode("utf-8")

    start_time = time.time()
    while time.time() - start_time < 900: # 15 minutes
        req = urllib.request.Request(token_url, data=payload, headers={"Content-Type": "application/json"})
        try:
            res = urllib.request.urlopen(req)
            data = json.loads(res.read().decode("utf-8"))
            refresh_token = data.get("refresh_token")
            if refresh_token:
                print("\n==================================================")
                print("🎉 SUCCESS! YouTube Refresh Token generated!")
                print("==================================================")
                
                # Save to GitHub Secret via gh CLI
                try:
                    p = subprocess.run(["gh", "secret", "set", "YOUTUBE_REFRESH_TOKEN", "--repo", REPO], input=refresh_token.encode("utf-8"), check=True)
                    print(f"✅ Automatically updated YOUTUBE_REFRESH_TOKEN in {REPO} secrets!")
                except Exception as e:
                    print(f"⚠️ Could not set secret automatically: {e}")
                    print(f"Manually set YOUTUBE_REFRESH_TOKEN in GitHub repository settings to: {refresh_token}")
                
                return refresh_token
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            if "authorization_pending" in body:
                time.sleep(interval)
                continue
            elif "slow_down" in body:
                time.sleep(interval + 5)
                continue
            else:
                print(f"Polling stopped with error: {body}")
                break
        except Exception as ex:
            print(f"Network error: {ex}")
            time.sleep(5)
            
    print("Polling timed out or aborted.")
    return None

if __name__ == "__main__":
    poll()
