/**
 * Real-Time Voice Channel Status (VC Status) Manager
 *
 * Automatically updates and rotates Discord Voice Channel Status in real time.
 * Enforces strictly 100% clean text WITHOUT emojis.
 *
 * Supported Template Variables:
 *   {title} or {song name} - Cleaned track title
 *   {author} or {singer}   - Artist / Performer name
 *   {duration}             - Formatted time (e.g. 03:42 or LIVE)
 *   {source}               - Platform name (e.g. Spotify, YouTube)
 */

const logger = require("./logger");
const config = require("../config");
const { formatDuration, truncate } = require("./formatters");
const { cleanTrackTitle } = require("./sourceManager");
let db;
try {
  db = require("../database/db");
} catch (_) {}

// Default curated clean templates for playing tracks (Strictly ZERO emojis)
const DEFAULT_TEMPLATES = [
  "{title} by - {author}",          // Exact user-requested format
  "{title} by {author}",            // Clean classic format
  "Playing: {title} by {author}",   // Streaming standard
  "[{duration}] {title} by {author}", // Timestamped layout
  "{title} - {author}",             // Minimalist format
  "Listening to {title} - {author}",// Rich presence format
  "{title} | {author}",             // Modern pipe separator
];

// 10 Curated Cool Idle Voice Channel Statuses when nothing is playing or bot is alone in VC (Strictly ZERO emojis)
const DEFAULT_IDLE_TEMPLATES = [
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
];

// Active interval rotation timers mapped by voiceChannelId
const activeTimers = new Map();

// Pending cooldown timers mapped by voiceChannelId (guarantees updates are never dropped)
const pendingUpdateTimers = new Map();

// In-memory cache of current status per voiceChannelId to avoid redundant REST requests
const channelStatusCache = new Map();

// Current rotating template index by voiceChannelId
const templateIndices = new Map();
const idleTemplateIndices = new Map();

// Minimum interval between updates to the same channel to safeguard against Discord 429s
const MIN_UPDATE_COOLDOWN_MS = 5000;
const lastUpdateTimes = new Map();

/**
 * Format idle status string with server prefix (No Emojis guaranteed)
 * @param {string} template 
 * @param {string} [guildId] 
 * @returns {string}
 */
function formatIdleStatus(template, guildId = null) {
  let prefix = ".";
  if (guildId && db?.getGuildPrefix) {
    try {
      prefix = db.getGuildPrefix(guildId) || config.discord?.prefix || ".";
    } catch {
      prefix = config.discord?.prefix || ".";
    }
  } else {
    prefix = config.discord?.prefix || ".";
  }

  let status = template.replace(/\{prefix\}/gi, prefix);

  // Strictly strip all Unicode emojis, pictographs and symbols to enforce clean text
  status = status
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return truncate(status, 100);
}

/**
 * Format status string using template and track metadata (No Emojis guaranteed)
 * @param {string} template 
 * @param {object} track 
 * @returns {string}
 */
function formatStatusString(template, track) {
  if (!track || !track.info) return "";

  const rawTitle = cleanTrackTitle(track.info.title) || track.info.title || "Unknown Track";
  const cleanTitle = truncate(rawTitle.replace(/\s+/g, " ").trim(), 48);
  const cleanAuthor = truncate((track.info.author || "Unknown Artist").replace(/\s+/g, " ").trim(), 32);
  const duration = track.info.isStream ? "LIVE" : formatDuration(track.info.duration);
  const source = track.info.sourceName
    ? track.info.sourceName.charAt(0).toUpperCase() + track.info.sourceName.slice(1)
    : "Audio";

  let status = template
    .replace(/\{title\}/gi, cleanTitle)
    .replace(/\{song\s*name\}/gi, cleanTitle)
    .replace(/\{author\}/gi, cleanAuthor)
    .replace(/\{singer\}/gi, cleanAuthor)
    .replace(/\{duration\}/gi, duration)
    .replace(/\{source\}/gi, source);

  // Strictly strip all Unicode emojis, pictographs and symbols to enforce clean text
  status = status
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, "") // Strip custom Discord emojis
    .replace(/\s+/g, " ")
    .trim();

  // Clamp to 100 characters for optimal visibility in Discord Voice Channel header
  return truncate(status, 100);
}

/**
 * Send Voice Channel Status update via Discord REST API
 * Guarantees priority updates (such as new songs starting) are never dropped.
 * @param {import("discord.js").Client} client 
 * @param {string} voiceChannelId 
 * @param {string} statusText 
 * @param {boolean} [isPriority=false] 
 * @returns {Promise<boolean>}
 */
async function setChannelStatus(client, voiceChannelId, statusText, isPriority = false) {
  if (!client || !voiceChannelId) return false;

  const currentCached = channelStatusCache.get(voiceChannelId);
  if (currentCached === statusText) {
    return true; // No change, skip REST call
  }

  const now = Date.now();
  const lastUpdate = lastUpdateTimes.get(voiceChannelId) || 0;
  const elapsed = now - lastUpdate;

  // Clear any pending queued update for this channel
  if (pendingUpdateTimers.has(voiceChannelId)) {
    clearTimeout(pendingUpdateTimers.get(voiceChannelId));
    pendingUpdateTimers.delete(voiceChannelId);
  }

  // If in rate-limit cooldown, queue to fire automatically when cooldown expires
  if (elapsed < MIN_UPDATE_COOLDOWN_MS) {
    const delay = Math.max(100, MIN_UPDATE_COOLDOWN_MS - elapsed + 50);
    const timer = setTimeout(async () => {
      pendingUpdateTimers.delete(voiceChannelId);
      await setChannelStatus(client, voiceChannelId, statusText, isPriority);
    }, delay);
    if (timer.unref) timer.unref();
    pendingUpdateTimers.set(voiceChannelId, timer);
    return true;
  }

  lastUpdateTimes.set(voiceChannelId, now);

  try {
    await client.rest.put(`/channels/${voiceChannelId}/voice-status`, {
      body: { status: statusText || "" },
    });
    channelStatusCache.set(voiceChannelId, statusText || "");
    logger.info(`[VC Status] ✅ Updated VC <#${voiceChannelId}> -> "${statusText}"`);
    return true;
  } catch (err) {
    if (err.status === 403) {
      logger.debug(`[VC Status] Missing permission SET_VOICE_CHANNEL_STATUS in channel ${voiceChannelId}`);
    } else if (err.status === 429) {
      logger.warn(`[VC Status] Rate limited updating status on channel ${voiceChannelId}, retrying in 5s...`);
      const retryTimer = setTimeout(() => {
        setChannelStatus(client, voiceChannelId, statusText, true);
      }, 5000);
      if (retryTimer.unref) retryTimer.unref();
      pendingUpdateTimers.set(voiceChannelId, retryTimer);
    } else {
      logger.debug(`[VC Status] Failed to update VC status on ${voiceChannelId}:`, err.message);
    }
    return false;
  }
}

/**
 * Start rotation cycle for a playing track
 * @param {import("discord.js").Client} client 
 * @param {import("lavalink-client").Player} player 
 * @param {object} track 
 */
function startRotation(client, player, track) {
  const voiceChannelId = player.voiceChannelId;
  if (!voiceChannelId) return;

  // Clear any existing rotation or idle timer for this voice channel
  stopRotation(voiceChannelId);

  const templates = config.voiceStatus?.templates || DEFAULT_TEMPLATES;
  let currentIndex = templateIndices.get(voiceChannelId) || 0;

  // Immediately render and apply the active template with priority = true
  const initialText = formatStatusString(templates[currentIndex % templates.length], track);
  setChannelStatus(client, voiceChannelId, initialText, true);

  // Schedule template rotation while the song plays
  const rotateInterval = config.voiceStatus?.rotateIntervalMs || 35000;
  const timer = setInterval(() => {
    const activePlayer = client.lavalink?.getPlayer(player.guildId);
    if (!activePlayer || !activePlayer.playing || activePlayer.paused || !activePlayer.voiceChannelId) {
      stopRotation(voiceChannelId);
      return;
    }

    const currentTrack = activePlayer.queue.current;
    if (!currentTrack) {
      stopRotation(voiceChannelId);
      return;
    }

    currentIndex = (currentIndex + 1) % templates.length;
    templateIndices.set(voiceChannelId, currentIndex);

    const rotatedText = formatStatusString(templates[currentIndex], currentTrack);
    setChannelStatus(client, activePlayer.voiceChannelId, rotatedText, false);
  }, rotateInterval);

  if (timer.unref) timer.unref();
  activeTimers.set(voiceChannelId, timer);
}

/**
 * Stop rotation timer for a voice channel
 * @param {string} voiceChannelId 
 */
function stopRotation(voiceChannelId) {
  if (!voiceChannelId) return;
  if (activeTimers.has(voiceChannelId)) {
    clearInterval(activeTimers.get(voiceChannelId));
    activeTimers.delete(voiceChannelId);
  }
  if (pendingUpdateTimers.has(voiceChannelId)) {
    clearTimeout(pendingUpdateTimers.get(voiceChannelId));
    pendingUpdateTimers.delete(voiceChannelId);
  }
}

/**
 * Track Start Hook
 */
function onTrackStart(client, player, track) {
  if (config.voiceStatus?.enabled === false) return;
  if (!player?.voiceChannelId || !track) return;

  const voiceChannelId = player.voiceChannelId;
  // Cycle to next template for each new track
  const prevIndex = templateIndices.get(voiceChannelId) || 0;
  const nextIndex = (prevIndex + 1) % (config.voiceStatus?.templates?.length || DEFAULT_TEMPLATES.length);
  templateIndices.set(voiceChannelId, nextIndex);

  startRotation(client, player, track);
}

/**
 * Playback Pause Hook
 */
function onPause(client, player) {
  if (config.voiceStatus?.enabled === false) return;
  const voiceChannelId = player.voiceChannelId;
  if (!voiceChannelId) return;

  const track = player.queue?.current;
  if (!track) return;

  stopRotation(voiceChannelId);

  const rawTitle = cleanTrackTitle(track.info.title) || track.info.title;
  const cleanTitle = truncate(rawTitle, 45);
  const cleanAuthor = truncate(track.info.author, 30);
  const pausedText = `Paused: ${cleanTitle} by - ${cleanAuthor}`;
  setChannelStatus(client, voiceChannelId, pausedText, true);
}

/**
 * Playback Resume Hook
 */
function onResume(client, player) {
  if (config.voiceStatus?.enabled === false) return;
  const track = player.queue?.current;
  if (!track) return;

  startRotation(client, player, track);
}

/**
 * Set and continuously rotate cool idle Voice Channel statuses when bot is idle or alone in VC
 * @param {import("discord.js").Client} client 
 * @param {string} voiceChannelId 
 * @param {string} guildId 
 */
function setIdleVoiceStatus(client, voiceChannelId, guildId) {
  if (config.voiceStatus?.enabled === false) return;
  if (!client || !voiceChannelId || !guildId) return;

  // Active Player Safety: If audio is currently playing in this channel, NEVER set idle status!
  const activePlayer = client.lavalink?.getPlayer(guildId);
  if (activePlayer && (activePlayer.playing || activePlayer.queue?.current) && activePlayer.voiceChannelId === voiceChannelId) {
    logger.debug(`[VC Status] Skipping idle status because audio is currently playing in <#${voiceChannelId}>`);
    if (activePlayer.queue?.current) {
      startRotation(client, activePlayer, activePlayer.queue.current);
    }
    return;
  }

  // Clear any existing rotation or idle timer for this voice channel
  stopRotation(voiceChannelId);

  const idleTemplates = config.voiceStatus?.idleTemplates || DEFAULT_IDLE_TEMPLATES;
  let currentIndex = idleTemplateIndices.get(voiceChannelId) ?? Math.floor(Math.random() * idleTemplates.length);
  idleTemplateIndices.set(voiceChannelId, currentIndex);

  const initialStatus = formatIdleStatus(idleTemplates[currentIndex % idleTemplates.length], guildId);
  setChannelStatus(client, voiceChannelId, initialStatus, false);

  // Continuous rotation for idle status
  const rotateInterval = config.voiceStatus?.rotateIntervalMs || 35000;
  const timer = setInterval(() => {
    // If bot has started playing a track, switch immediately to track rotation
    const p = client.lavalink?.getPlayer(guildId);
    if (p && p.playing && !p.paused && p.queue.current && p.voiceChannelId === voiceChannelId) {
      stopRotation(voiceChannelId);
      startRotation(client, p, p.queue.current);
      return;
    }

    // Verify bot is still in this voice channel
    const currentVCId = p?.voiceChannelId || client.guilds.cache.get(guildId)?.members.me?.voice.channelId;
    if (!currentVCId || currentVCId !== voiceChannelId) {
      stopRotation(voiceChannelId);
      return;
    }

    currentIndex = (currentIndex + 1) % idleTemplates.length;
    idleTemplateIndices.set(voiceChannelId, currentIndex);

    const rotatedStatus = formatIdleStatus(idleTemplates[currentIndex], guildId);
    setChannelStatus(client, currentVCId, rotatedStatus, false);
  }, rotateInterval);

  if (timer.unref) timer.unref();
  activeTimers.set(voiceChannelId, timer);
}

/**
 * Track End Hook
 */
function onTrackEnd(client, player) {
  if (!player?.voiceChannelId) return;
  stopRotation(player.voiceChannelId);

  // Only set idle status if queue is empty and autoplay is not active
  const hasNext = (player.queue?.tracks?.length || 0) > 0 || Boolean(player.get("autoplay"));
  if (!hasNext) {
    setIdleVoiceStatus(client, player.voiceChannelId, player.guildId);
  }
}

/**
 * Clear Voice Channel Status when queue ends, bot stops, or player is destroyed
 * @param {import("discord.js").Client} client 
 * @param {string} voiceChannelId 
 * @param {string} [guildId] 
 */
async function clearVoiceStatus(client, voiceChannelId, guildId) {
  if (voiceChannelId) {
    stopRotation(voiceChannelId);
    idleTemplateIndices.delete(voiceChannelId);
    templateIndices.delete(voiceChannelId);
    channelStatusCache.delete(voiceChannelId);
    lastUpdateTimes.delete(voiceChannelId);

    try {
      await client.rest.put(`/channels/${voiceChannelId}/voice-status`, {
        body: { status: "" },
      });
      logger.debug(`[VC Status] Cleared voice status for channel ${voiceChannelId}`);
    } catch (err) {
      logger.debug(`[VC Status] Failed to clear status for channel ${voiceChannelId}:`, err.message);
    }
  }
}

module.exports = {
  DEFAULT_TEMPLATES,
  DEFAULT_IDLE_TEMPLATES,
  formatStatusString,
  formatIdleStatus,
  setChannelStatus,
  startRotation,
  stopRotation,
  setIdleVoiceStatus,
  onTrackStart,
  onPause,
  onResume,
  onTrackEnd,
  clearVoiceStatus,
};
