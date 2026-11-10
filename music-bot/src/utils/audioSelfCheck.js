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
// Note: As of 2026-11, 4.2.2 remains the latest stable release.
// The stall is a known upstream issue being tracked:
// https://github.com/lavalink-devs/Lavalink/issues/1222
const KNOWN_STALL_VERSION = "4.2.2";
const STALL_ISSUE_URL = "https://github.com/lavalink-devs/Lavalink/issues/1222";
// Builds containing koe 3.1.0 (Lavalink PR #1235) keep the 4.2.2 base version
// but already have the send-path fix. The deployment pins this commit.
const PATCHED_BUILD_COMMITS = ["f733576"];

function parseSemver(value) {
  const match = String(value || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Some Lavalink builds (including the pinned koe 3.1.0 image) report the git
 * describe string instead of a semver, e.g. "f7335760359f…-SNAPSHOT". Read the
 * value from every shape the API uses so the label is never misleading.
 */
function firstVersionString(info, node) {
  const candidates = [
    info?.version?.semver,
    typeof info?.version === "string" ? info.version : null,
    info?.version?.version,
    info?.buildVersion,
    node?.info?.version?.semver,
    typeof node?.info?.version === "string" ? node.info.version : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "unknown";
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

  const rawVersion = firstVersionString(info, node);
  const parsedVersion = parseSemver(rawVersion);
  // Identify the build by commit as well: a hash-style version is still a
  // known, pinned build and must not be reported as an unreadable version.
  const commit = String(
    info?.git?.commit || info?.version?.commit || info?.commit || (parsedVersion ? "" : rawVersion)
  ).toLowerCase();
  const isPatchedBuild = PATCHED_BUILD_COMMITS.some((c) => commit.startsWith(c));
  const versionLabel = isPatchedBuild && !String(rawVersion).startsWith(KNOWN_STALL_VERSION)
    ? `${KNOWN_STALL_VERSION}+koe-3.1.0 (${commit.slice(0, 7)})`
    : rawVersion;
  const plugins = info?.plugins || node?.info?.plugins || [];
  const pluginNames = plugins.map((p) => `${p?.name || "unknown"}${p?.version ? `@${p.version}` : ""}`);
  const lowerPlugins = plugins.map((p) => String(p?.name || "").toLowerCase());
  const sources = (info?.sourceManagers || node?.info?.sourceManagers || []).map((s) => String(s).toLowerCase());

  // 1. Version / DAVE support -------------------------------------------------
  if (isPatchedBuild) {
    notes.push(
      `Lavalink ${versionLabel} (commit ${commit.slice(0, 7)}, JVM ${info?.jvm || "?"}) is the koe 3.1.0 build - the #1222 DAVE send-path fix is active`
    );
  } else if (!parsedVersion) {
    warnings.push(
      `Node reported the version as "${rawVersion}", which is not a semver. Discord voice needs Lavalink 4.2.0+ for DAVE encryption - pin the patched image (commit ${PATCHED_BUILD_COMMITS[0]}) or a 4.2.0+ release so this can be verified.`
    );
  } else if (compareSemver(parsedVersion, DAVE_MIN_VERSION) < 0) {
    warnings.push(
      `Node runs Lavalink ${rawVersion}; DAVE (mandatory Discord voice encryption since March 2026) needs 4.2.0+. Audio will fail or arrive distorted.`
    );
  } else if (String(rawVersion).startsWith(KNOWN_STALL_VERSION)) {
    warnings.push(
      `Node runs Lavalink ${rawVersion}, which has a known DAVE send-path stall (100-400ms dropouts about once per second, Lavalink issue #1222). This is the latest stable release as of 2026-11; the stall is tracked upstream at ${STALL_ISSUE_URL}.`
    );
  } else {
    notes.push(`Lavalink ${rawVersion} supports DAVE`);
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
    `[AudioSelfCheck] Node "${node?.id || "unknown"}" • Lavalink ${versionLabel} • sources: ${
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
    version: versionLabel,
    versionRaw: rawVersion,
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
