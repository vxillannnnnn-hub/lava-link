/**
 * Dynamic Streaming Presence Manager (Discord Rich Activity Engine)
 *
 * Provides real-time purple "Streaming" presence across all bots in the fleet:
 * - Active track title and artist when music is actively playing on that bot instance
 * - Gapless continuous rotation of all 102 curated Eclairs community statuses when idle
 * - Computes dynamic {members} and {servers} counts in real-time
 * - Fully multi-bot aware: coordinates presence across Primary and all Clone instances
 * - Strictly satisfies Discord Gateway requirements for ActivityType.Streaming
 */

const { ActivityType } = require("discord.js");
const { truncate } = require("./formatters");
const { cleanTrackTitle } = require("./sourceManager");
const logger = require("./logger");

const DEFAULT_STREAM_URL = "https://www.twitch.tv/discord";

/**
 * 102 Curated Eclairs Community Rotating Statuses
 */
const ECLAIRS_STATUSES = [
  "☕ Eclairs • Where Memories Brew",
  "🌸 Serving {members} Beautiful Souls",
  "✨ {servers} Communities United",
  "🌙 Eclairs • Your Safe Haven",
  "💫 Spreading Warmth to {members}",
  "🦋 Eclairs • Embrace the Moment",
  "🌷 Growing Together • {servers} Strong",
  "🍃 Peace Begins at Eclairs",
  "🌟 {members} Stars in Our Sky",
  "🎀 Eclairs • Elegance in Every Word",
  "🌺 Blooming with {servers} Servers",
  "💜 Where Hearts Find Home",
  "🕊️ Eclairs • Serenity Awaits",
  "🌿 Nurturing {members} Members",
  "✿ Beauty in Every Connection",
  "🌼 Eclairs • Sunshine Community",
  "💎 {servers} Gems Connected",
  "🌈 Spreading Joy to {members}",
  "🦢 Eclairs • Grace & Warmth",
  "🌻 Positivity Flows Here",
  "🎐 {members} Souls • One Family",
  "🍀 Eclairs • Lucky to Have You",
  "🌴 Paradise for {servers} Servers",
  "💗 Love Grows at Eclairs",
  "🦚 Elegance Meets Community",
  "🌾 Harvesting Happiness Daily",
  "🎭 Eclairs • Express Yourself",
  "🌊 Waves of Joy • {members}",
  "🏵️ Eclairs • Premium Vibes",
  "💐 Bouquet of {servers} Communities",
  "🌹 Eclairs • Romance the Moment",
  "🎪 Celebrating {members} Members",
  "🧸 Eclairs • Comfort Zone",
  "🌛 Moonlit Conversations Await",
  "🎨 Painting Smiles for {servers}",
  "🪷 Eclairs • Lotus of Peace",
  "💝 Cherishing {members} Hearts",
  "🌵 Eclairs • Resilient Together",
  "🎠 Carousel of Memories",
  "🪻 Lavender Dreams • {servers}",
  "🌲 Eclairs • Evergreen Bond",
  "💖 {members} Reasons to Smile",
  "🎡 Eclairs • Endless Wonder",
  "🪸 Coral of Connections",
  "🌱 Growing with {servers} Servers",
  "🎋 Eclairs • Wishes Come True",
  "💞 Hearts Intertwined • {members}",
  "🌳 Eclairs • Rooted in Love",
  "🎍 Prosperity for All",
  "🪴 Nurturing {servers} Gardens",
  "🌏 Eclairs • World of Warmth",
  "💕 {members} Souls Connected",
  "🎑 Eclairs • Scenic Beauty",
  "🪺 Home for {servers} Families",
  "🌌 Galaxy of Kindness",
  "🎎 Eclairs • Cultural Harmony",
  "💓 Heartbeat of {members}",
  "🏔️ Eclairs • Peak Experience",
  "🎏 Flowing with Grace",
  "🪵 Eclairs • Natural Vibes",
  "🌅 Sunrise of Hope • {servers}",
  "💘 Cupid's Favorite Server",
  "🏝️ Eclairs • Island of Peace",
  "🎴 Eclairs • Artful Living",
  "🪨 Solid as {members} Members",
  "🌄 Dawn of New Friendships",
  "💟 Eclairs • Symbol of Love",
  "🏕️ Camping Under Stars",
  "🎯 Focused on {servers} Servers",
  "🪶 Eclairs • Light as Feather",
  "🌇 Golden Hour Vibes",
  "💌 Love Letters to {members}",
  "🏰 Eclairs • Castle of Dreams",
  "🎳 Striking Connections Daily",
  "🪞 Eclairs • Reflect & Grow",
  "🌆 City of {servers} Lights",
  "💒 Eclairs • Sacred Space",
  "🏯 Temple of Tranquility",
  "🎰 Jackpot of Joy • {members}",
  "🪆 Eclairs • Layers of Love",
  "🌉 Bridge to Happiness",
  "💑 Together with {servers}",
  "🏟️ Arena of Positivity",
  "🎲 Rolling Good Vibes",
  "🪅 Eclairs • Celebration Mode",
  "🌃 Starry Night • {members}",
  "💏 Eclairs • Kiss of Kindness",
  "🏛️ Pillar of {servers} Servers",
  "🎱 Behind Every Smile",
  "🪄 Magic Happens Here",
  "🌁 Misty Morning Feels",
  "💋 Eclairs • Sealed with Love",
  "🏗️ Building Dreams • {members}",
  "🎿 Gliding Through Joy",
  "🪡 Eclairs • Stitched with Care",
  "🌀 Spiral of Serenity",
  "💍 Eclairs • Precious Moments",
  "🏘️ Neighborhood of {servers}",
  "🛷 Sleigh of Happiness",
  "🪢 Eclairs • Tied by Love",
  "🌐 Connected • {members} Hearts",
  "💎 Eclairs • Diamond Standard",
];

// Set of all active bot clients in this process
const registeredClients = new Set();
let idleIndex = 0;
let rotationInterval = null;

/**
 * Find active track for a specific bot client
 */
function getActiveTrack(client) {
  if (!client?.lavalink?.players) return null;
  for (const player of client.lavalink.players.values()) {
    if (player.playing && player.queue?.current) {
      return player.queue.current;
    }
  }
  return null;
}

/**
 * Update Discord client presence with ActivityType.Streaming (purple badge)
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
 * Synchronize streaming presence for a single bot client
 */
function updatePresenceForClient(client) {
  if (!client || !client.user) return;

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

  // Calculate dynamic guild and member counts
  const memberCount = client.guilds?.cache?.reduce((acc, guild) => acc + (guild.memberCount || 0), 0) || 0;
  const serverCount = client.guilds?.cache?.size || 0;

  const template = ECLAIRS_STATUSES[idleIndex % ECLAIRS_STATUSES.length];
  const message = template
    .replace(/{members}/g, memberCount.toLocaleString())
    .replace(/{servers}/g, serverCount.toLocaleString());

  setStreamingPresence(client, message, DEFAULT_STREAM_URL);
}

/**
 * Initialize rotating streaming presence engine across all registered fleet bots
 */
function initPresence(client) {
  if (!client) return;
  registeredClients.add(client);

  // Immediately apply current status
  updatePresenceForClient(client);

  // Start continuous 20-second rotation loop across all clients
  if (!rotationInterval) {
    rotationInterval = setInterval(() => {
      idleIndex = (idleIndex + 1) % ECLAIRS_STATUSES.length;
      for (const c of registeredClients) {
        if (c?.user && c.isReady()) {
          updatePresenceForClient(c);
        }
      }
    }, 20000);
    rotationInterval.unref();
  }
}

/**
 * Hook triggered when a new track starts playing
 */
function onTrackStart(client, player, track) {
  if (!client || !track || !track.info) return;
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
  if (!client) return;
  setTimeout(() => updatePresenceForClient(client), 1500);
}

module.exports = {
  initPresence,
  updatePresence: updatePresenceForClient,
  onTrackStart,
  onTrackEnd,
  setStreamingPresence,
  ECLAIRS_STATUSES,
};
