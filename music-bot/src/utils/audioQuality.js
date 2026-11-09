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

function isMetadataOnlyTrack(track) {
  return METADATA_ONLY_SOURCES.has(sourceOf(track));
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

  const queries = [`ytmsearch:${title} ${author}`.trim(), `ytsearch:${title} ${author} audio`.trim()];

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

module.exports = {
  METADATA_ONLY_SOURCES,
  METADATA_ONLY_SEARCH_PREFIXES,
  MIN_REAL_TRACK_DURATION_MS,
  isMetadataOnlyPlatform,
  isMetadataOnlyTrack,
  isPreviewTrack,
  pickNativeCandidate,
  resolveOpusMatch,
  ensureFullQualityTrack,
};
