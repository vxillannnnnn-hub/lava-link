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

const EMOJI_CONFIG = {
  // ---------------------------------------------------------------------------
  // 1. PLAYER TRANSPORT CONTROLS (Monochrome White Static Guild Emojis)
  // ---------------------------------------------------------------------------
  play: "<:p_play:1568622109146615811>",
  pause: "<:p_pause:1568622118898372610>",
  playpause: "<:p_playpause:1568622129212039178>",
  previous: "<:p_previous:1568622151290982531>",
  skip: "<:p_skip:1568622140767346770>",
  stop: "<:p_stop:1568622161751572501>",
  loop: "<:p_loop:1568622172883263508>",
  loopOne: "<:p_loop_one:1568622183922667662>",
  shuffle: "<:p_shuffle:1568622196367163392>",
  autoplay: "<:p_autoplay:1568622207150723194>",
  save: "<:p_heart:1568622217753919560>",
  heart: "<:p_heart:1568622217753919560>",
  openPlayer: "⏏",
  queue: "<:p_queue:1568622228541673572>",

  // ---------------------------------------------------------------------------
  // 2. VOLUME CONTROLS & AUDIO LEVELS
  // ---------------------------------------------------------------------------
  volume: "<:p_volume:1568622239253790873>",
  volumeNormal: "<:p_volume:1568622239253790873>",
  volumeLow: "<:p_volumelow:1568622250347991041>",
  volumeMute: "<:p_volumemute:1568622261282545776>",
  volumeBoost: "<:p_volume:1568622239253790873>",

  // ---------------------------------------------------------------------------
  // 3. SYSTEM STATUS, ALERTS & BADGES (100% Monochrome White Vector Emojis)
  // ---------------------------------------------------------------------------
  success: "<:p_check:1568622344853790860>",
  check: "<:p_check:1568622344853790860>",
  error: "<:p_cross:1568622356170145883>",
  cross: "<:p_cross:1568622356170145883>",
  warn: "<:p_cross:1568622356170145883>",
  alert: "<:p_cross:1568622356170145883>",
  info: "<:p_music:1568622286066688281>",
  sparkles: "<:p_sparkles:1568622274339151945>",
  fire: "<:p_fire:1568622332535242923>",
  pin: "<:p_sparkles:1568622274339151945>",
  live: "<:p_radio:1568622309139554354>",
  online: "<:p_check:1568622344853790860>",
  offline: "<:p_cross:1568622356170145883>",

  // ---------------------------------------------------------------------------
  // 4. MUSIC FEATURES & UTILITY CONTROLS (100% Monochrome White Vector Emojis)
  // ---------------------------------------------------------------------------
  music: "<:p_music:1568622286066688281>",
  disc: "<:p_disc:1568622296204189759>",
  radio: "<:p_radio:1568622309139554354>",
  dj: "<:p_dj:1568622319746687017>",
  playlist: "<:p_queue:1568622228541673572>",
  lyrics: "<:p_music:1568622286066688281>",
  scroll: "<:p_queue:1568622228541673572>",
  search: "<:p_music:1568622286066688281>",
  equalizer: "<:p_volume:1568622239253790873>",
  time: "<:p_disc:1568622296204189759>",
  user: "<:p_dj:1568622319746687017>",
  link: "<:p_music:1568622286066688281>",
  stats: "<:p_volume:1568622239253790873>",
  ping: "<:p_radio:1568622309139554354>",
  clear: "<:p_stop:1568622161751572501>",
  reset: "<:p_loop:1568622172883263508>",
  settings: "<:p_dj:1568622319746687017>",
  gear: "<:p_dj:1568622319746687017>",
  help: "<:p_sparkles:1568622274339151945>",
  pointer: "›",
  book: "<:p_queue:1568622228541673572>",
  leave: "<:p_stop:1568622161751572501>",
  wave: "<:p_stop:1568622161751572501>",
  vote: "<:p_check:1568622344853790860>",
  mic: "<:p_music:1568622286066688281>",
  guitar: "<:p_music:1568622286066688281>",
  audio: "<:p_volume:1568622239253790873>",

  // ---------------------------------------------------------------------------
  // 5. STREAMING PLATFORMS (Monochrome White Branding)
  // ---------------------------------------------------------------------------
  spotify: "<:p_spotify:1568622368295747694>",
  youtube: "<:p_youtube:1568622379339354313>",
  soundcloud: "<:p_soundcloud:1568622390131298414>",
  jiosaavn: "<:p_music:1568622286066688281>",
  bandcamp: "<:p_disc:1568622296204189759>",
  twitch: "<:p_radio:1568622309139554354>",
  web: "<:p_disc:1568622296204189759>",

  // ---------------------------------------------------------------------------
  // 6. DSP AUDIO FILTERS
  // ---------------------------------------------------------------------------
  filter8D: "<:p_dj:1568622319746687017>",
  filterBass: "<:p_volume:1568622239253790873>",
  filterNightcore: "<:p_sparkles:1568622274339151945>",
  filterVaporwave: "<:p_disc:1568622296204189759>",
  filterKaraoke: "<:p_music:1568622286066688281>",
  filterPop: "<:p_music:1568622286066688281>",
  filterRock: "<:p_music:1568622286066688281>",
  filterNormalizer: "<:p_disc:1568622296204189759>",
  filterReset: "<:p_loop:1568622172883263508>",

  // ---------------------------------------------------------------------------
  // 7. SEAMLESS PROGRESS BAR BLOCKS
  // ---------------------------------------------------------------------------
  bar_lf: "<:p_bar_lf:1568622402752086026>",
  bar_mf: "<:p_bar_mf:1568622415146127530>",
  bar_rf: "<:p_bar_rf:1568622425145475084>",
  bar_le: "<:p_bar_le:1568622436230897744>",
  bar_me: "<:p_bar_me:1568622446381240421>",
  bar_re: "<:p_bar_re:1568622457470849024>",
  bar_single_f: "<:p_bar_single_f:1568622469194063932>",
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
};

module.exports = emojis;
