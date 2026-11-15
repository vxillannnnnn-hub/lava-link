require("dotenv").config();

module.exports = {
  // Discord Application
  discord: {
    token: process.env.DISCORD_TOKEN || "",
    clientId: process.env.CLIENT_ID || "",
    guildId: process.env.GUILD_ID || "",
  },

  // Ultra-Low-Latency Lavalink v4 Node Credentials
  lavalink: {
    id: process.env.LAVALINK_ID || "Primary-Ultra-Node",
    host: process.env.LAVALINK_HOST || "lavalink.opendrive.indevs.in",
    port: parseInt(process.env.LAVALINK_PORT || "443", 10),
    authorization: process.env.LAVALINK_PASSWORD || "youshallnotpass",
    secure: process.env.LAVALINK_SECURE !== undefined
      ? (process.env.LAVALINK_SECURE === "true" || process.env.LAVALINK_SECURE === "1")
      : (parseInt(process.env.LAVALINK_PORT || "443", 10) === 443),
    retryAmount: Infinity,
    retryDelay: 1000, // 1s fast reconnection
    requestTimeout: parseInt(process.env.LAVALINK_REQUEST_TIMEOUT_MS || "20000", 10), // 20s resilient REST timeout for high-latency tunnels
    heartBeatInterval: 25000, // 25s keepalive keeps Cloudflare Tunnel & NAT mapping primed
    sessionResumeTimeout: 60, // 60s session resuming for seamless <50ms reconnection
  },

  // Player Settings for 0ms Gapless Playback & Opus Direct Passthrough
  player: {
    defaultVolume: 100, // 100 is neutral: guarantees LavaPlayer Opus direct passthrough
    // Ceiling for /volume. Above 100% the bot applies digital gain and warns
    // about clipping explicitly; the node also has to re-encode (no Opus
    // passthrough). 200% = +6 dB, which is where most masters start clipping.
    maxVolume: parseInt(process.env.MAX_VOLUME || "200", 10),
    defaultAutoplay: process.env.DEFAULT_AUTOPLAY === "true" || false, // Starts off by default, turns on with button or command
    applyVolumeAsFilter: false, // NEVER decode to PCM if volume is 100
    autoMaximizeBitrate: process.env.AUTO_MAXIMIZE_BITRATE !== "false", // Automatically maximizes voice channel to 384kbps if permitted
    // Default to Spotify search (spsearch) with high-bitrate JioSaavn CDN audio stream (ultra-reliable, zero bot blocks)
    defaultSearchPlatform: process.env.DEFAULT_SEARCH_PLATFORM || "spsearch", // spsearch, jssearch, ytmsearch, scsearch
    maxPreviousTracks: 25,
    // Hard cap on upcoming tracks per guild (abuse/memory guard).
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || "500", 10),
    inactivityTimeoutMs: parseInt(process.env.INACTIVITY_TIMEOUT_MS || "180000", 10), // 3 minutes
    emptyChannelTimeoutMs: parseInt(process.env.EMPTY_CHANNEL_TIMEOUT_MS || "120000", 10), // 2 minutes
    // 24/7 keeps the bot connected, but streaming to an empty room still costs
    // CPU/bandwidth and looks broken. An empty channel therefore STOPS the
    // stream (queue and position preserved, playback restarts on the next
    // join) instead of only pausing, which autoplay could silently undo.
    // PAUSE_ALONE_IN_247 is the legacy name and still works.
    stopStreamingAloneIn247:
      (process.env.STOP_ALONE_IN_247 ?? process.env.PAUSE_ALONE_IN_247 ?? "true") !== "false",
    autoReconnect: true,
    gaplessPreload: true, // Pre-resolve next track/autoplay recommendation in background
    minAutoPlayMs: parseInt(process.env.MIN_AUTOPLAY_MS || "5000", 10), // anti-spam guard between autoplay hand-offs
    autoplayTimeoutMs: parseInt(process.env.AUTOPLAY_TIMEOUT_MS || "7000", 10), // hard cap per recommendation lookup
    // Recommendation pool: ranked ahead of time so autoplay has no gap and the
    // pick comes from a scored pool instead of the first search result.
    autoplayPoolSize: parseInt(process.env.AUTOPLAY_POOL_SIZE || "12", 10),
    autoplayPoolTtlMs: parseInt(process.env.AUTOPLAY_POOL_TTL_MS || "900000", 10), // 15 minutes
    // A track skipped inside this share of its duration counts as negative
    // feedback and drops its artist from recommendations for 30 minutes.
    autoplaySkipPercent: parseInt(process.env.AUTOPLAY_SKIP_PERCENT || "25", 10),
    autoplayArtistCooldown: parseInt(process.env.AUTOPLAY_ARTIST_COOLDOWN || "2", 10),
    autocompleteCacheTtlMs: 300000, // 5-minute memory cache for instant <1ms autocomplete
    useComponentsV2: process.env.USE_COMPONENTS_V2 !== "false", // Native Discord Components V2 Container (Flags: 32768)

    // Audio Fidelity Guard (see utils/audioQuality.js)
    quality: {
      // Play Opus-native sources as-is; only metadata-only providers are re-resolved.
      preferOpusNativeSources: process.env.PREFER_OPUS_NATIVE !== "false",
      // Re-resolve every Spotify/Deezer/Apple/Tidal/JioSaavn track to a full-length
      // Opus source (best quality, costs one extra search per track).
      upgradeMetadataOnlySources: process.env.UPGRADE_METADATA_SOURCES === "true",
      metadataOnlySources: ["spotify", "deezer", "applemusic", "tidal", "jiosaavn", "yandexmusic", "flowery-tts"],
      // Playback refuses a metadata-only DEFAULT_SEARCH_PLATFORM (it serves 30s
      // previews or forces a mirror search) and uses YouTube Music's Opus
      // stream instead. Set this to true only if you really want that platform.
      allowMetadataOnlySource: process.env.ALLOW_METADATA_SOURCE === "true",
      previewMaxDurationMs: parseInt(process.env.PREVIEW_MAX_DURATION_MS || "31000", 10), // anything <= 31s is a preview
      upgradeTimeoutMs: parseInt(process.env.UPGRADE_TIMEOUT_MS || "4000", 10), // never add more than 4s of start latency
    },
  },

  // Last.fm similarity layer (see utils/autoplayManager.js)
  // The YouTube radio knows "what YouTube plays next"; Last.fm knows "what
  // actually sounds alike", including artists the radio never surfaces. The
  // layer is off unless an API key is present, and autoplay falls back to the
  // platform radio alone.
  lastfm: {
    enabled: Boolean(process.env.LASTFM_API_KEY),
    apiKey: process.env.LASTFM_API_KEY || "",
    // Overridable so the lookup can be stubbed in tests.
    baseUrl: process.env.LASTFM_BASE_URL || "https://ws.audioscrobbler.com/2.0/",
    limit: parseInt(process.env.LASTFM_LIMIT || "20", 10),
    // How many similar entries are resolved into playable tracks per seed.
    // Each one is a Lavalink search, they run in parallel and only for a seed
    // that is not cached yet.
    maxResolve: parseInt(process.env.LASTFM_MAX_RESOLVE || "6", 10),
    timeoutMs: parseInt(process.env.LASTFM_TIMEOUT_MS || "4000", 10),
    cacheTtlMs: parseInt(process.env.LASTFM_CACHE_TTL_MS || "600000", 10),
  },

  // Adaptive voice-channel bitrate governor (see utils/voiceBitrateManager.js)
  voiceBitrate: {
    // Same env switch as before, so the existing workflow keeps working.
    enabled: process.env.AUTO_MAXIMIZE_BITRATE !== "false",
    // Hard cap. 384000 is Discord's own ceiling (boost tier 3).
    max: parseInt(process.env.VOICE_BITRATE_MAX || "384000", 10),
    // Never adapt below this: below it music audibly loses detail for no gain.
    // 128kbps is the minimum for high-quality Discord music; ensures Opus passthrough
    // when volume is 100 and no filter is active, avoiding re-encoding generation loss.
    min: parseInt(process.env.VOICE_BITRATE_MIN || "128000", 10),
    // One adaptive step. Smaller steps are gentler but correct too slowly.
    stepDown: parseInt(process.env.VOICE_BITRATE_STEP || "64000", 10),
    // How often the governor checks every active player.
    tickMs: parseInt(process.env.VOICE_BITRATE_TICK_MS || "15000", 10),
    // Attempt throttles: a rejected edit must never become one REST call per track.
    retryCooldownMs: parseInt(process.env.VOICE_BITRATE_RETRY_MS || "300000", 10),
    adaptCooldownMs: parseInt(process.env.VOICE_BITRATE_ADAPT_MS || "300000", 10),
    // Clean windows needed before climbing back one step.
    healthyWindowsForUp: parseInt(process.env.VOICE_BITRATE_UP_WINDOWS || "4", 10),
    // Ceiling on how often we may lower a channel, so it cannot oscillate.
    maxDownshiftsPerHour: parseInt(process.env.VOICE_BITRATE_MAX_DOWNSHIFTS || "2", 10),
    // Silence in a window that counts as *audible* damage. Reporting only:
    // /audio and the governor's log line use it, it never triggers a downshift.
    audibleSilenceMs: parseInt(process.env.VOICE_BITRATE_AUDIBLE_MS || "100", 10),
    // A downshift needs this many degraded windows in a row, so a single 100ms
    // hiccup (one window) never costs the channel a bitrate step.
    badWindowsForDown: parseInt(process.env.VOICE_BITRATE_DOWN_WINDOWS || "3", 10),
    // ...and each window must lose at least this many frames (15 = 300ms)...
    downshiftMinDroppedFrames: parseInt(process.env.VOICE_BITRATE_DOWN_MIN_FRAMES || "15", 10),
    // ...at this drop rate, which a 100ms blip inside a 15s window cannot reach.
    downshiftMinDropRate: parseFloat(process.env.VOICE_BITRATE_DOWN_MIN_RATE || "1"),
    // Windows shorter than this (frames) are skipped instead of extrapolated.
    minWindowFrames: parseInt(process.env.VOICE_BITRATE_MIN_WINDOW_FRAMES || "100", 10),
  },

  // Node frame-health telemetry (see utils/frameMonitor.js)
  audio: {
    // How often node frame counters are sampled. Each sample logs only when
    // frames were actually dropped, so a healthy node stays quiet.
    frameLogIntervalMs: parseInt(process.env.FRAME_LOG_INTERVAL_MS || "15000", 10),
    // A window is reported as unhealthy at this many dropped frames (20ms each).
    frameWarnDeficitFrames: parseInt(process.env.FRAME_WARN_DEFICIT || "2", 10),
    // ...or at this drop rate, whichever is hit first.
    frameWarnRatePercent: parseFloat(process.env.FRAME_WARN_RATE_PERCENT || "1"),
    // Log clean windows too (debug level) - noisy, off by default.
    frameLogCleanSamples: process.env.FRAME_LOG_CLEAN === "true",
    // Correlation: compare sampled dropouts against node CPU, player count and
    // the number of players that are transcoding, to identify the driver.
    correlationWindowSamples: parseInt(process.env.FRAME_CORRELATION_WINDOW || "60", 10),
    correlationMinSamples: parseInt(process.env.FRAME_CORRELATION_MIN_SAMPLES || "5", 10),
    correlationLogIntervalMs: parseInt(process.env.FRAME_CORRELATION_LOG_INTERVAL_MS || "60000", 10),
  },

  // Real-Time Voice Channel Status (VC Status) Engine (No Emojis)
  voiceStatus: {
    enabled: process.env.ENABLE_VC_STATUS !== "false",
    rotateIntervalMs: parseInt(process.env.VC_STATUS_ROTATE_INTERVAL_MS || "35000", 10), // 35-second rotation
    templates: [
      "{title} by - {author}",          // Exact user-requested format
      "{title} by {author}",            // Clean classic format
      "Playing : {title} by {author}",   // Streaming standard
      "- {title} by {author}", // Timestamped layout
      "{title} - {author}",             // Minimalist format
      "Listening to {title} - {author}",// Rich presence format
      "{title} || {author}",             // Modern pipe separator
    ],
    idleTemplates: [
      "Use /play to listen to music",
      "Use {prefix}p or /play to start music",
      "Chilling in voice • Use /play <song>",
      "Waiting for tunes • Wake me up with /play",
      "Ready for music • Send a song with /play",
      "Vibe with me • Use /play or {prefix}play",
      "Drop a song with /play or {prefix}p",
      "Silent right now • Type /play to stream",
      "Join & use /play to listen together",
      "24/7 Studio Sound • Type /play or {prefix}p",
    ],
  },

  // Text command prefix used when a guild has not chosen one
  prefix: {
    default: process.env.DEFAULT_PREFIX || process.env.PREFIX || ".",
  },

  // Strict Monochrome Palette (100% Dark Grayscale)
  colors: {
    surface: 0x2b2d31,     // Discord Native Dark Surface (Containers & Embeds)
    primary: 0x2b2d31,     // Monochrome Dark
    success: 0x2b2d31,     // Monochrome Dark
    warning: 0x2b2d31,     // Monochrome Dark
    error: 0x2b2d31,       // Monochrome Dark
    neutral: 0x1e1f22,     // Deep Canvas
    spotify: 0x2b2d31,     // Monochrome
    youtube: 0x2b2d31,     // Monochrome
    soundcloud: 0x2b2d31,  // Monochrome
    jiosaavn: 0x2b2d31,    // Monochrome
  },

  // Centralized Shared Emojis (No Duplication)
  emojis: require("./utils/emojis"),
};
