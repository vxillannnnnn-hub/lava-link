/**
 * Autoplay recommendation engine (Jockie / Eara behaviour)
 * ---------------------------------------------------------------------------
 * How the good bots actually keep music flowing:
 *   1. The seed is the track that just ended, never the queue head.
 *   2. The first strategy is the platform's own radio/related endpoint
 *      (YouTube Mix `list=RD<videoId>`), which is what Jockie and Eara use -
 *      it returns tracks in the same vibe instead of "songs with a similar title".
 *   3. The next recommendation is resolved *while the current track is still
 *      playing* and cached, so the hand-off has no silent gap.
 *   4. Everything is deduplicated against the queue and a rolling history, so
 *      the same song never loops back.
 *   5. Previews, livestreams and podcasts never enter autoplay.
 *
 * Playback itself is owned by lavalink-client: the manager's
 * `onEmptyQueue.autoPlayFunction` is the single entry point and adds a track to
 * the queue; the client then starts it. This module never fights the client for
 * ownership and never throws into it.
 */

const { cleanTrackTitle } = require("./sourceManager");
const config = require("../config");
const logger = require("./logger");

const PREVIEW_MAX_MS = config.player?.quality?.previewMaxDurationMs ?? 31000;
const MIN_TRACK_MS = Math.max(45000, PREVIEW_MAX_MS);
const MAX_TRACK_MS = 900000; // 15 minutes: skip podcasts / long mixes
const RESOLVE_TIMEOUT_MS = config.player?.autoplayTimeoutMs ?? 7000;

class AutoplayManager {
  constructor(maxHistoryPerGuild = 100) {
    this.maxHistoryPerGuild = maxHistoryPerGuild;
    // Map<guildId, { ids: Set<string>, titles: Set<string> }>
    this.guildHistories = new Map();
  }

  /**
   * Normalize title string for cross-platform comparison
   */
  normalizeTitle(title) {
    if (!title) return "";
    return cleanTrackTitle(title)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  /**
   * Record a track identifier and title to the guild's history buffer
   */
  recordTrackPlayed(guildId, identifier, title) {
    if (!guildId) return;

    let history = this.guildHistories.get(guildId);
    if (!history) {
      history = { ids: new Set(), titles: new Set() };
      this.guildHistories.set(guildId, history);
    }

    if (identifier) {
      history.ids.add(identifier);
      if (history.ids.size > this.maxHistoryPerGuild) {
        const oldestId = history.ids.values().next().value;
        if (oldestId) history.ids.delete(oldestId);
      }
    }

    if (title) {
      const norm = this.normalizeTitle(title);
      if (norm) {
        history.titles.add(norm);
        if (history.titles.size > this.maxHistoryPerGuild) {
          const oldestTitle = history.titles.values().next().value;
          if (oldestTitle) history.titles.delete(oldestTitle);
        }
      }
    }
  }

  /**
   * Check if track was played recently in this guild by ID or title
   */
  isAlreadyPlayed(guildId, identifier, title) {
    if (!guildId) return false;
    const history = this.guildHistories.get(guildId);
    if (!history) return false;

    if (identifier && history.ids.has(identifier)) return true;
    if (title) {
      const norm = this.normalizeTitle(title);
      if (norm && history.titles.has(norm)) return true;
    }

    return false;
  }

  /**
   * Clear guild autoplay history
   */
  clearHistory(guildId) {
    this.guildHistories.delete(guildId);
  }

  /**
   * Get guild history count
   */
  getHistorySize(guildId) {
    return this.guildHistories.get(guildId)?.ids?.size || 0;
  }

  /**
   * Pick the highest-affinity candidate that is not the current track, not
   * already queued, not in history, and not a preview / stream / podcast.
   *
   * @param {object[]} candidates
   * @param {string} guildId
   * @param {object} lastTrack
   * @param {import("lavalink-client").Player} player
   * @returns {object|null}
   */
  pickBestCandidate(candidates, guildId, lastTrack, player) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const currentId = lastTrack?.info?.identifier;
    const currentNorm = this.normalizeTitle(lastTrack?.info?.title);
    const queueIds = new Set(
      (player?.queue?.tracks || []).map((t) => t?.info?.identifier).filter(Boolean)
    );
    const seen = new Set();

    const usable = (info) => {
      if (!info?.identifier) return false;
      if (seen.has(info.identifier)) return false;
      seen.add(info.identifier);
      if (info.identifier === currentId) return false;

      const duration = Number(info.duration) || 0;
      if (info.isStream) return false;
      if (duration < MIN_TRACK_MS || duration > MAX_TRACK_MS) return false;

      if (queueIds.has(info.identifier)) return false;
      if (this.isAlreadyPlayed(guildId, info.identifier, info.title)) return false;
      return true;
    };

    // Strict pass: same song family, so `related` results that are the identical
    // song (different upload) are rejected.
    for (const track of candidates) {
      const info = track?.info;
      if (!usable(info)) continue;

      const candNorm = this.normalizeTitle(info.title);
      if (candNorm && currentNorm) {
        if (candNorm === currentNorm || candNorm.startsWith(currentNorm) || currentNorm.startsWith(candNorm)) {
          continue;
        }
      }
      return track;
    }

    // Relaxed pass: title matching already ran out, keep only the hard guards
    // (duration, duplicates, history) so autoplay still advances.
    for (const track of candidates) {
      const info = track?.info;
      if (!info?.identifier) continue;
      if (info.identifier === currentId || queueIds.has(info.identifier)) continue;
      if (this.isAlreadyPlayed(guildId, info.identifier, info.title)) continue;

      const duration = Number(info.duration) || 0;
      if (info.isStream || duration < MIN_TRACK_MS || duration > MAX_TRACK_MS) continue;
      return track;
    }

    return null;
  }

  /**
   * player.search with a hard timeout, so a slow/dead node can never stall the
   * queue hand-off.
   */
  async searchWithTimeout(player, query) {
    let timer;
    try {
      const searchPromise = player.search({ query }, player.queue?.current?.requester || null);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Autoplay lookup timed out after ${RESOLVE_TIMEOUT_MS}ms`)), RESOLVE_TIMEOUT_MS);
        if (timer.unref) timer.unref();
      });
      const res = await Promise.race([searchPromise, timeoutPromise]);
      return res?.tracks || [];
    } catch (err) {
      logger.debug(`[Autoplay] Search "${query}" failed: ${err?.message || err}`);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Resolve the next recommendation for a seed track.
   *
   * Stage 1: platform radio (YouTube Mix on the seed id) - Jockie/Eara behaviour.
   * Stage 2: related music search, run in parallel variants and merged.
   *
   * @returns {Promise<object|null>} stamped track ready to enqueue
   */
  async resolveRecommendation(player, lastTrack) {
    if (!player || typeof player.search !== "function" || !lastTrack?.info) return null;

    const guildId = player.guildId;
    const title = cleanTrackTitle(lastTrack.info.title || "");
    const author = lastTrack.info.author || "";
    const source = String(lastTrack.info.sourceName || "").toLowerCase();

    // ---- Stage 1: seed radio -------------------------------------------------
    try {
      let seedId = null;
      if (source === "youtube" && lastTrack.info.identifier) {
        seedId = lastTrack.info.identifier;
      } else if (title) {
        const lookup = await this.searchWithTimeout(player, `ytmsearch:${title} ${author}`.trim());
        seedId = lookup.find((t) => t?.info?.identifier)?.info?.identifier || null;
      }

      if (seedId) {
        const radio = await this.searchWithTimeout(
          player,
          `https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`
        );
        const picked = this.pickBestCandidate(radio, guildId, lastTrack, player);
        if (picked) {
          logger.debug(`[Autoplay] Resolved via seed radio: "${picked.info.title}"`);
          return this.stampTrack(picked, lastTrack, player);
        }
      }
    } catch (err) {
      logger.debug(`[Autoplay] Seed radio stage failed: ${err?.message || err}`);
    }

    // ---- Stage 2: related searches (parallel, merged) ------------------------
    if (!title) return null;

    const [musicRes, plainRes] = await Promise.allSettled([
      this.searchWithTimeout(player, `ytmsearch:${title} ${author} mix`.trim()),
      this.searchWithTimeout(player, `ytsearch:${title} ${author} song`.trim()),
    ]);

    const merged = [
      ...(musicRes.status === "fulfilled" ? musicRes.value : []),
      ...(plainRes.status === "fulfilled" ? plainRes.value : []),
    ];

    const picked = this.pickBestCandidate(merged, guildId, lastTrack, player);
    if (picked) {
      logger.debug(`[Autoplay] Resolved via related search: "${picked.info.title}"`);
      return this.stampTrack(picked, lastTrack, player);
    }

    return null;
  }

  /**
   * Mark a resolved track as an autoplay pick with full attribution.
   */
  stampTrack(track, lastTrack, player) {
    const clientUserId =
      player?.lavalink?.client?.user?.id || player?.client?.user?.id || "autoplay";

    track.requester = {
      id: clientUserId,
      username: "Autoplay",
      bot: true,
      displayAvatarURL: () => player?.lavalink?.client?.user?.displayAvatarURL?.() || undefined,
    };
    track.isAutoplay = true;
    track.seedTitle = lastTrack?.info?.title || "Music";
    return track;
  }

  /**
   * Resolve the next recommendation while the current track is still playing, so
   * the hand-off at the end of the track is gapless.
   *
   * @returns {Promise<object|null>} cached recommendation
   */
  async prefetchAutoplay(player, currentTrack) {
    if (!player || !currentTrack) return null;
    if (!Boolean(player.get("autoplay"))) return null;
    if (player.get("isAutoplayPrefetching")) return null;

    player.set("isAutoplayPrefetching", true);
    try {
      const recommendation = await this.resolveRecommendation(player, currentTrack);
      if (recommendation) {
        player.set("prefetchedAutoplayTrack", recommendation);
        logger.debug(
          `[Autoplay] Pre-buffered: "${recommendation.info.title}" (seed: "${currentTrack.info.title}")`
        );
      }
      return recommendation;
    } catch (err) {
      logger.debug(`[Autoplay] Prefetch failed in guild ${player.guildId}: ${err?.message || err}`);
      return null;
    } finally {
      player.set("isAutoplayPrefetching", false);
    }
  }

  /**
   * Single entry point used by the manager's onEmptyQueue hook, the /autoplay
   * command and the control panel button.
   *
   * Adds exactly one track to the queue. In hook mode the client starts it; in
   * manual mode this method starts playback itself when the player is idle.
   *
   * @param {import("lavalink-client").Player} player
   * @param {object|null} lastTrack seed track
   * @param {boolean} isAutoPlayHook true when invoked from lavalink-client
   * @returns {Promise<boolean>} whether a track was queued
   */
  async executeAutoplay(player, lastTrack, isAutoPlayHook = false) {
    if (!player) return false;
    if (!Boolean(player.get("autoplay"))) return false;
    if (player._autoplayRunning) return false;

    player._autoplayRunning = true;
    try {
      const seed = lastTrack || player.queue?.previous?.[0] || player.get("lastPlayedTrack");
      if (!seed?.info) {
        logger.warn(`[Autoplay] No seed track available for guild ${player.guildId}.`);
        return false;
      }

      let nextTrack = player.get("prefetchedAutoplayTrack") || null;
      player.set("prefetchedAutoplayTrack", null);

      // Drop a stale prefetch that was resolved for a different seed
      if (nextTrack && nextTrack.info?.identifier === seed.info?.identifier) nextTrack = null;

      if (!nextTrack) {
        nextTrack = await this.resolveRecommendation(player, seed);
      }

      if (!nextTrack) {
        logger.warn(`[Autoplay] Could not resolve a recommendation for guild ${player.guildId}.`);
        return false;
      }

      this.recordTrackPlayed(player.guildId, nextTrack.info?.identifier, nextTrack.info?.title);
      player.queue.add(nextTrack);
      player.set("autoplayHandledAt", Date.now());
      logger.info(
        `[Autoplay] Queued "${nextTrack.info.title}" by "${nextTrack.info.author}" in guild ${player.guildId} (seed: "${seed.info.title}")`
      );

      const voiceStatusManager = require("./voiceStatusManager");
      voiceStatusManager.onTrackStart(player.lavalink?.client, player, nextTrack);

      // Pre-resolve the *following* track now so the next hand-off is instant.
      this.prefetchAutoplay(player, nextTrack).catch(() => {});

      if (!isAutoPlayHook && !player.playing && !player.queue.current) {
        await player.play();
      }

      return true;
    } catch (err) {
      logger.warn(`[Autoplay] Failed in guild ${player.guildId}: ${err?.message || err}`);
      return false;
    } finally {
      player._autoplayRunning = false;
    }
  }
}

module.exports = new AutoplayManager();
