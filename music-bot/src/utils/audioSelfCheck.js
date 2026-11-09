/**
 * Startup audio self-check
 * ---------------------------------------------------------------------------
 * Runs once per node connection and reports everything that silently degrades
 * audio: an outdated Lavalink (DAVE stalls), a missing YouTube provider, a
 * metadata-only search platform with no Spotify provider (30s previews), an
 * overloaded CPU and dropped audio frames.
 */

const config = require("../config");
const audioQuality = require("./audioQuality");
const logger = require("./logger");

// Discord requires end-to-end encrypted voice (DAVE) since March 2026.
const DAVE_MIN_VERSION = [4, 2, 0];
// This specific release has a DAVE send-path stall (Lavalink issue #1222).
const KNOWN_STALL_VERSION = "4.2.2";

function parseSemver(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("lavalink-client").LavalinkNode} node
 */
async function runAudioSelfCheck(client, node) {
  const warnings = [];
  const notes = [];

  let info = node?.info || null;
  if (typeof node?.fetchInfo === "function") {
    try {
      info = (await node.fetchInfo()) || info;
    } catch (err) {
      logger.debug(`[AudioSelfCheck] /v4/info unavailable: ${err?.message || err}`);
    }
  }

  const version = info?.version?.semver || node?.info?.version?.semver || "unknown";
  const parsedVersion = parseSemver(version);
  const plugins = info?.plugins || node?.info?.plugins || [];
  const pluginNames = plugins.map((p) => `${p?.name || "unknown"}${p?.version ? `@${p.version}` : ""}`);
  const lowerPlugins = plugins.map((p) => String(p?.name || "").toLowerCase());
  const sources = (info?.sourceManagers || node?.info?.sourceManagers || []).map((s) => String(s).toLowerCase());

  // 1. Version / DAVE support -------------------------------------------------
  if (!parsedVersion) {
    warnings.push(`Could not read the node version (got "${version}"). Discord voice needs Lavalink 4.2.0+ for DAVE encryption.`);
  } else if (compareSemver(parsedVersion, DAVE_MIN_VERSION) < 0) {
    warnings.push(
      `Node runs Lavalink ${version}; DAVE (mandatory Discord voice encryption since March 2026) needs 4.2.0+. Audio will fail or arrive distorted.`
    );
  } else if (String(version).startsWith(KNOWN_STALL_VERSION)) {
    warnings.push(
      `Node runs Lavalink ${version}, which has a known DAVE send-path stall (100-400ms dropouts about once per second, issue #1222). Update to the newest 4.2.x build.`
    );
  } else {
    notes.push(`Lavalink ${version} supports DAVE`);
  }

  // 2. YouTube provider -------------------------------------------------------
  const hasYouTube = lowerPlugins.some((n) => n.includes("youtube")) || sources.includes("youtube");
  if (!hasYouTube) {
    warnings.push(
      "No YouTube source/plugin on the node: the default ytmsearch/ytsearch playback path cannot resolve full-length Opus audio."
    );
  }

  // 3. Spotify / metadata-only mirror ----------------------------------------
  const defaultPlatform = config.player.defaultSearchPlatform;
  const hasMetadataProvider = lowerPlugins.some(
    (n) => n.includes("spotify") || n.includes("lavasrc") || n.includes("solace")
  );
  if (audioQuality.isMetadataOnlyPlatform(defaultPlatform) && !hasMetadataProvider) {
    warnings.push(
      `DEFAULT_SEARCH_PLATFORM="${defaultPlatform}" is metadata-only, but the node exposes no Spotify/LavaSrc provider: it returns nothing or 30s previews. Set DEFAULT_SEARCH_PLATFORM=ytmsearch.`
    );
  }

  // 4. Node CPU --------------------------------------------------------------
  const cpuLoad = Number(node?.stats?.cpu?.lavalinkLoad) || 0;
  if (cpuLoad > 0.8) {
    warnings.push(
      `Node Lavalink CPU load is ${(cpuLoad * 100).toFixed(1)}% — CPU starvation on the node is what produces frame dropouts, independent of ping.`
    );
  }

  // 5. Dropped frames --------------------------------------------------------
  const frames = node?.stats?.frameStats;
  if (frames) {
    const sent = frames.sent || 0;
    const deficit = frames.deficit || 0;
    if (deficit > Math.max(10, sent * 0.01)) {
      warnings.push(
        `${deficit} audio frames dropped (of ${sent} sent) — listeners will hear crackling/stutter. Check node CPU, GC pauses and the node's route to Discord.`
      );
    }
  }

  logger.lavalink(
    `[AudioSelfCheck] Node "${node?.id || "unknown"}" • Lavalink ${version} • sources: ${
      sources.join(", ") || "none"
    } • plugins: ${pluginNames.join(", ") || "none"}`
  );

  for (const note of notes) logger.info(`[AudioSelfCheck] OK: ${note}`);
  for (const warning of warnings) logger.warn(`[AudioSelfCheck] ${warning}`);
  if (warnings.length === 0) {
    logger.success("[AudioSelfCheck] Audio path verified - no degrading configuration detected.");
  }

  const report = {
    nodeId: node?.id || null,
    version,
    sources,
    plugins: pluginNames,
    cpuLoad,
    frameStats: frames || null,
    warnings,
    checkedAt: Date.now(),
  };

  if (client) client.audioSelfCheck = report;
  return report;
}

module.exports = {
  runAudioSelfCheck,
  parseSemver,
  compareSemver,
};
