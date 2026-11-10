/**
 * ==============================================================================
 * SINGLE SOURCE OF TRUTH FOR ALL EMOJIS (Pulse Music Bot)
 * ==============================================================================
 * 
 * To customize ANY emoji across the entire bot, simply edit the values below in EMOJI_CONFIG!
 * Every command, button, status notice, volume preset, embed, and progress bar dynamically
 * reads from this single file. No other files have to be touched.
 * 
 * Supports Multi-Bot Fleet Contextual Resolution:
 * Automatically resolves the owning bot's own Discord Application Emojis dynamically
 * via AsyncLocalStorage so all bots (Primary, Clone 1, Clone 2, Clone 3) render crisp,
 * monochrome emojis in external servers for all users without Nitro.
 */

const { AsyncLocalStorage } = require("async_hooks");
const clientContext = new AsyncLocalStorage();

const UNICODE_FALLBACKS = {
  play: "▶",
  pause: "⏸",
  playpause: "⏯",
  previous: "⏮",
  skip: "⏭",
  stop: "⏹",
  loop: "↻",
  loopOne: "↺",
  shuffle: "⤨",
  autoplay: "∞",
  heart: "♡",
  queue: "☰",
  volume: "🔊",
  volumeNormal: "🔊",
  volumelow: "🔉",
  volumeLow: "🔉",
  volumemute: "🔇",
  volumeMute: "🔇",
  volumeBoost: "🔊",
  sparkles: "✦",
  music: "♫",
  disc: "◎",
  radio: "◉",
  dj: "◈",
  fire: "▲",
  check: "✓",
  success: "✓",
  cross: "✕",
  error: "✕",
  warn: "✕",
  spotify: "♫",
  youtube: "▶",
  soundcloud: "☁",
  openPlayer: "🎛",
  controls: "🎛",
  pointer: "›",
  channel: "▤",
  stage: "◫",
  users: "◈",
};

const EMOJI_CONFIG = {
  // ---------------------------------------------------------------------------
  // 1. PLAYER TRANSPORT CONTROLS (Default to Primary Bot Application Emojis)
  // ---------------------------------------------------------------------------
  play: "<:play:1568636872971001916>",
  pause: "<:pause:1568636879945859094>",
  playpause: "<:playpause:1568636887374106634>",
  previous: "<:previous:1568636898631614595>",
  skip: "<:skip:1568636894567203016>",
  stop: "<:stop:1568636906634346611>",
  loop: "<:loop:1568636915270426737>",
  loopOne: "<:loop_one:1568636919498416188>",
  shuffle: "<:shuffle:1568636923684323419>",
  autoplay: "<:autoplay:1568636927987421194>",
  save: "<:heart:1568636935508066304>",
  heart: "<:heart:1568636935508066304>",
  openPlayer: "<:controls:1568865458659131472>",
  controls: "<:controls:1568865458659131472>",
  queue: "<:queue:1568636942785056779>",

  // ---------------------------------------------------------------------------
  // 2. VOLUME CONTROLS & AUDIO LEVELS
  // ---------------------------------------------------------------------------
  volume: "<:volume:1568636950146056282>",
  volumeNormal: "<:volume:1568636950146056282>",
  volumeLow: "<:volumelow:1568636954646421666>",
  volumeMute: "<:volumemute:1568636958744379606>",
  volumeBoost: "<:volume:1568636950146056282>",

  // ---------------------------------------------------------------------------
  // 3. SYSTEM STATUS, ALERTS & BADGES (100% Monochrome White Vector Emojis)
  // ---------------------------------------------------------------------------
  success: "<:check:1568637021130465461>",
  check: "<:check:1568637021130465461>",
  error: "<:cross:1568637028852170958>",
  cross: "<:cross:1568637028852170958>",
  warn: "<:cross:1568637028852170958>",
  alert: "<:cross:1568637028852170958>",
  info: "<:music:1568636978508075189>",
  sparkles: "<:sparkles:1568636966386278594>",
  fire: "<:fire:1568637013916262430>",
  pin: "<:sparkles:1568636966386278594>",
  live: "<:radio:1568636998330089592>",
  online: "<:check:1568637021130465461>",
  offline: "<:cross:1568637028852170958>",

  // ---------------------------------------------------------------------------
  // 4. MUSIC FEATURES & UTILITY CONTROLS (100% Monochrome White Vector Emojis)
  // ---------------------------------------------------------------------------
  music: "<:music:1568636978508075189>",
  disc: "<:disc:1568636991225077770>",
  radio: "<:radio:1568636998330089592>",
  dj: "<:dj:1568637006114983986>",
  playlist: "<:queue:1568636942785056779>",
  lyrics: "<:music:1568636978508075189>",
  scroll: "<:queue:1568636942785056779>",
  search: "<:music:1568636978508075189>",
  equalizer: "<:volume:1568636950146056282>",
  time: "<:disc:1568636991225077770>",
  user: "<:dj:1568637006114983986>",
  link: "<:music:1568636978508075189>",
  stats: "<:volume:1568636950146056282>",
  ping: "<:radio:1568636998330089592>",
  clear: "<:stop:1568636906634346611>",
  reset: "<:loop:1568636915270426737>",
  settings: "<:dj:1568637006114983986>",
  gear: "<:dj:1568637006114983986>",
  help: "<:sparkles:1568636966386278594>",
  pointer: "›",
  book: "<:queue:1568636942785056779>",
  leave: "<:stop:1568636906634346611>",
  wave: "<:stop:1568636906634346611>",
  vote: "<:check:1568637021130465461>",
  mic: "<:music:1568636978508075189>",
  guitar: "<:music:1568636978508075189>",
  audio: "<:volume:1568636950146056282>",

  // ---------------------------------------------------------------------------
  // 5. STREAMING PLATFORMS (Monochrome White Branding)
  // ---------------------------------------------------------------------------
  spotify: "<:spotify:1568637036620030132>",
  youtube: "<:youtube:1568637043930828914>",
  soundcloud: "<:soundcloud:1568637051497091082>",
  jiosaavn: "<:music:1568636978508075189>",
  bandcamp: "<:disc:1568636991225077770>",
  twitch: "<:radio:1568636998330089592>",
  web: "<:disc:1568636991225077770>",

  // ---------------------------------------------------------------------------
  // 6. DSP AUDIO FILTERS
  // ---------------------------------------------------------------------------
  filter8D: "<:dj:1568637006114983986>",
  filterBass: "<:volume:1568636950146056282>",
  filterNightcore: "<:sparkles:1568636966386278594>",
  filterVaporwave: "<:disc:1568636991225077770>",
  filterKaraoke: "<:music:1568636978508075189>",
  filterPop: "<:music:1568636978508075189>",
  filterRock: "<:music:1568636978508075189>",
  filterNormalizer: "<:disc:1568636991225077770>",
  filterReset: "<:loop:1568636915270426737>",

  // ---------------------------------------------------------------------------
  // 7. SEAMLESS PROGRESS BAR BLOCKS
  // ---------------------------------------------------------------------------
  bar_lf: "<:bar_lf:1568637059088916520>",
  bar_mf: "<:bar_mf:1568637066105851994>",
  bar_rf: "<:bar_rf:1568637073177579743>",
  bar_le: "<:bar_le:1568637080601497623>",
  bar_me: "<:bar_me:1568637088096583750>",
  bar_re: "<:bar_re:1568637095558258709>",
  bar_single_f: "<:bar_single_f:1568637103095554099>",
};

// GitHub Assets CDN Base for Direct Image Fallbacks
const GITHUB_ASSETS_BASE = "https://raw.githubusercontent.com/apunabhibhilegendhai/lavalink-server/main/assets/emojis";
let isFallbackMode = false;

// Multi-bot fleet emojis lookup table
let fleetEmojis = {};
try {
  const fleetData = require("./applicationEmojis.json");
  if (fleetData && fleetData.fleet) {
    fleetEmojis = fleetData.fleet;
  }
} catch (_) {}

// Canonical alias dictionary to map all command/embed/button property names
// to the actual Discord Application Emoji keys owned by each respective bot
const CANONICAL_ALIASES = {
  // Player Transport & Controls
  play: "play",
  pause: "pause",
  playpause: "playpause",
  previous: "previous",
  skip: "skip",
  stop: "stop",
  clear: "stop",
  leave: "stop",
  wave: "stop",
  loop: "loop",
  reset: "loop",
  loopOne: "loop_one",
  loop_one: "loop_one",
  shuffle: "shuffle",
  autoplay: "autoplay",
  save: "heart",
  heart: "heart",
  queue: "queue",
  playlist: "queue",
  scroll: "queue",
  book: "queue",
  openPlayer: "controls",
  controls: "controls",

  // Volume & Audio Levels
  volume: "volume",
  volumeNormal: "volume",
  volumeBoost: "volume",
  audio: "volume",
  stats: "volume",
  equalizer: "volume",
  volumeLow: "volumelow",
  volumelow: "volumelow",
  volumeMute: "volumemute",
  volumemute: "volumemute",

  // System Status, Alerts & Badges
  success: "check",
  check: "check",
  online: "check",
  vote: "check",
  error: "cross",
  cross: "cross",
  warn: "cross",
  alert: "cross",
  offline: "cross",
  sparkles: "sparkles",
  help: "sparkles",
  pin: "sparkles",
  fire: "fire",
  live: "radio",
  ping: "radio",
  radio: "radio",
  disc: "disc",
  time: "disc",
  bandcamp: "disc",
  web: "disc",
  stream: "disc",
  dj: "dj",
  user: "dj",
  gear: "dj",
  settings: "dj",
  music: "music",
  info: "music",
  lyrics: "music",
  search: "music",
  link: "music",
  mic: "music",
  guitar: "music",

  // Streaming Platforms
  spotify: "spotify",
  youtube: "youtube",
  soundcloud: "soundcloud",
  jiosaavn: "music",
  twitch: "radio",

  // DSP Audio Filters
  filter8D: "dj",
  filterBass: "volume",
  filterNightcore: "sparkles",
  filterVaporwave: "disc",
  filterKaraoke: "music",
  filterPop: "music",
  filterRock: "music",
  filterNormalizer: "disc",
  filterReset: "loop",

  // Seamless Progress Bar Blocks
  bar_lf: "bar_lf",
  bar_mf: "bar_mf",
  bar_rf: "bar_rf",
  bar_le: "bar_le",
  bar_me: "bar_me",
  bar_re: "bar_re",
  bar_single_f: "bar_single_f",

  // Pointer
  pointer: "pointer",

  // Admin / settings panel glyphs
  channel: "queue",
  stage: "queue",
  users: "dj",
};

const PRIMARY_BOT_ID = "1568193148222443591";

/**
 * Robust contextual emoji resolver for multi-bot fleet.
 * Guaranteed to NEVER send another bot's application emoji tag across external servers.
 */
function resolveEmoji(prop, client = null) {
  if (typeof prop !== "string") return "";

  // 1. Literal Unicode Glyphs that do not require Discord Custom Emojis
  if (prop === "pointer") return "›";

  // 2. Global fallback mode check
  if (isFallbackMode && UNICODE_FALLBACKS[prop]) {
    return UNICODE_FALLBACKS[prop];
  }

  // 3. Resolve active client & bot user ID
  const targetClient = client || clientContext.getStore() || null;
  const botId = targetClient?.user?.id || (typeof targetClient === "string" ? targetClient : null);

  const canonicalKey = CANONICAL_ALIASES[prop] || prop;
  const lowerProp = prop.toLowerCase();
  const lowerCanonical = canonicalKey.toLowerCase();

  // 4. Check client's in-memory emojisMap (live-fetched from Discord REST API on ready)
  if (targetClient?.emojisMap) {
    const map = targetClient.emojisMap;
    if (map[prop]) return map[prop];
    if (map[canonicalKey]) return map[canonicalKey];
    if (map[lowerProp]) return map[lowerProp];
    if (map[lowerCanonical]) return map[lowerCanonical];
  }

  // 5. Check pre-loaded fleet mapping from applicationEmojis.json
  if (botId && fleetEmojis[botId]) {
    const botMap = fleetEmojis[botId];
    if (botMap[prop]) return botMap[prop];
    if (botMap[canonicalKey]) return botMap[canonicalKey];
    if (botMap[lowerProp]) return botMap[lowerProp];
    if (botMap[lowerCanonical]) return botMap[lowerCanonical];
  }

  // 6. Primary bot fallback (Bot 1 owns the hardcoded EMOJI_CONFIG)
  if (!botId || botId === PRIMARY_BOT_ID) {
    if (EMOJI_CONFIG[prop]) return EMOJI_CONFIG[prop];
    if (EMOJI_CONFIG[canonicalKey]) return EMOJI_CONFIG[canonicalKey];
  }

  // 7. Auxiliary / Clone Bots (Pulse 1, 2, 3, etc.):
  // NEVER leak Bot 1's alien application emoji tags into messages sent by other bots!
  // Discord will reject them and show broken text. Fall back to clean Unicode glyphs.
  return UNICODE_FALLBACKS[canonicalKey] || UNICODE_FALLBACKS[prop] || "";
}

// Unified shared dictionary supporting both top-level and categorized access
const emojis = {
  ...EMOJI_CONFIG,

  // Categorized namespaces dynamically evaluated through Proxy
  get player() {
    return {
      previous: proxyEmojis.previous,
      play: proxyEmojis.play,
      pause: proxyEmojis.pause,
      playpause: proxyEmojis.playpause,
      skip: proxyEmojis.skip,
      stop: proxyEmojis.stop,
      loop: proxyEmojis.loop,
      loopOne: proxyEmojis.loopOne,
      shuffle: proxyEmojis.shuffle,
      autoplay: proxyEmojis.autoplay,
      save: proxyEmojis.save,
      heart: proxyEmojis.heart,
      openPlayer: proxyEmojis.openPlayer,
      queue: proxyEmojis.queue,
    };
  },

  get volume() {
    return {
      mute: proxyEmojis.volumeMute,
      low: proxyEmojis.volumeLow,
      normal: proxyEmojis.volumeNormal,
      boost: proxyEmojis.volumeBoost,
      toString() {
        return resolveEmoji("volume");
      },
      [Symbol.toPrimitive]() {
        return resolveEmoji("volume");
      },
    };
  },

  get filters() {
    return {
      spatial8D: proxyEmojis.filter8D,
      bass: proxyEmojis.filterBass,
      nightcore: proxyEmojis.filterNightcore,
      vaporwave: proxyEmojis.filterVaporwave,
      karaoke: proxyEmojis.filterKaraoke,
      pop: proxyEmojis.filterPop,
      rock: proxyEmojis.filterRock,
      normalizer: proxyEmojis.filterNormalizer,
      reset: proxyEmojis.filterReset,
    };
  },

  get platforms() {
    return {
      spotify: proxyEmojis.spotify,
      youtube: proxyEmojis.youtube,
      soundcloud: proxyEmojis.soundcloud,
      jiosaavn: proxyEmojis.jiosaavn,
      bandcamp: proxyEmojis.bandcamp,
      twitch: proxyEmojis.twitch,
      web: proxyEmojis.web,
      music: proxyEmojis.music,
    };
  },

  get status() {
    return {
      success: proxyEmojis.success,
      error: proxyEmojis.error,
      warn: proxyEmojis.warn,
      info: proxyEmojis.info,
      sparkles: proxyEmojis.sparkles,
      fire: proxyEmojis.fire,
      pin: proxyEmojis.pin,
      live: proxyEmojis.live,
    };
  },

  get progress() {
    return {
      filled: "▰",
      empty: "▱",
      dot: "●",
      lineFilled: "━",
      lineEmpty: "─",
    };
  },

  /**
   * Helper to format readable platform badge with emoji
   */
  getPlatformBadge(sourceName) {
    const src = (sourceName || "").toLowerCase();
    switch (src) {
      case "spotify":
        return `${proxyEmojis.spotify} Spotify`;
      case "youtube":
        return `${proxyEmojis.youtube} YouTube`;
      case "soundcloud":
        return `${proxyEmojis.soundcloud} SoundCloud`;
      case "jiosaavn":
        return `${proxyEmojis.jiosaavn} JioSaavn`;
      case "bandcamp":
        return `${proxyEmojis.bandcamp} Bandcamp`;
      case "twitch":
        return `${proxyEmojis.twitch} Twitch`;
      case "http":
      case "https":
        return `${proxyEmojis.web} Web Stream`;
      default:
        return `${proxyEmojis.music} Audio`;
    }
  },

  /**
   * Helper to get appropriate volume emoji for level percentage
   */
  getVolumeEmoji(level) {
    if (level === 0) return proxyEmojis.volumeMute;
    if (level < 50) return proxyEmojis.volumeLow;
    if (level <= 100) return proxyEmojis.volumeNormal;
    return proxyEmojis.volumeBoost;
  },

  /**
   * Helper to build progress bar with custom Discord server emojis or clean Unicode fallback
   */
  createProgressBar(current, total, size = 12) {
    const safeTotal = Number(total);
    if (!Number.isFinite(safeTotal) || safeTotal <= 0) {
      return `${proxyEmojis.live} \`[LIVE STREAM]\``;
    }
    // A missing position (fresh player, malformed track) must render as an
    // empty bar; NaN used to produce a broken/garbled bar of repeats.
    const safeCurrent = Number.isFinite(Number(current)) ? Number(current) : 0;
    size = Math.max(1, Math.min(20, Math.round(Number(size)) || 12));
    const clampedCurrent = Math.min(Math.max(safeCurrent, 0), safeTotal);
    const progress = Math.min(Math.max(clampedCurrent / safeTotal, 0), 1);
    const filledBlocks = Math.round(progress * size);

    const bar_lf = proxyEmojis.bar_lf;
    const bar_mf = proxyEmojis.bar_mf;
    const bar_rf = proxyEmojis.bar_rf;
    const bar_le = proxyEmojis.bar_le;
    const bar_me = proxyEmojis.bar_me;
    const bar_re = proxyEmojis.bar_re;
    const bar_single_f = proxyEmojis.bar_single_f;

    // Seamless custom monochrome server emojis
    if (bar_lf && bar_le) {
      let bar = "";
      for (let i = 0; i < size; i++) {
        const isFirst = i === 0;
        const isLast = i === size - 1;
        const isFilled = i < filledBlocks;

        if (isFirst) {
          if (filledBlocks === 1 && bar_single_f) {
            bar += bar_single_f;
          } else {
            bar += isFilled ? bar_lf : bar_le;
          }
        } else if (isLast) {
          bar += isFilled ? bar_rf : bar_re;
        } else {
          bar += isFilled ? bar_mf : bar_me;
        }
      }
      return bar;
    }

    // High quality Unicode fallback
    const emptyProgress = Math.max(0, size - filledBlocks);
    const filled = "▰".repeat(Math.max(0, filledBlocks));
    const empty = "▱".repeat(emptyProgress);

    return `${filled}${empty}`;
  },

  /**
   * Resolve appropriate emoji for a specific bot client in the multi-bot fleet
   */
  getEmoji(key, client = null) {
    return resolveEmoji(key, client);
  },

  /**
   * Safe Component Button Emoji Resolver:
   * Returns parsed custom emoji object { id, name } or Unicode string fallback.
   * If in fallback mode, returns unicode fallback directly.
   */
  getButtonEmoji(key, client = null) {
    if (isFallbackMode) {
      return UNICODE_FALLBACKS[key] || "•";
    }
    const raw = resolveEmoji(key, client);
    if (!raw) return UNICODE_FALLBACKS[key] || "•";
    const match = raw.match(/<a?:([a-zA-Z0-9_]+):(\d+)>/);
    if (match) {
      return { name: match[1], id: match[2] };
    }
    return raw;
  },

  /**
   * Register live application emojis fetched from Discord API for a specific bot instance
   */
  registerBotEmojis(botId, emojiMap) {
    if (!botId || !emojiMap) return;
    fleetEmojis[botId] = {
      ...(fleetEmojis[botId] || {}),
      ...emojiMap,
    };
  },

  /**
   * Direct GitHub Repository CDN raw URL for every emoji asset in assets/emojis/
   */
  getCdnUrl(key) {
    const cleanKey = (key || "").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
    return `${GITHUB_ASSETS_BASE}/${cleanKey}.png`;
  },

  /**
   * Switch all bot emojis bot-wide to clean Unicode fallbacks if Discord has an emoji outage
   */
  setFallbackMode(enabled) {
    isFallbackMode = Boolean(enabled);
  },

  isFallbackMode() {
    return isFallbackMode;
  },

  /**
   * Scope an asynchronous function call to a specific bot client instance
   */
  runWithClient(client, fn) {
    if (!client) return fn();
    return clientContext.run(client, fn);
  },

  getActiveClient() {
    return clientContext.getStore() || null;
  },

  cdnBase: GITHUB_ASSETS_BASE,
  unicode: UNICODE_FALLBACKS,
};

// Wrap in dynamic Proxy so when isFallbackMode is toggled, emojis.play automatically returns unicode "▶"
// and when an active client is running, emojis.play automatically returns THAT bot's application emoji!
const proxyEmojis = new Proxy(emojis, {
  get(target, prop, receiver) {
    if (typeof prop !== "string") {
      return Reflect.get(target, prop, receiver);
    }
    // Return functions and specific namespace objects directly from target
    if (prop in target && typeof target[prop] === "function") {
      return target[prop];
    }
    if (
      prop === "player" ||
      prop === "volume" ||
      prop === "filters" ||
      prop === "platforms" ||
      prop === "status" ||
      prop === "progress" ||
      prop === "unicode" ||
      prop === "cdnBase"
    ) {
      return Reflect.get(target, prop, receiver);
    }
    return resolveEmoji(prop);
  },
});

module.exports = proxyEmojis;
