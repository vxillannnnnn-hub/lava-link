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
  openPlayer: "⏏",
  pointer: "›",
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
  openPlayer: "⏏",
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
    if (!total || total === 0 || isNaN(total) || total === Infinity) {
      return `${proxyEmojis.live} \`[LIVE STREAM]\``;
    }
    const clampedCurrent = Math.min(Math.max(current, 0), total);
    const progress = Math.min(Math.max(clampedCurrent / total, 0), 1);
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
    if (isFallbackMode) {
      return UNICODE_FALLBACKS[key] || "•";
    }
    const targetClient = client || clientContext.getStore();
    const botId = targetClient?.user?.id || (typeof targetClient === "string" ? targetClient : null);
    if (botId && fleetEmojis[botId]?.[key]) {
      return fleetEmojis[botId][key];
    }
    if (targetClient?.emojisMap?.[key]) {
      return targetClient.emojisMap[key];
    }
    return EMOJI_CONFIG[key] || UNICODE_FALLBACKS[key] || "";
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
    const raw = this.getEmoji(key, client);
    if (!raw) return UNICODE_FALLBACKS[key] || "•";
    const match = raw.match(/<a?:([a-zA-Z0-9_]+):(\d+)>/);
    if (match) {
      return { name: match[1], id: match[2] };
    }
    return raw;
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
    if (isFallbackMode && UNICODE_FALLBACKS[prop]) {
      return UNICODE_FALLBACKS[prop];
    }
    const currentClient = clientContext.getStore();
    const botId = currentClient?.user?.id || (typeof currentClient === "string" ? currentClient : null);
    if (botId && fleetEmojis[botId]?.[prop]) {
      return fleetEmojis[botId][prop];
    }
    if (currentClient?.emojisMap?.[prop]) {
      return currentClient.emojisMap[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
});

module.exports = proxyEmojis;
