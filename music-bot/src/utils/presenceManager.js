/**
 * Dynamic Streaming Presence Manager (Discord Rich Activity Engine)
 *
 * Provides real-time purple "Streaming" presence on Discord with:
 * - Active track title and artist when music is actively playing
 * - Continuous gapless rotation of sleek monochrome presence messages when idle
 * - Strictly satisfies Discord Gateway requirement: ActivityType.Streaming requires valid stream URL
 */

const { ActivityType } = require("discord.js");
const { truncate } = require("./formatters");
const { cleanTrackTitle } = require("./sourceManager");
const logger = require("./logger");

const DEFAULT_STREAM_URL = "https://www.twitch.tv/discord";

const IDLE_MESSAGES = [
  "Pulse • High-Fidelity Audio",
  "Streaming for {members} Listeners",
  "{servers} Communities United",
  "Pulse • Ultra-Low Latency",
  "Serving {members} Members",
  "Opus Direct Passthrough • 0ms Delay",
  "Growing Together • {servers} Strong",
  "Pulse • Pure Acoustic Fidelity",
  "Streaming on {servers} Servers",
  "Continuous Flow • Gapless Audio",
  "Pulse • Studio-Grade Quality",
  "{members} Active Listeners",
  "Connected to {servers} Servers",
  "Pulse • Next-Gen Sound Architecture",
  "Zero Transcoding • Lossless Audio",
];

let idleIndex = 0;
let rotationInterval = null;

/**
 * Find first actively streaming track across all Lavalink players on this shard/client
 */
function getActiveTrack(client) {
  if (!client.lavalink?.players) return null;
  for (const player of client.lavalink.players.values()) {
    if (player.playing && player.queue?.current) {
      return player.queue.current;
    }
  }
  return null;
}

/**
 * Update Discord client presence with ActivityType.Streaming (purple badge)
 * @param {import("discord.js").Client} client 
 * @param {string} name 
 * @param {string} url 
 */
function setStreamingPresence(client, name, url = DEFAULT_STREAM_URL) {
  if (!client || !client.user) return;
  try {
    client.user.setPresence({
      activities: [
        {
          name: truncate(name, 120),
          type: ActivityType.Streaming,
          url: url || DEFAULT_STREAM_URL,
        },
      ],
      status: "online",
    });
  } catch (err) {
    logger.debug("Failed to set streaming presence:", err.message);
  }
}

/**
 * Dynamically synchronize streaming presence with active playback or idle queue
 */
function updatePresence(client) {
  const activeTrack = getActiveTrack(client);
  if (activeTrack && activeTrack.info) {
    const rawTitle = cleanTrackTitle(activeTrack.info.title) || activeTrack.info.title;
    const cleanTitle = truncate(rawTitle, 45);
    const cleanAuthor = truncate(activeTrack.info.author || "Unknown Artist", 25);
    const name = `${cleanTitle} — ${cleanAuthor}`;
    const url = activeTrack.info.uri?.includes("youtube.com") || activeTrack.info.uri?.includes("twitch.tv")
      ? activeTrack.info.uri
      : DEFAULT_STREAM_URL;

    setStreamingPresence(client, name, url);
    return;
  }

  // Fallback to idle streaming status rotation
  const memberCount = client.guilds?.cache?.reduce((acc, guild) => acc + (guild.memberCount || 0), 0) || 0;
  const serverCount = client.guilds?.cache?.size || 0;

  idleIndex = (idleIndex + 1) % IDLE_MESSAGES.length;
  const message = IDLE_MESSAGES[idleIndex]
    .replace(/{members}/g, memberCount.toLocaleString())
    .replace(/{servers}/g, serverCount.toLocaleString());

  setStreamingPresence(client, message, DEFAULT_STREAM_URL);
}

/**
 * Initialize rotating streaming presence engine
 */
function initPresence(client) {
  updatePresence(client);
  if (rotationInterval) clearInterval(rotationInterval);
  rotationInterval = setInterval(() => {
    updatePresence(client);
  }, 25000);
}

/**
 * Hook triggered when a new track starts playing
 */
function onTrackStart(client, player, track) {
  if (!track || !track.info) return;
  const rawTitle = cleanTrackTitle(track.info.title) || track.info.title;
  const cleanTitle = truncate(rawTitle, 45);
  const cleanAuthor = truncate(track.info.author || "Unknown Artist", 25);
  const name = `${cleanTitle} — ${cleanAuthor}`;
  const url = track.info.uri?.includes("youtube.com") || track.info.uri?.includes("twitch.tv")
    ? track.info.uri
    : DEFAULT_STREAM_URL;

  setStreamingPresence(client, name, url);
}

/**
 * Hook triggered when a track completes or queue ends
 */
function onTrackEnd(client) {
  setTimeout(() => updatePresence(client), 1500);
}

module.exports = {
  initPresence,
  updatePresence,
  onTrackStart,
  onTrackEnd,
  setStreamingPresence,
};
