# 🎧 Pulse - Ultra-Low Latency Discord Music Bot

Pulse is a production-grade, state-of-the-art Discord Music Bot engineered specifically for your self-hosted **Lavalink v4.2.2** node with native Linux C-epoll transport, Generational ZGC, and lossless Opus streaming.

---

## ✨ Features at a Glance

- **Multi-Source Streaming**:
  - 🟢 **Spotify** (Tracks, Playlists, Albums, Artists — **NO Spotify API keys required** via built-in SolaceAudio!)
  - 🔴 **YouTube** (Search, Playlists, Shorts, Music Mixes via `dev.lavalink.youtube` plugin)
  - 🟠 **SoundCloud** (Search, Sets, Top Tracks)
  - 🟢 **JioSaavn** (High-bitrate Indian streaming library)
  - 🌐 **Direct Audio Streams** (Web radios, Icecast, Shoutcast, HTTP/HTTPS audio feeds)
- **Live Autocomplete Search**:
  - As you type inside Discord's `/play` command input, top matching tracks appear in real time with duration and artist tags!
- **Interactive "Now Playing" Dashboard**:
  - Live progress bar with current and total timestamps (`🔘▬▬▬▬▬▬▬▬ 01:23 / 03:45`)
  - Full touch controls: `⏮️ Previous`, `⏯️ Play/Pause`, `⏭️ Skip`, `🔀 Shuffle`, `⏹️ Stop`
  - Auxiliary controls: `🔁 Loop (Track/Queue/Off)`, `🔉 Vol -`, `🔊 Vol +`, `📜 Lyrics`, `⭐ Save/DM`
  - Real-time DSP Filter Select Menu right on the card!
- **Real-Time DSP Audio Filters & Equalizers**:
  - 🎧 **8D Spatial Audio** (Smooth orbital 360° binaural panning)
  - 🔊 **Bass Boost (Low / Med / High)** (Low-end punch up to +9dB)
  - ⚡ **Nightcore** (Accelerated 1.15x tempo + 1.25x pitch)
  - 🌊 **Vaporwave** (Relaxed 0.85x speed + 0.80x chill lo-fi pitch)
  - 🎤 **Karaoke** (Center vocal frequency attenuation for singing along)
  - 🎵 **Pop & Rock Acoustic Curves**
  - 🔄 **Neutral Reset** (Restores 0ms direct Opus passthrough)
- **Synchronized Real-Time Lyrics**:
  - Fetches timed lyrics line-by-line via Lavalink `/v4/lyrics` API and LRCLIB fallback, highlighting current line.
- **Smart Queue & Flow**:
  - Paginated queue (`/queue`) with interactive `⏮️`, `◀️`, `▶️`, `⏭️` navigation buttons.
  - Smart Autoplay (`/autoplay`): Continuous playback recommendations when queue runs dry.
  - 24/7 Mode (`/247`): Keeps the bot permanently in voice channel.
  - Auto-deafen on join to save CPU and bandwidth.
  - Inactivity and empty-channel auto-disconnect timers.

---

## 📁 Project Structure

```
music-bot/
├── src/
│   ├── commands/
│   │   ├── music/
│   │   │   ├── play.js         # Play track, album, playlist with live autocomplete
│   │   │   ├── search.js       # Interactive top 10 search dropdown menu
│   │   │   ├── pause.js        # Pause playback
│   │   │   ├── resume.js       # Resume playback
│   │   │   ├── skip.js         # Skip current song or jump to position
│   │   │   ├── previous.js     # Rewind to previous song in session history
│   │   │   ├── stop.js         # Purge queue and disconnect
│   │   │   ├── queue.js        # Interactive paginated queue menu
│   │   │   ├── nowplaying.js   # Now Playing embed & interactive buttons
│   │   │   ├── volume.js       # Volume level (0% - 200%)
│   │   │   ├── loop.js         # Loop mode (off, track, queue)
│   │   │   ├── shuffle.js      # Fisher-Yates shuffle
│   │   │   ├── seek.js         # Fast-forward / rewind to timestamp
│   │   │   ├── replay.js       # Replay track from 0:00
│   │   │   ├── clear.js        # Purge upcoming queue
│   │   │   ├── remove.js       # Remove track by position
│   │   │   ├── move.js         # Move track position
│   │   │   ├── swap.js         # Swap two track positions
│   │   │   ├── autoplay.js     # AI continuous recommendations
│   │   │   ├── 247.js          # 24/7 continuous voice channel stay
│   │   │   ├── filter.js       # 8D, Bassboost, Nightcore, Vaporwave, etc.
│   │   │   ├── lyrics.js       # Synchronized real-time lyrics
│   │   │   ├── join.js         # Summon bot to voice channel
│   │   │   ├── leave.js        # Disconnect bot from voice channel
│   │   │   └── grab.js         # DM current track details to user
│   │   └── info/
│   │       ├── help.js         # Interactive categorized help book
│   │       ├── stats.js        # Lavalink ZGC, RAM, CPU & bot telemetry
│   │       └── ping.js         # Discord & Lavalink roundtrip latency
│   ├── events/
│   │   └── client/
│   │       ├── ready.js
│   │       ├── interactionCreate.js
│   │       └── voiceStateUpdate.js
│   ├── structures/
│   │   ├── BotClient.js
│   │   └── LavalinkHandler.js
│   ├── utils/
│   │   ├── embed.js
│   │   ├── formatters.js
│   │   ├── logger.js
│   │   └── playerController.js
│   ├── config.js
│   ├── deploy-commands.js
│   └── index.js
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Quickstart Guide

### 1. Get Discord Bot Credentials

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name (e.g. `Pulse Music`), and agree to terms.
3. In the sidebar, navigate to **Bot**:
   - Click **Reset Token** and copy your **Bot Token**.
   - Under **Privileged Gateway Intents**, enable:
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent** (optional, recommended)
4. In the sidebar, navigate to **Installation**:
   - Under **Default Install Settings**, select:
     - Scopes: `bot`, `applications.commands`
     - Bot Permissions: `Administrator` (or `Connect`, `Speak`, `Use Voice Activity`, `Send Messages`, `Embed Links`, `Read Message History`).
   - Copy the generated **Install Link** to invite the bot to your Discord server.
5. In the sidebar, navigate to **General Information**:
   - Copy the **Application ID** (this is your `CLIENT_ID`).

---

### 2. Configure `.env`

Open `music-bot/.env` and paste your Discord credentials. Your self-hosted Lavalink node credentials are pre-configured:

```env
# Discord Credentials
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_test_server_id_here   # Optional: set for instant slash command registration!

# Preconfigured for your live Lavalink Node:
LAVALINK_HOST=lavalink.opendrive.indevs.in
LAVALINK_PORT=443
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=true
LAVALINK_ID=Primary-Ultra-Node
```

---

### 3. Deploy Slash Commands

Register all 25+ application slash commands to Discord:

```bash
cd music-bot
npm run deploy
```

> 💡 **Tip**: If `GUILD_ID` is set in `.env`, commands update **instantly** in that server. If `GUILD_ID` is left empty, commands register globally across all servers (takes ~1-5 minutes to propagate across Discord's CDN).

---

### 4. Start the Bot

Run the bot with:

```bash
npm start
```

Or run with native auto-reloading during development:

```bash
npm run dev
```

---

## 🎛️ Command Cheat Sheet

| Command | Description |
|---|---|
| `/play <query>` | Stream any song, artist, playlist, or URL with live autocomplete suggestions |
| `/search <query>` | Search top 10 results and choose interactively via dropdown menu |
| `/nowplaying` | Display current song and interactive controller dashboard |
| `/queue [page]` | Paginated view of upcoming tracks with interactive navigation |
| `/pause` / `/resume` | Pause or smoothly unpause playback |
| `/skip [to]` | Skip track or jump directly to a position in queue |
| `/previous` | Rewind to previous track from session history |
| `/replay` | Replay current song from 0:00 |
| `/seek <time>` | Seek to timestamp (`1:30`, `90s`, `2m`) |
| `/volume <0-100>` | Set playback volume (100% = unity gain, clipping-safe) |
| `/filter <preset>` | Apply 8D, Bassboost, Nightcore, Vaporwave, Karaoke, or EQ |
| `/loop <mode>` | Cycle repeat mode (`off`, `track`, `queue`) |
| `/shuffle` | Randomize upcoming queue tracks |
| `/clear` | Clear upcoming songs from queue |
| `/remove <position>` | Remove specific song by queue position |
| `/move <from> <to>` | Move track position in queue |
| `/swap <pos1> <pos2>` | Swap positions of two tracks in queue |
| `/autoplay` | Toggle AI continuous recommendations when queue ends |
| `/247` | Toggle 24/7 continuous voice channel stay mode |
| `/lyrics [song]` | Display synchronized real-time lyrics |
| `/grab` | Send current song & artwork to your private DMs |
| `/join` / `/leave` | Summon or disconnect bot |
| `/stop` | Stop playback, purge queue, and leave voice channel |
| `/stats` | View real-time Lavalink ZGC latency, RAM, CPU & player count |
| `/ping` | Test Discord gateway and Lavalink node latency |
| `/audio` | Diagnose source, codec path, channel bitrate and node frame drops |
| `/help` | Comprehensive interactive guidebook |

---

## 🛡️ Production Deployment (PM2)

To keep Pulse running 24/7 in background with automatic restarts on system reboots:

```bash
npm install -g pm2
cd music-bot
pm2 start src/index.js --name "pulse-music"
pm2 save
pm2 startup
```

Monitor logs in real-time:
```bash
pm2 logs pulse-music
```

---

## 🎧 Lavalink Node Details

Your bot connects directly to:
- **Host**: `lavalink.opendrive.indevs.in`
- **Port**: `443` (WSS / HTTPS)
- **Engine**: Lavalink v4.2.2 on Java 21 Generational ZGC
- **Plugins**: SolaceAudio v1.0.18, LavaSrc v4.3.0, YouTube Plugin v2be8e54, LavaSearch v1.0.0

---

## 🔊 Audio Quality & Latency

Discord voice only accepts Opus, and Lavalink can only forward Opus packets untouched when the source already is Opus. That single fact drives every quality decision:

1. **Opus-native sources by default.** `DEFAULT_SEARCH_PLATFORM=ytmsearch` (YouTube Music) delivers full-length Opus at ~160 kbps, so Lavaplayer forwards packets to Discord without decoding and re-encoding. A metadata-only platform (Spotify/Deezer/Apple/Tidal, i.e. `spsearch`/`dzsearch`/`amsearch`) is refused at runtime even if it is still set in `.env`, because those return 30-second previews or re-encoded mirrors — set `ALLOW_METADATA_SOURCE=true` only if you really want that source.
2. **No more 30-second songs.** `src/utils/audioQuality.js` detects preview/clip resolutions (Spotify/Deezer/Apple/Tidal/JioSaavn without node credentials) and replaces them with a full-length Opus match before they reach the queue. Set `UPGRADE_METADATA_SOURCES=true` to route *every* metadata-only track through this path. All lookups are time-boxed to `UPGRADE_TIMEOUT_MS` so they can never add noticeable start latency.
3. **Faster time-to-first-audio.** `/play` now performs the voice handshake and the track resolution in parallel instead of one after another, removing a full round-trip (~200-1500 ms) from every cold start.
4. **Channel bitrate.** The bot raises the voice channel to the guild's maximum permitted bitrate (96/128/256/384 kbps depending on boost tier) when it has `Manage Channels`.
5. **Autoplay recommendations are ranked, not first-match.** The engine keeps a pre-ranked pool of up to 12 related tracks (YouTube radio first, related searches as fallback), scores each candidate on artist/album affinity, mix position, artist-run avoidance and recent skips, then picks weighted-random from the pool so a session never loops. `/autoplay mode` switches between `radio` (default), `artist` and `discover`; `/similar [amount]` queues the same recommendations on demand, Diva-style. Tracks skipped inside their first 25% drop that artist from recommendations for 30 minutes. Previews, livestreams and clips are never queued.
6. **Stutter is attributed, not guessed.** `src/utils/frameMonitor.js` samples the node's cumulative frame counters every 15s, converts them to deltas, and logs each bad window with the guilds/tracks that were streaming in it, plus the node's CPU load and the silence in milliseconds. Every window is also correlated against node CPU, player count and the number of *transcoding* players (volume ≠ 100%, active filter, non-Opus source or livestream), and the throttle-limited summary states outright whether transcoding, CPU, capacity or route jitter is the likely driver. Every track gets a closing line with what the node dropped while it played. A clean node logs nothing above debug.
7. **Passthrough is all-or-nothing.** Lavalink only forwards Opus untouched while the volume is exactly 100% and no filter is active. Any attenuation re-encodes the stream at the channel bitrate, so a `/filter` preset or a volume below 100% is a deliberate fidelity trade-off — `/audio` reports which path is live.
6. **Diagnose real dropouts with `/ping`.** It now reports Lavalink `frameStats` (`sent / padded / dropped`). A non-zero dropped count means the node is under-resourced or its route to Discord is bad — that is what listeners hear as crackling, and it cannot be fixed from the bot process.

### Node-side checklist (`lavalink/application.yml`)

- Run a build that contains **koe 3.1.0** (Lavalink PR [#1235](https://github.com/lavalink-devs/Lavalink/pull/1235)). 4.2.2 ships koe 3.0.0, whose DAVE send path freezes the outgoing voice stream 100-400 ms about once per second ([issue #1222](https://github.com/lavalink-devs/Lavalink/issues/1222)). koe 3.1.0 serializes encryption under the session write lock and removes the per-packet allocations. The deploy workflow extracts the PR build from `ghcr.io/alula/lavalink` (commit `f733576`).
- `opusEncodingQuality: 10`, `resamplingQuality: HIGH`, `bufferDurationMs: 400`, `frameBufferDurationMs: 5000`, `trackStuckThresholdMs: 10000`, `playerUpdateInterval: 5` (all set in the shipped config). The encoder and resampler settings only affect transcoded audio — they cannot improve a passthrough track, which is already bit-exact.
- YouTube needs the `youtube-source` plugin; datacenter IPs need OAuth for stable full-quality playback. Spotify needs `lavasrc` credentials (otherwise → 30s previews).
- Host the node in the same region as the voice channels, with dedicated CPU: frame drops come from CPU starvation and GC pauses, not from ping.
- Run the JVM on Java 25 with `-XX:+UseZGC -Xms1G -Xmx2G -XX:+AlwaysPreTouch --enable-native-access=ALL-UNNAMED --sun-misc-unsafe-memory-access=allow` on wired datacenter networking. ZGC is generational by default since JDK 23, so `-XX:+ZGenerational` must not be passed (removed in JDK 24). Audio leaves the node as UDP straight to Discord's voice server, so home internet, WiFi or a tunnel in front of the node shows up as jitter that no buffer fully hides.
