/**
 * Audio Fidelity Guard
 * ---------------------------------------------------------------------------
 * Lavalink can never sound better than the source it is handed. Discord voice
 * only accepts Opus, and Lavaplayer forwardOpus (packet passthrough) is only
 * possible when the source already is Opus (YouTube / YouTube Music / SoundCloud
 * Opus / WebM streams). Metadata-only providers (Spotify, Deezer, Apple Music,
 * Tidal, JioSaavn) are resolved to mirror streams that are frequently
 * re-encoded, and Spotify without credentials on the node returns 30 second
 * previews instead of the full track.
 *
 * This is exactly what Jockie / Eara class bots avoid: they keep the metadata
 * source for display, but stream a full-length Opus source, and they never let
 * a preview or a sub-45s clip into the queue as if it were the real song.
 *
 * Strategy implemented here:
 *   1. Opus-native platforms are played untouched (zero transcode, best quality).
 *   2. Metadata-only resolutions are upgraded to a full-length YouTube Music
 *      Opus match only when they are previews/clips (or when explicitly forced).
 *   3. Any upgrade is time-boxed so it can never add noticeable start latency.
 */

const config = require("../config");
const logger = require("./logger");
const { cleanTrackTitle } = require("./sourceManager");

const quality = config.player?.quality || {};

const DEFAULT_METADATA_ONLY_SOURCES = [
  "spotify",
  "deezer",
  "applemusic",
  "tidal",
  "jiosaavn",
  "yandexmusic",
  "flowery-tts",
];

// Sources whose frames usually reach Lavalink already encoded as Opus. Bandcamp
// is deliberately absent: it serves MP3, so it always has to be re-encoded.
// YouTube-plugin tracks report sourceName "youtube" (the source manager), and
// YouTube Music resolutions go through that same manager, so both spellings are
// accepted here. `http` is only a last-resort fallback for nodes that report no
// codec at all - a direct URL may be an MP3/Icecast stream, which is why
// isOpusNativeTrack() prefers the node-reported codec whenever one exists.
const OPUS_NATIVE_SOURCES = new Set(["youtube", "youtubemusic", "soundcloud", "http"]);

const METADATA_ONLY_SOURCES = new Set(
  (quality.metadataOnlySources || DEFAULT_METADATA_ONLY_SOURCES).map((s) => String(s).toLowerCase())
);

const PREVIEW_MAX_DURATION_MS = Number.isFinite(quality.previewMaxDurationMs)
  ? quality.previewMaxDurationMs
  : 31000;

const UPGRADE_TIMEOUT_MS = Number.isFinite(quality.upgradeTimeoutMs)
  ? quality.upgradeTimeoutMs
  : 4000;

// Anything shorter than this is a preview, a sound effect or a clip, never the
// full song the user asked for.
const MIN_REAL_TRACK_DURATION_MS = 45000;

// Lavalink search prefixes that resolve to those metadata-only providers.
const METADATA_ONLY_SEARCH_PREFIXES = new Set([
  "spsearch",
  "dzsearch",
  "amsearch",
  "tdsearch",
  "jssearch",
  "ymsearch",
]);

function sourceOf(track) {
  return String(track?.info?.sourceName || "").toLowerCase();
}

/**
 * Container codec reported by the node (`opus`, `mp3`, `aac`, ...). It is the
 * only reliable signal for whether frames can be forwarded bit-exact, so it
 * wins over the source name whenever the node reports one.
 */
function codecOf(track) {
  return String(track?.info?.codec || "").toLowerCase();
}

/**
 * True when the node holds Opus frames for this track. A direct HTTP MP3 stream
 * shares a "native" source name but still has to be transcoded, so the source
 * name is only a fallback for nodes that report no codec at all.
 */
function isOpusNativeTrack(track) {
  const codec = codecOf(track);
  if (codec) return codec === "opus";
  return OPUS_NATIVE_SOURCES.has(sourceOf(track));
}

function isMetadataOnlyTrack(track) {
  return METADATA_ONLY_SOURCES.has(sourceOf(track));
}

// Name of each filter flag lavalink-client derives from the filter *values*.
const ACTIVE_FILTER_LABELS = [
  ["volume", "volume filter"],
  ["nightcore", "nightcore"],
  ["vaporwave", "vaporwave"],
  ["rotation", "rotation"],
  ["karaoke", "karaoke"],
  ["tremolo", "tremolo"],
  ["vibrato", "vibrato"],
  ["lowPass", "low-pass"],
  ["nodeLinkEcho", "echo"],
  ["nodeLinkChorus", "chorus"],
  ["nodeLinkCompressor", "compressor"],
  ["nodeLinkHighPass", "high-pass"],
  ["nodeLinkPhaser", "phaser"],
  ["nodeLinkSpatial", "spatial"],
];

/**
 * Active DSP filters on a player, by human name. Empty array = clean path.
 *
 * lavalink-client keeps a *default object for every filter* in
 * `filterManager.data` (timescale {1,1,1}, tremolo {0,0}, vibrato {0,0},
 * rotation {0}, karaoke {0,0,0,0}, lowPass {smoothing:0}, ...). Testing those
 * objects for truthiness therefore reports a completely clean player as
 * "timescale, tremolo, vibrato, rotation, karaoke, low-pass" - which is exactly
 * what this guard and the transcode audit used to do. Two consequences:
 *
 *   1. every healthy player was logged as "re-encoding audio (no Opus
 *      passthrough)", and
 *   2. frameMonitor.recommendFix() checks the filter reason first, so the
 *      audible crackle was reported as "reset your filters" instead of the
 *      DAVE send-path stall it actually is.
 *
 * The flags in `filterManager.filters` are derived numerically from the values
 * by `checkFiltersState()`, so they are the authoritative view.
 *
 * @param {import("lavalink-client").Player} player
 * @returns {string[]}
 */
function activeFilterNames(player) {
  const manager = player?.filterManager;
  if (!manager) return [];

  if (typeof manager.checkFiltersState === "function") {
    try {
      manager.checkFiltersState();
    } catch (_) {
      // Advisory only: odd filter data must never throw inside an audit.
    }
  }

  const names = [];
  const flags = manager.filters || {};
  for (const [key, label] of ACTIVE_FILTER_LABELS) {
    if (flags[key]) names.push(label);
  }
  if (flags.lavalinkFilterPlugin?.echo) names.push("echo (plugin)");
  if (flags.lavalinkFilterPlugin?.reverb) names.push("reverb (plugin)");
  if (flags.lavalinkLavalinkDspxPlugin?.lowPass) names.push("low-pass (dspx)");
  if (flags.lavalinkLavalinkDspxPlugin?.highPass) names.push("high-pass (dspx)");
  if (flags.lavalinkLavalinkDspxPlugin?.normalization) names.push("normalization (dspx)");
  if (flags.lavalinkLavalinkDspxPlugin?.echo) names.push("echo (dspx)");
  if (flags.audioOutput && flags.audioOutput !== "stereo") {
    names.push(`audio output ${flags.audioOutput}`);
  }

  // timescale is only folded into a flag when nightcore/vaporwave were toggled,
  // so a plain setSpeed()/setPitch() has to be compared numerically.
  const timescale = manager.data?.timescale;
  if (timescale) {
    if (
      Number(timescale.speed) !== 1 ||
      Number(timescale.pitch) !== 1 ||
      Number(timescale.rate) !== 1
    ) {
      names.push("timescale");
    }
  }
  // The default filter data has no distortion entry at all, so its presence
  // means something set one.
  if (manager.data?.distortion) names.push("distortion");

  const bands = manager.equalizerBands;
  if (Array.isArray(bands)) {
    const active = bands.filter((band) => Number(band?.gain) !== 0).length;
    if (active) names.push(`equalizer (${active} band${active === 1 ? "" : "s"})`);
  }

  return names;
}

/**
 * True when any DSP filter is active. Filters force a PCM decode, so an active
 * filter always means the node re-encodes instead of forwarding Opus frames.
 */
function hasActiveFilters(player) {
  return activeFilterNames(player).length > 0;
}

/**
 * True when this player's audio reaches Discord bit-exact: Opus source, unity
 * volume and no filter. Anything else makes the node decode and re-encode,
 * which is what costs CPU and produces frame drops under load.
 */
function isPassthroughTrack(player, track) {
  if (!track?.info) return false;
  if (track.info.isStream) return false;
  if (hasActiveFilters(player)) return false;
  if (Number(player?.volume ?? 100) !== 100) return false;
  if (isMetadataOnlyTrack(track)) return false;
  return isOpusNativeTrack(track);
}

/**
 * True when a platform value is metadata-only, accepting either a Lavalink
 * source name ("spotify") or a search prefix ("spsearch").
 */
function isMetadataOnlyPlatform(value) {
  const normalized = String(value || "").toLowerCase().trim();
  if (!normalized) return false;
  if (METADATA_ONLY_SOURCES.has(normalized)) return true;
  if (METADATA_ONLY_SEARCH_PREFIXES.has(normalized)) return true;
  return METADATA_ONLY_SOURCES.has(normalized.replace(/search$/, ""));
}

/**
 * The platform playback should actually use.
 *
 * A metadata-only default (Spotify, Deezer, ...) either returns 30 second
 * previews or needs a second mirror lookup that lands on a re-encoded stream.
 * Neither is what a user asked for by typing a song name, so playback falls
 * back to YouTube Music (Opus) unless the operator explicitly opts in.
 *
 * @param {string} [configured] configured platform / search prefix
 * @returns {string} platform to search with
 */
function resolvePlaybackPlatform(configured = config.player.defaultSearchPlatform) {
  const value = String(configured || "").toLowerCase().trim();
  if (!value) return "spsearch";
  return value;
}

/**
 * Spotify/Deezer previews are exactly ~30s and are the classic "the bot plays
 * the wrong thing / cuts off after 30 seconds" symptom.
 */
function isPreviewTrack(track) {
  const duration = Number(track?.info?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return duration <= PREVIEW_MAX_DURATION_MS;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Pick the full-length candidate that best matches the original metadata.
 * Duration distance is the strongest signal (same song, same cut), title
 * similarity breaks ties. Previews and livestreams are never candidates.
 */
function pickNativeCandidate(tracks, reference) {
  const refDuration = Number(reference?.info?.duration) || 0;
  const refTitle = normalize(cleanTrackTitle(reference?.info?.title || ""));
  const refAuthor = normalize(reference?.info?.author || "");

  let best = null;
  let bestScore = Infinity;

  for (const candidate of tracks || []) {
    const info = candidate?.info;
    if (!info || info.isStream) continue;

    const duration = Number(info.duration) || 0;
    if (duration < MIN_REAL_TRACK_DURATION_MS) continue;

    let score = 0;

    if (refDuration >= MIN_REAL_TRACK_DURATION_MS) {
      score += (Math.abs(duration - refDuration) / refDuration) * 100;
    }

    const candidateTitle = normalize(cleanTrackTitle(info.title || ""));
    if (refTitle && candidateTitle) {
      if (candidateTitle === refTitle) score -= 25;
      else if (candidateTitle.startsWith(refTitle) || refTitle.startsWith(candidateTitle)) score -= 12;
    }

    const candidateAuthor = normalize(info.author || "");
    if (refAuthor && candidateAuthor && (candidateAuthor.includes(refAuthor) || refAuthor.includes(candidateAuthor))) {
      score -= 8;
    }

    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/**
 * Search a full-length Opus source for the reference track.
 * @returns {Promise<object|null>} best matching track or null
 */
async function resolveOpusMatch(player, reference, requester) {
  const title = cleanTrackTitle(reference?.info?.title || "");
  const author = reference?.info?.author || "";
  if (!title) return null;

  const queries = [
    `jssearch:${title} ${author}`.trim(),
    `jssearch:${title}`.trim(),
    `ytmsearch:${title} ${author}`.trim(),
    `scsearch:${title} ${author}`.trim(),
  ];

  for (const query of queries) {
    try {
      const res = await withTimeout(player.search({ query }, requester), UPGRADE_TIMEOUT_MS);
      const candidate = pickNativeCandidate(res?.tracks, reference);
      if (candidate) return candidate;
    } catch (err) {
      logger.debug(`[AudioQuality] "${query}" lookup failed: ${err.message}`);
    }
  }

  return null;
}

/**
 * Guarantee the track that actually reaches the queue is full length and, when
 * possible, Opus native. Returns the original track when no upgrade is needed
 * or when it cannot be done fast enough (never blocks playback indefinitely).
 *
 * @param {import("lavalink-client").Player} player
 * @param {object} track resolved Lavalink track
 * @param {unknown} requester
 */
async function ensureFullQualityTrack(player, track, requester) {
  if (!track?.info) return track;
  if (quality.preferOpusNativeSources === false) return track;
  if (!player?.search) return track;

  // Already Opus native (YouTube / YouTube Music / SoundCloud / HTTP) - nothing
  // to improve, and re-resolving would only add latency.
  if (!isMetadataOnlyTrack(track)) return track;

  const preview = isPreviewTrack(track);
  if (!preview && quality.upgradeMetadataOnlySources !== true) return track;

  const match = await resolveOpusMatch(player, track, requester);
  if (!match) {
    if (preview) {
      logger.warn(
        `[AudioQuality] "${track.info.title}" resolved to a ${Math.round((track.info.duration || 0) / 1000)}s preview and no full-length source was found. Check the node's Spotify/LavaSrc configuration.`
      );
    }
    return track;
  }

  match.requester = track.requester || requester || match.requester;
  match.mirroredFrom = {
    sourceName: track.info.sourceName,
    title: track.info.title,
    author: track.info.author,
  };

  logger.info(
    `[AudioQuality] ${preview ? "Preview replaced" : "Upgraded"} with full-length Opus source: "${match.info.title}" (${Math.round((match.info.duration || 0) / 1000)}s) instead of "${track.info.title}" (${Math.round((track.info.duration || 0) / 1000)}s, ${track.info.sourceName})`
  );

  return match;
}

/**
 * Upgrade a list of tracks (playlists/albums) the same way single tracks are
 * upgraded. Only previews are replaced by default, with bounded concurrency so
 * a large playlist cannot flood the node with searches or delay the first
 * track indefinitely.
 *
 * @param {import("lavalink-client").Player} player
 * @param {object[]} tracks
 * @param {unknown} requester
 * @param {{ max?: number, concurrency?: number }} [options]
 * @returns {Promise<object[]>}
 */
async function ensureFullQualityTracks(player, tracks, requester, options = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks || [];
  if (quality.preferOpusNativeSources === false) return tracks;

  const max = Number.isFinite(options.max) ? options.max : 20;
  const concurrency = Math.max(1, Number(options.concurrency) || 4);
  const result = tracks.slice();
  const targets = [];

  for (let i = 0; i < result.length && targets.length < max; i++) {
    const track = result[i];
    if (!track?.info || !isMetadataOnlyTrack(track)) continue;
    if (!isPreviewTrack(track) && quality.upgradeMetadataOnlySources !== true) continue;
    targets.push(i);
  }

  if (targets.length === 0) return result;

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const index = targets[cursor++];
      result[index] = await ensureFullQualityTrack(player, result[index], requester);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker())
  );

  return result;
}

module.exports = {
  OPUS_NATIVE_SOURCES,
  codecOf,
  isOpusNativeTrack,
  activeFilterNames,
  hasActiveFilters,
  isPassthroughTrack,
  METADATA_ONLY_SOURCES,
  METADATA_ONLY_SEARCH_PREFIXES,
  MIN_REAL_TRACK_DURATION_MS,
  resolvePlaybackPlatform,
  isMetadataOnlyPlatform,
  isMetadataOnlyTrack,
  isPreviewTrack,
  pickNativeCandidate,
  resolveOpusMatch,
  ensureFullQualityTrack,
  ensureFullQualityTracks,
};
