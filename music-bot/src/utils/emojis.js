/**
 * ==============================================================================
 * SINGLE SOURCE OF TRUTH FOR ALL EMOJIS (Pulse Music Bot)
 * ==============================================================================
 * 
 * To customize ANY emoji across the entire bot, simply edit the values below in EMOJI_CONFIG!
 * Every command, button, status notice, volume preset, embed, and progress bar dynamically
 * reads from this single file. No other files have to be touched.
 * 
 * All default emojis below are 100% static, monochrome white vector emojis synced
 * directly into your Discord server for a crisp, professional Eara-style look.
 */

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
  // 1. PLAYER TRANSPORT CONTROLS (Monochrome White Static Guild Emojis)
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

// Unified shared dictionary supporting both top-level and categorized access
const emojis = {
  ...EMOJI_CONFIG,

  // Categorized namespaces
  player: {
    previous: EMOJI_CONFIG.previous,
    play: EMOJI_CONFIG.play,
    pause: EMOJI_CONFIG.pause,
    playpause: EMOJI_CONFIG.playpause,
    skip: EMOJI_CONFIG.skip,
    stop: EMOJI_CONFIG.stop,
    loop: EMOJI_CONFIG.loop,
    loopOne: EMOJI_CONFIG.loopOne,
    shuffle: EMOJI_CONFIG.shuffle,
    autoplay: EMOJI_CONFIG.autoplay,
    save: EMOJI_CONFIG.save,
    heart: EMOJI_CONFIG.heart,
    openPlayer: EMOJI_CONFIG.openPlayer,
    queue: EMOJI_CONFIG.queue,
  },

  volume: {
    mute: EMOJI_CONFIG.volumeMute,
    low: EMOJI_CONFIG.volumeLow,
    normal: EMOJI_CONFIG.volumeNormal,
    boost: EMOJI_CONFIG.volumeBoost,
  },

  filters: {
    spatial8D: EMOJI_CONFIG.filter8D,
    bass: EMOJI_CONFIG.filterBass,
    nightcore: EMOJI_CONFIG.filterNightcore,
    vaporwave: EMOJI_CONFIG.filterVaporwave,
    karaoke: EMOJI_CONFIG.filterKaraoke,
    pop: EMOJI_CONFIG.filterPop,
    rock: EMOJI_CONFIG.filterRock,
    normalizer: EMOJI_CONFIG.filterNormalizer,
    reset: EMOJI_CONFIG.filterReset,
  },

  platforms: {
    spotify: EMOJI_CONFIG.spotify,
    youtube: EMOJI_CONFIG.youtube,
    soundcloud: EMOJI_CONFIG.soundcloud,
    jiosaavn: EMOJI_CONFIG.jiosaavn,
    bandcamp: EMOJI_CONFIG.bandcamp,
    twitch: EMOJI_CONFIG.twitch,
    web: EMOJI_CONFIG.web,
    music: EMOJI_CONFIG.music,
  },

  status: {
    success: EMOJI_CONFIG.success,
    error: EMOJI_CONFIG.error,
    warn: EMOJI_CONFIG.warn,
    info: EMOJI_CONFIG.info,
    sparkles: EMOJI_CONFIG.sparkles,
    fire: EMOJI_CONFIG.fire,
    pin: EMOJI_CONFIG.pin,
    live: EMOJI_CONFIG.live,
  },

  progress: {
    filled: "▰",
    empty: "▱",
    dot: "●",
    lineFilled: "━",
    lineEmpty: "─",
  },

  /**
   * Helper to format readable platform badge with emoji
   */
  getPlatformBadge(sourceName) {
    const src = (sourceName || "").toLowerCase();
    switch (src) {
      case "spotify":
        return `${EMOJI_CONFIG.spotify} Spotify`;
      case "youtube":
        return `${EMOJI_CONFIG.youtube} YouTube`;
      case "soundcloud":
        return `${EMOJI_CONFIG.soundcloud} SoundCloud`;
      case "jiosaavn":
        return `${EMOJI_CONFIG.jiosaavn} JioSaavn`;
      case "bandcamp":
        return `${EMOJI_CONFIG.bandcamp} Bandcamp`;
      case "twitch":
        return `${EMOJI_CONFIG.twitch} Twitch`;
      case "http":
      case "https":
        return `${EMOJI_CONFIG.web} Web Stream`;
      default:
        return `${EMOJI_CONFIG.music} Audio`;
    }
  },

  /**
   * Helper to get appropriate volume emoji for level percentage
   */
  getVolumeEmoji(level) {
    if (level === 0) return EMOJI_CONFIG.volumeMute;
    if (level < 50) return EMOJI_CONFIG.volumeLow;
    if (level <= 100) return EMOJI_CONFIG.volumeNormal;
    return EMOJI_CONFIG.volumeBoost;
  },

  /**
   * Helper to build progress bar with custom Discord server emojis or clean Unicode fallback
   */
  createProgressBar(current, total, size = 12) {
    if (!total || total === 0 || isNaN(total) || total === Infinity) {
      return `${EMOJI_CONFIG.live} \`[LIVE STREAM]\``;
    }
    const clampedCurrent = Math.min(Math.max(current, 0), total);
    const progress = Math.min(Math.max(clampedCurrent / total, 0), 1);
    const filledBlocks = Math.round(progress * size);

    // Seamless custom monochrome server emojis (Eara exact match)
    if (EMOJI_CONFIG.bar_lf && EMOJI_CONFIG.bar_le) {
      let bar = "";
      for (let i = 0; i < size; i++) {
        const isFirst = i === 0;
        const isLast = i === size - 1;
        const isFilled = i < filledBlocks;

        if (isFirst) {
          if (filledBlocks === 1 && EMOJI_CONFIG.bar_single_f) {
            bar += EMOJI_CONFIG.bar_single_f;
          } else {
            bar += isFilled ? EMOJI_CONFIG.bar_lf : EMOJI_CONFIG.bar_le;
          }
        } else if (isLast) {
          bar += isFilled ? EMOJI_CONFIG.bar_rf : EMOJI_CONFIG.bar_re;
        } else {
          bar += isFilled ? EMOJI_CONFIG.bar_mf : EMOJI_CONFIG.bar_me;
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
    if (client?.user?.id && fleetEmojis[client.user.id]?.[key]) {
      return fleetEmojis[client.user.id][key];
    }
    return EMOJI_CONFIG[key] || UNICODE_FALLBACKS[key] || "";
  },

  unicode: UNICODE_FALLBACKS,
};

// Optional fleet emojis lookup if multi-bot applications are configured
let fleetEmojis = {};
try {
  const fleetData = require("./applicationEmojis.json");
  if (fleetData && fleetData.fleet) {
    fleetEmojis = fleetData.fleet;
  }
} catch (_) {}

module.exports = emojis;
