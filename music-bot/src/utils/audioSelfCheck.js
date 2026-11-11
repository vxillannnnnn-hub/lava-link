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
const frameMonitor = require("./frameMonitor");
const logger = require("./logger");

// Discord requires end-to-end encrypted voice (DAVE) since March 2026.
const DAVE_MIN_VERSION = [4, 2, 0];
// This specific release has a DAVE send-path stall (Lavalink issue #1222).
// Note: As of 2026-11, 4.2.2 remains the latest stable release.
// The stall is a known upstream issue being tracked:
// https://github.com/lavalink-devs/Lavalink/issues/1222
const KNOWN_STALL_VERSION = "4.2.2";
const STALL_ISSUE_URL = "https://github.com/lavalink-devs/Lavalink/issues/1222";
// Builds whose koe/libdave carries the send-path fix keep the last release's
// version string, so branch + commit is what identifies them: upstream `dev`
// merged the koe/libdave update in PR #1234 and publishes that build to
// ghcr.io/lavalink-devs/lavalink:dev. f733576 is the older third-party PR image,
// kept so a deployment still running it is recognised as patched too.
const PATCHED_BUILD_COMMITS = ["f733576"];
const PATCHED_BRANCHES = ["dev"];

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
  const branch = String(info?.git?.branch || "").toLowerCase();
  // A dev build reports the last release's semver (4.2.2) while already having
  // the koe/libdave fix, so the semver alone must never be used to claim the
  // stall is present.
  const isDevBranch = PATCHED_BRANCHES.includes(branch);
  const isPatchedBuild = isDevBranch || PATCHED_BUILD_COMMITS.some((c) => commit.startsWith(c));
  const buildSuffix = [branch || null, commit.slice(0, 7) || null].filter(Boolean).join(" ");
  const versionLabel = isPatchedBuild
    ? `${rawVersion}${String(rawVersion).includes("dev") ? "" : "+patched"}${buildSuffix ? ` (${buildSuffix})` : ""}`
    : rawVersion;
  const plugins = info?.plugins || node?.info?.plugins || [];
  const pluginNames = plugins.map((p) => `${p?.name || "unknown"}${p?.version ? `@${p.version}` : ""}`);
  const lowerPlugins = plugins.map((p) => String(p?.name || "").toLowerCase());
  const sources = (info?.sourceManagers || node?.info?.sourceManagers || []).map((s) => String(s).toLowerCase());

  // 1. Version / DAVE support -------------------------------------------------
  if (isPatchedBuild) {
    notes.push(
      `Lavalink ${versionLabel} - branch "${branch || "?"}", commit ${commit.slice(0, 7) || "?"}, JVM ${info?.jvm || "?"}, Lavaplayer ${info?.lavaplayer || "?"}. This build carries the koe/libdave update with the #1222 DAVE send-path fix (${STALL_ISSUE_URL}).`
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
      `Node runs the ${KNOWN_STALL_VERSION} release (branch "${branch || "?"}", commit ${commit.slice(0, 7) || "?"}), whose DAVE path stalls 100-400ms about once per second (Lavalink issue #1222) - heard as constant crackle. Deploy a build with the koe/libdave update (upstream ghcr.io/lavalink-devs/lavalink:dev, or any build containing koe 3.1.0+); see ${STALL_ISSUE_URL}.`
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
    `[AudioSelfCheck] Node "${node?.id || "unknown"}" • Lavalink ${versionLabel} • branch ${
      branch || "?"
    } • commit ${commit.slice(0, 7) || "?"} • JVM ${info?.jvm || "?"} • Lavaplayer ${
      info?.lavaplayer || "?"
    } • sources: ${sources.join(", ") || "none"} • plugins: ${pluginNames.join(", ") || "none"}`
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
    branch: branch || null,
    commit: commit || null,
    lavaplayer: info?.lavaplayer || null,
    jvm: info?.jvm || null,
    patched: isPatchedBuild,
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

// DSP filters that force a decode, in the order a listener would look for them.
const FILTER_LABELS = {
  timescale: "timescale",
  tremolo: "tremolo",
  vibrato: "vibrato",
  rotation: "rotation",
  distortion: "distortion",
  karaoke: "karaoke",
  lowPass: "low-pass",
};

/**
 * Which filters are active on this player, by name, so the audit can say why a
 * guild is re-encoding instead of only that it is.
 *
 * @param {import("lavalink-client").Player} player
 * @returns {string[]}
 */
function activeFilterNames(player) {
  const data = player?.filterManager?.data || {};
  const names = [];
  for (const [key, label] of Object.entries(FILTER_LABELS)) {
    if (data[key]) names.push(label);
  }
  const equalizer = Array.isArray(data.equalizer) ? data.equalizer : [];
  const bands = equalizer.filter((band) => Number(band?.gain) !== 0);
  if (bands.length) names.push(`equalizer (${bands.length} band${bands.length === 1 ? "" : "s"})`);
  if (data.volume && Number(data.volume) !== 1) names.push("volume filter");
  return names;
}

/**
 * Startup transcode audit
 * ---------------------------------------------------------------------------
 * Lists every playing player that is on the decode -> re-encode path, and why.
 * Passthrough players are counted but not listed: the point is an actionable
 * list of the guilds whose audio costs CPU (the cheapest frame drops to
 * remove), not a roster.
 *
 * Runs after `stateManager.restoreState` / `reconnect247` in the node connect
 * handler - no player exists yet when the node first reports ready.
 *
 * @param {import("discord.js").Client} client
 * @param {import("lavalink-client").LavalinkNode} [node]
 */
async function auditTranscoding(client, node) {
  const allPlayers = client?.lavalink?.players?.values
    ? [...client.lavalink.players.values()]
    : [];
  const onNode = node?.id ? allPlayers.filter((player) => player?.node?.id === node.id) : allPlayers;
  const playing = onNode.filter((player) => player?.queue?.current && player?.voiceChannelId);

  const transcoding = [];
  for (const player of playing) {
    const track = player.queue.current;
    const reasons = frameMonitor.transcodeReasons(player, track);
    if (reasons.length === 0) continue;

    const filters = activeFilterNames(player);
    const labels = reasons.map((reason) =>
      reason.key === "filter" && filters.length
        ? `DSP filter: ${filters.join(", ")}`
        : reason.label
    );
    const guild = client?.guilds?.cache?.get?.(player.guildId) || null;

    transcoding.push({
      guildId: player.guildId,
      guildName: guild?.name || null,
      channelId: player.voiceChannelId || null,
      track: `${track?.info?.title || "unknown"} — ${track?.info?.author || "unknown"}`,
      codec: track?.info?.codec || null,
      sourceName: track?.info?.sourceName || null,
      volume: Number(player.volume ?? 100),
      paused: Boolean(player.paused),
      reasons: labels,
      // Deduplicated: two reasons can share the same action.
      fixes: [...new Set(reasons.map((reason) => reason.fix))],
    });
  }

  transcoding.sort((a, b) =>
    (a.guildName || a.guildId || "").localeCompare(b.guildName || b.guildId || "")
  );

  const report = {
    nodeId: node?.id || null,
    playing: playing.length,
    passthrough: playing.length - transcoding.length,
    transcoding,
    auditedAt: Date.now(),
  };

  if (playing.length === 0) {
    logger.debug("[AudioSelfCheck] Transcode audit: no playing players on the node.");
  } else if (transcoding.length === 0) {
    logger.success(
      `[AudioSelfCheck] Transcode audit: all ${playing.length} playing player(s) are on bit-exact Opus passthrough.`
    );
  } else {
    logger.warn(
      `[AudioSelfCheck] Transcode audit: ${transcoding.length} of ${playing.length} playing player(s) re-encode audio (no Opus passthrough).`
    );
    for (const entry of transcoding) {
      const where = entry.guildName || `guild ${entry.guildId}`;
      logger.warn(
        `[AudioSelfCheck]   ${where}${entry.paused ? " (paused)" : ""} — "${entry.track}" — ${entry.reasons.join(" + ")}`
      );
    }
    for (const fix of [...new Set(transcoding.flatMap((entry) => entry.fixes))]) {
      logger.info(`[AudioSelfCheck]   fix: ${fix}`);
    }
  }

  // Merge rather than replace: the node self-check report is already attached
  // and /audio reads it.
  if (client) client.audioSelfCheck = { ...(client.audioSelfCheck || {}), transcodingAudit: report };
  return report;
}

module.exports = {
  runAudioSelfCheck,
  auditTranscoding,
  activeFilterNames,
  parseSemver,
  compareSemver,
};
