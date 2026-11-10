/**
 * Discord Components V2 Layout Engine (Eara Exact Match)
 * Discord Flag: 32768 (IS_COMPONENTS_V2)
 * Clean, minimalist 3-line media container + 2 rows of sleek transport buttons
 */

const { getPlatformTheme, cleanTrackTitle } = require("./sourceManager");
const { formatDuration, createProgressBar, truncate, formatRequester } = require("./formatters");
const emojis = require("./emojis");
const config = require("../config");

const DEFAULT_ARTWORK = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300";

/**
 * Discord rejects the entire payload (400) when a media URL is not http(s), and
 * nodes can report relative or empty artwork, so validate before building.
 */
function safeMediaUrl(url, fallback = DEFAULT_ARTWORK) {
  if (typeof url === "string") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    } catch (_) {
      // fall through
    }
  }
  return fallback;
}

class ComponentsV2Container {
  constructor(accentColor = 0x2b2d31) {
    this.type = 17;
    this.accent_color = accentColor;
    this.components = [];
  }

  addSection(textContent, mediaUrl = null) {
    const validUrl = safeMediaUrl(mediaUrl);
    const section = {
      type: 9,
      components: [
        {
          type: 10,
          content: textContent,
        },
      ],
      accessory: {
        type: 11,
        media: {
          url: validUrl,
        },
      },
    };

    this.components.push(section);
    return this;
  }

  toJSON() {
    return {
      type: 17,
      accent_color: this.accent_color,
      components: this.components,
    };
  }
}

/**
 * Build exact Eara-style Components V2 payload
 * @param {import("lavalink-client").Player} player 
 * @param {import("discord.js").ActionRowBuilder[]} actionRows 
 * @returns {object} Discord REST message payload with flags: 32768
 */
function buildComponentsV2Payload(player, actionRows = []) {
  const track = player.queue.current;
  if (!track) {
    const fallbackContainer = new ComponentsV2Container(0x2b2d31);
    fallbackContainer.addSection(`### ${emojis.music} Ready for Music\nUse \`/play\` to start streaming audio.`);
    return {
      flags: 32768,
      components: [fallbackContainer],
      allowed_mentions: { parse: [], users: [] },
    };
  }

  const theme = getPlatformTheme(track.info.sourceName);
  const cleanTitle = truncate(cleanTrackTitle(track.info.title), 40);
  const cleanAuthor = truncate(track.info.author, 25);
  const uri = track.info.uri || "https://discord.com";
  const albumOrSource = track.pluginInfo?.albumName || track.pluginInfo?.album?.name || theme.name;

  const remainingMs = track.info.duration ? Math.max(0, track.info.duration - player.position) : 0;
  const endsAtUnix = Math.floor((Date.now() + remainingMs) / 1000);
  const liveCountdown = track.info.isStream ? `${emojis.live} \`[LIVE]\`` : `<t:${endsAtUnix}:R>`;

  const progressSlider = track.info.isStream
    ? `${emojis.live} \`[LIVE STREAM]\``
    : `${formatDuration(player.position)} ${createProgressBar(player.position, track.info.duration, 12)} ${formatDuration(track.info.duration)}`;

  // Eara Format Line 1: [Title](URI) — Artist
  const line1 = `[${cleanTitle}](${uri}) — ${cleanAuthor}`;

  // Eara Format Line 2: Requester display name · Album/Source (Zero pings, zero mentions)
  const requesterBadge = track.isAutoplay
    ? `${emojis.sparkles} \`Autoplay\` · ${truncate(track.seedTitle || albumOrSource, 25)}`
    : `${formatRequester(track.requester)} · ${albumOrSource}`;

  // Eara Format Line 3: 00:18 [progress-bar] 03:42
  const line3 = progressSlider;

  const sectionText = `${line1}\n${requesterBadge}\n\n${line3}`;

  // Create Container with dark sleek border
  const container = new ComponentsV2Container(0x2b2d31);
  container.addSection(sectionText, track.info.artworkUrl || theme.icon);

  // Top-level payload: Container + Button Action Rows outside the container box
  return {
    flags: 32768,
    components: [container, ...actionRows],
    allowed_mentions: { parse: [], users: [] },
    allowedMentions: { parse: [], users: [] },
  };
}

module.exports = {
  ComponentsV2Container,
  buildComponentsV2Payload,
};
