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
const clientTimers = new Map();
const currentStatusIndices = new Map(); // clientId -> status index (or null if playing music)
const clientHistory = new Map(); // clientId -> array of recently used status indices

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
 * Pick a random Eclairs status index for a client guaranteed not to collide
 * with any status currently displayed by any other bot in the fleet.
 */
function pickRandomStatusIndex(client) {
  const clientId = client.user?.id || `bot_${client.botIndex ?? 0}`;

  // 1. Collect all status indices currently displayed by OTHER registered bots
  const occupiedIndices = new Set();
  for (const [id, idx] of currentStatusIndices.entries()) {
    if (id !== clientId && idx !== null && idx !== undefined) {
      occupiedIndices.add(idx);
    }
  }

  // 2. Retrieve recent history for this specific bot to avoid repetitive repeats
  const history = clientHistory.get(clientId) || [];
  const recentSet = new Set(history.slice(-5)); // Avoid last 5 statuses

  // 3. First tier candidates: not occupied by any other bot AND not in this bot's recent history
  let eligible = [];
  for (let i = 0; i < ECLAIRS_STATUSES.length; i++) {
    if (!occupiedIndices.has(i) && !recentSet.has(i)) {
      eligible.push(i);
    }
  }

  // 4. Fallback tier 1: if pool exhausted, only exclude other bots' active statuses + immediate previous
  if (eligible.length === 0) {
    const immediatePrev = history[history.length - 1];
    for (let i = 0; i < ECLAIRS_STATUSES.length; i++) {
      if (!occupiedIndices.has(i) && i !== immediatePrev) {
        eligible.push(i);
      }
    }
  }

  // 5. Fallback tier 2: strictly exclude other bots' active statuses
  if (eligible.length === 0) {
    for (let i = 0; i < ECLAIRS_STATUSES.length; i++) {
      if (!occupiedIndices.has(i)) {
        eligible.push(i);
      }
    }
  }

  // 6. Absolute fallback if total statuses <= bot count (cannot occur with 102 statuses)
  if (eligible.length === 0) {
    eligible = [Math.floor(Math.random() * ECLAIRS_STATUSES.length)];
  }

  // Pick a truly random status from the collision-free eligible candidates
  const chosenIndex = eligible[Math.floor(Math.random() * eligible.length)];

  // Update history and currently occupied status for this bot
  history.push(chosenIndex);
  if (history.length > 20) history.shift();
  clientHistory.set(clientId, history);
  currentStatusIndices.set(clientId, chosenIndex);

  return chosenIndex;
}

/**
 * Synchronize streaming presence for a single bot client
 */
function updatePresenceForClient(client) {
  if (!client || !client.user) return;

  const clientId = client.user?.id || `bot_${client.botIndex ?? 0}`;

  const activeTrack = getActiveTrack(client);
  if (activeTrack && activeTrack.info) {
    // When playing audio, clear idle status index so other bots can use it
    currentStatusIndices.set(clientId, null);
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

  // Pick a random status guaranteed to be distinct from all other active bots
  const chosenIndex = pickRandomStatusIndex(client);

  // Calculate dynamic guild and member counts for this bot
  let memberCount = 0;
  if (typeof client.guilds?.cache?.reduce === "function") {
    memberCount = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);
  } else if (client.guilds?.cache) {
    for (const guild of client.guilds.cache.values()) {
      memberCount += guild.memberCount || 0;
    }
  }
  const serverCount = client.guilds?.cache?.size || 0;

  const template = ECLAIRS_STATUSES[chosenIndex];
  const message = template
    .replace(/{members}/g, memberCount.toLocaleString())
    .replace(/{servers}/g, serverCount.toLocaleString());

  setStreamingPresence(client, message, DEFAULT_STREAM_URL);
}

/**
 * Initialize rotating streaming presence engine for a fleet bot.
 * Each bot rotates independently on a staggered interval so that:
 * 1. Every bot displays a unique random status at all times.
 * 2. Gateway presence updates are smoothly distributed across time.
 */
function initPresence(client) {
  if (!client) return;
  registeredClients.add(client);

  // Immediately apply an initial unique random status
  updatePresenceForClient(client);

  // Clear existing timer if already scheduled
  if (clientTimers.has(client)) {
    const existing = clientTimers.get(client);
    if (existing.interval) clearInterval(existing.interval);
    if (existing.timeout) clearTimeout(existing.timeout);
    clientTimers.delete(client);
  }

  // Stagger the rotation start by botIndex * 5s to distribute gateway presence calls
  const botIndex = client.botIndex ?? (registeredClients.size - 1);
  const staggerDelay = (botIndex * 5000) % 20000;

  const timerRef = { timeout: null, interval: null };

  timerRef.timeout = setTimeout(() => {
    if (client?.user && client.isReady()) {
      updatePresenceForClient(client);
    }

    // Continuous 20-second random rotation for this bot
    timerRef.interval = setInterval(() => {
      if (client?.user && client.isReady()) {
        updatePresenceForClient(client);
      }
    }, 20000);
    timerRef.interval.unref();
  }, staggerDelay);

  timerRef.timeout.unref();
  clientTimers.set(client, timerRef);
}

/**
 * Hook triggered when a new track starts playing
 */
function onTrackStart(client, player, track) {
  if (!client || !track || !track.info) return;
  const clientId = client.user?.id || `bot_${client.botIndex ?? 0}`;
  currentStatusIndices.set(clientId, null); // Free up idle status

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

/**
 * Stop presence timers on bot shutdown
 */
function stopPresence(client) {
  if (!client) return;
  if (clientTimers.has(client)) {
    const timer = clientTimers.get(client);
    if (timer.interval) clearInterval(timer.interval);
    if (timer.timeout) clearTimeout(timer.timeout);
    clientTimers.delete(client);
  }
  registeredClients.delete(client);
  const clientId = client.user?.id || `bot_${client.botIndex ?? 0}`;
  currentStatusIndices.delete(clientId);
  clientHistory.delete(clientId);
}

module.exports = {
  initPresence,
  stopPresence,
  updatePresence: updatePresenceForClient,
  pickRandomStatusIndex,
  onTrackStart,
  onTrackEnd,
  setStreamingPresence,
  ECLAIRS_STATUSES,
};
