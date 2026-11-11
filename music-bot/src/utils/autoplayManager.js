/**
 * Recommendation engine (Jockie / Eara / Diva behaviour)
 * ---------------------------------------------------------------------------
 * What the big bots actually do when the queue runs out:
 *   - Jockie: `/autoplay toggle` queues *related* tracks, nothing more.
 *   - Eara: `/autoplay` keeps playing similar songs, and leans on Last.fm for
 *     the "similar" signal.
 *   - Diva: exposes `/addsimilarsongs [amount]` so the same engine can be used
 *     on demand, not only at queue end.
 *   - YouTube Music's radio builder ranks by familiarity vs discovery, so a
 *     station can be "same artist", "blend" or "new artists".
 *
 * This engine follows that shape instead of grabbing the first search result:
 *
 *   1. Resolve a *pool* of candidates (platform radio first, related searches
 *      as fallback) - not a single track. The pool is refilled in the background
 *      so the hand-off never waits on the network.
 *   2. Score every candidate: same artist / album affinity, position in the
 *      radio mix, artist-run avoidance (no three tracks by one artist in a row)
 *      and recently skipped artists (negative feedback).
 *   3. Pick weighted-random from the pool, so repeated sessions do not replay
 *      the same deterministic order.
 *   4. Modes: `radio` (default endless mix), `artist` (seed artist catalogue),
 *      `discover` (explicitly avoid the seed artist).
 *
 * Playback ownership stays with lavalink-client: the manager's
 * `onEmptyQueue.autoPlayFunction` is the only entry point that queues a track at
 * queue end, and this module never throws into it.
 */

const { cleanTrackTitle } = require("./sourceManager");
const config = require("../config");
const logger = require("./logger");

const PREVIEW_MAX_MS = config.player?.quality?.previewMaxDurationMs ?? 31000;
const MIN_TRACK_MS = Math.max(45000, PREVIEW_MAX_MS);
const MAX_TRACK_MS = 900000; // 15 minutes: skip podcasts / long mixes
const RESOLVE_TIMEOUT_MS = config.player?.autoplayTimeoutMs ?? 7000;
const listenerGuard = require("./listenerGuard");
const DISLIKE_TTL_MS = 30 * 60 * 1000;
const MAX_DISLIKED = 20;

/**
 * Mode weights. `radio` is YouTube-Music "blend", `artist` is a familiar
 * station, `discover` is the discovery end of the slider.
 */
const MODES = {
  radio: {
    label: "Radio",
    sameArtistWeight: 2.5,
    sameAlbumWeight: 1.0,
    lastfmWeight: 2.0,
    requireSeedArtist: false,
    avoidSeedArtist: false,
  },
  artist: {
    label: "Artist",
    sameArtistWeight: 6.0,
    sameAlbumWeight: 1.5,
    lastfmWeight: 0, // a seed-artist catalogue is not a similarity question
    requireSeedArtist: true,
    avoidSeedArtist: false,
  },
  discover: {
    label: "Discover",
    sameArtistWeight: -4.0,
    sameAlbumWeight: -1.0,
    // Similarity matters most here: it is what surfaces *other* artists.
    lastfmWeight: 2.5,
    requireSeedArtist: false,
    avoidSeedArtist: true,
  },
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Artist identity across platforms: "Artist - Topic", "ArtistVEVO" and
 * "Artist" must collapse to the same key or artist affinity never fires.
 */
function normalizeArtist(value) {
  return normalizeText(
    String(value || "")
      .replace(/\s*-\s*topic$/i, "")
      .replace(/\s*vevo$/i, "")
  );
}

/**
 * Human-readable artist name for a third-party API.
 * `normalizeArtist` strips everything non-alphanumeric, which is right for
 * comparing keys and wrong for a Last.fm query - it has to send "Daft Punk",
 * not "daftpunk".
 */
function cleanArtistName(value) {
  return String(value || "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

class AutoplayManager {
  constructor(maxHistoryPerGuild = 100) {
    this.maxHistoryPerGuild = maxHistoryPerGuild;
    // Map<guildId, { ids: Set<string>, titles: Set<string>, artists: Array<{ key, at }> }>
    this.guildHistories = new Map();
    // Map<guildId, Map<artistKey, dislikedAt>>
    this.dislikedArtists = new Map();
    // Map<"artist|title", { at: number, list: Array<{ name, artist, match }> }>
    this.similarCache = new Map();
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------

  getMode(player) {
    const value = String(player?.get?.("autoplayMode") || "radio").toLowerCase();
    return MODES[value] ? value : "radio";
  }

  setMode(player, mode) {
    const value = String(mode || "").toLowerCase();
    if (!MODES[value] || !player?.set) return false;

    player.set("autoplayMode", value);
    // A pool ranked for the old mode is wrong for the new one.
    player.set("autoplayPool", null);
    return true;
  }

  describeMode(mode) {
    return MODES[mode]?.label || MODES.radio.label;
  }

  // ---------------------------------------------------------------------------
  // History and feedback
  // ---------------------------------------------------------------------------

  normalizeTitle(title) {
    if (!title) return "";
    return normalizeText(cleanTrackTitle(title));
  }

  /**
   * Record a played track so it is never recommended again, and remember which
   * artists were played recently so runs can be avoided.
   */
  recordTrackPlayed(guildId, identifier, title, author) {
    if (!guildId) return;

    let history = this.guildHistories.get(guildId);
    if (!history) {
      history = { ids: new Set(), titles: new Set(), artists: [] };
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

    const artist = normalizeArtist(author);
    if (artist) {
      history.artists.push({ key: artist, at: Date.now() });
      if (history.artists.length > 20) history.artists.splice(0, history.artists.length - 20);
    }
  }

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
   * Most recent distinct artist keys, newest first.
   */
  recentArtists(guildId, limit = 3) {
    const history = this.guildHistories.get(guildId);
    if (!history?.artists?.length) return [];

    const seen = new Set();
    const out = [];
    for (let i = history.artists.length - 1; i >= 0 && out.length < limit; i--) {
      const key = history.artists[i].key;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  dislikeArtist(guildId, artistKey) {
    if (!guildId || !artistKey) return;

    let map = this.dislikedArtists.get(guildId);
    if (!map) {
      map = new Map();
      this.dislikedArtists.set(guildId, map);
    }

    map.set(artistKey, Date.now());
    if (map.size > MAX_DISLIKED) {
      const [oldestKey] = map.keys();
      map.delete(oldestKey);
    }
  }

  dislikedFor(guildId) {
    const map = this.dislikedArtists.get(guildId);
    if (!map) return [];

    const now = Date.now();
    const out = [];
    for (const [key, at] of map.entries()) {
      if (now - at > DISLIKE_TTL_MS) map.delete(key);
      else out.push(key);
    }
    if (map.size === 0) this.dislikedArtists.delete(guildId);
    return out;
  }

  clearHistory(guildId) {
    this.guildHistories.delete(guildId);
    this.dislikedArtists.delete(guildId);
  }

  getHistorySize(guildId) {
    return this.guildHistories.get(guildId)?.ids?.size || 0;
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  /**
   * Score one candidate for a seed track.
   *
   * @param {object} track Lavalink track
   * @param {{ seed: object, mode: string, recentArtists?: string[], disliked?: string[], position?: number, total?: number }} context
   * @returns {number} affinity score (higher is better, negative is bad)
   */
  scoreCandidate(track, context = {}) {
    const { seed, mode = "radio", recentArtists = [], disliked = [], position = 0, total = 1 } = context;
    const weights = MODES[mode] || MODES.radio;

    const artist = normalizeArtist(track?.info?.author);
    const seedArtist = normalizeArtist(seed?.info?.author);
    let score = 1;

    if (artist && seedArtist && artist === seedArtist) score += weights.sameArtistWeight;

    const album = normalizeText(track?.info?.albumName);
    const seedAlbum = normalizeText(seed?.info?.albumName);
    if (album && seedAlbum && album === seedAlbum) score += weights.sameAlbumWeight;

    // Last.fm's 0..1 match is a real "does this sound alike" signal, so it
    // outweighs a lucky position in the platform mix.
    const lastfmMatch = Number(track?.lastfmMatch);
    if (Number.isFinite(lastfmMatch) && lastfmMatch > 0) {
      score += lastfmMatch * (weights.lastfmWeight ?? 0);
    }

    // Avoid an artist run (three in a row) - but in `artist` mode the run is the
    // whole point, so the penalty is skipped there.
    if (mode !== "artist" && artist && recentArtists.includes(artist)) score -= 2.5;

    // Recently skipped artists sink to the bottom of the pool.
    if (artist && disliked.includes(artist)) score -= 4;

    // Earlier entries in the platform radio are stronger matches.
    score += (1 - position / Math.max(1, total)) * 0.5;

    return score;
  }

  /**
   * Filter raw search results down to playable, non-duplicate candidates for a
   * mode. Returns an array (the pool building block).
   */
  filterCandidates(candidates, guildId, seed, player, mode) {
    const out = [];
    const seen = new Set();
    const seedArtist = normalizeArtist(seed?.info?.author);
    const seedTitle = this.normalizeTitle(seed?.info?.title);
    const queueIds = new Set(
      (player?.queue?.tracks || []).map((t) => t?.info?.identifier).filter(Boolean)
    );
    const weights = MODES[mode] || MODES.radio;
    // A skipped artist is a hard "no". The old -4 score penalty was not enough:
    // `pickFromPool` floors every weight at 0.05, so a disliked artist could
    // still come back on the next hand-off.
    const disliked = this.dislikedFor(guildId);

    for (const track of candidates || []) {
      const info = track?.info;
      if (!info?.identifier || seen.has(info.identifier)) continue;
      seen.add(info.identifier);

      if (info.identifier === seed?.info?.identifier) continue;

      const duration = Number(info.duration) || 0;
      if (info.isStream) continue;
      if (duration < MIN_TRACK_MS || duration > MAX_TRACK_MS) continue;

      if (queueIds.has(info.identifier)) continue;
      if (this.isAlreadyPlayed(guildId, info.identifier, info.title)) continue;

      const artist = normalizeArtist(info.author);
      if (artist && disliked.includes(artist)) continue;
      if (weights.requireSeedArtist && seedArtist && artist !== seedArtist) continue;
      if (weights.avoidSeedArtist && seedArtist && artist === seedArtist) continue;

      const candidateTitle = this.normalizeTitle(info.title);
      if (
        candidateTitle &&
        seedTitle &&
        (candidateTitle === seedTitle ||
          candidateTitle.startsWith(seedTitle) ||
          seedTitle.startsWith(candidateTitle))
      ) {
        continue;
      }

      out.push(track);
    }

    return out;
  }

  /**
   * Backwards-compatible single pick (used by older call sites/tests).
   */
  pickBestCandidate(candidates, guildId, lastTrack, player, mode = "radio") {
    const filtered = this.filterCandidates(candidates, guildId, lastTrack, player, mode);
    return filtered[0] || null;
  }

  // ---------------------------------------------------------------------------
  // Resolution
  // ---------------------------------------------------------------------------

  async searchWithTimeout(player, query) {
    let timer;
    try {
      const searchPromise = player.search({ query }, player.queue?.current?.requester || null);
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Autoplay lookup timed out after ${RESOLVE_TIMEOUT_MS}ms`)),
          RESOLVE_TIMEOUT_MS
        );
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
   * YouTube mix URLs (`list=RD<id>`) only resolve when the seed is a real
   * YouTube video id.
   *
   * The previous code required `sourceName === "youtube"`, but the playback
   * platform is `ytmsearch`, whose sourceName is `"youtubemusic"` - so the
   * platform radio stage never ran for normal playback and every hand-off fell
   * through to text searches for `"<title> <artist> mix"`. That is exactly why
   * recommendations felt random: they were search results, not a radio.
   */
  extractYouTubeId(track) {
    const info = track?.info;
    if (!info?.identifier) return null;
    const source = String(info.sourceName || "").toLowerCase();
    if (source !== "youtube" && source !== "youtubemusic" && source !== "youtube-music") return null;
    return /^[A-Za-z0-9_-]{11}$/.test(info.identifier) ? info.identifier : null;
  }

  // ---------------------------------------------------------------------------
  // Last.fm similarity layer
  // ---------------------------------------------------------------------------

  isLastfmEnabled() {
    return Boolean(config.lastfm?.enabled && config.lastfm?.apiKey) && typeof fetch === "function";
  }

  describeSignal() {
    return this.isLastfmEnabled() ? "Last.fm similarity + YouTube radio" : "YouTube radio";
  }

  /**
   * `track.getSimilar` for a seed track. Cached per seed so a 12-track pool only
   * costs one API call, and a re-used seed costs none.
   *
   * @returns {Promise<Array<{ name: string, artist: string, match: number }>>}
   */
  async fetchSimilarFromLastfm(seed) {
    const apiKey = config.lastfm?.apiKey;
    if (!this.isLastfmEnabled() || !seed?.info) return [];

    const artist = cleanArtistName(seed.info.author);
    const title = cleanTrackTitle(seed.info.title || "") || String(seed.info.title || "");
    if (!artist || !title) return [];

    const cacheKey = `${normalizeText(artist)}|${this.normalizeTitle(title)}`;
    const ttl = Number(config.lastfm.cacheTtlMs) || 600000;
    const cached = this.similarCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttl) return cached.list;

    let url;
    try {
      url = new URL(String(config.lastfm.baseUrl));
    } catch (err) {
      logger.debug(`[Autoplay] Invalid LASTFM_BASE_URL: ${err?.message || err}`);
      return [];
    }
    url.searchParams.set("method", "track.getsimilar");
    url.searchParams.set("artist", artist);
    url.searchParams.set("track", title);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("autocorrect", "1");
    url.searchParams.set("limit", String(Math.min(50, Math.max(1, Number(config.lastfm.limit) || 20))));

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), Number(config.lastfm.timeoutMs) || 4000)
      : null;
    if (timer?.unref) timer.unref();

    try {
      const res = await fetch(url, {
        signal: controller?.signal,
        headers: { "user-agent": "pulse-music-bot" },
      });
      if (!res.ok) {
        logger.debug(`[Autoplay] Last.fm responded ${res.status} for "${title}" by "${artist}".`);
        return [];
      }

      const json = await res.json();
      const list = (json?.similartracks?.track || [])
        .map((entry) => ({
          name: String(entry?.name || "").trim(),
          artist: String(entry?.artist?.name || entry?.artist?.["#text"] || "").trim(),
          match: Number(entry?.match) || 0,
        }))
        .filter((entry) => entry.name && entry.artist);

      this.similarCache.set(cacheKey, { at: Date.now(), list });
      if (this.similarCache.size > 200) {
        this.similarCache.delete(this.similarCache.keys().next().value);
      }
      return list;
    } catch (err) {
      logger.debug(`[Autoplay] Last.fm lookup failed: ${err?.message || err}`);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Turn Last.fm's `{name, artist}` entries into playable tracks. Sources are
   * searched in parallel and a same-artist hit is preferred, because the top
   * YouTube result for "song artist" is often a cover or a lyric video.
   */
  async resolveLastfmTracks(player, entries, limit) {
    const picks = [];
    const seen = new Set();
    for (const entry of entries || []) {
      const key = `${normalizeArtist(entry.artist)}|${this.normalizeTitle(entry.name)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      picks.push(entry);
      if (picks.length >= limit) break;
    }
    if (!picks.length) return [];

    const results = await Promise.allSettled(
      picks.map(async (entry) => {
        const tracks = await this.searchWithTimeout(player, `ytmsearch:${entry.name} ${entry.artist}`.trim());
        const seedArtist = normalizeArtist(entry.artist);
        return (
          tracks.find((track) => normalizeArtist(track?.info?.author) === seedArtist) ||
          tracks[0] ||
          null
        );
      })
    );

    return results
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
  }

  /**
   * Build a ranked pool of recommendations for a seed track.
   *
   * @param {import("lavalink-client").Player} player
   * @param {object} seed
   * @param {{ mode?: string, size?: number, kind?: "autoplay"|"similar" }} [options]
   * @returns {Promise<object[]>} stamped, ranked tracks
   */
  async buildPool(player, seed, options = {}) {
    if (!player || typeof player.search !== "function" || !seed?.info) return [];

    const mode = options.mode || this.getMode(player);
    const size = Math.max(1, Number(options.size) || Number(config.player.autoplayPoolSize) || 12);
    const kind = options.kind === "similar" ? "similar" : "autoplay";
    const title = cleanTrackTitle(seed.info.title || "");
    const author = seed.info.author || "";
    const raw = [];

    // Stage 1: the platform's own radio. This is what Jockie/Eara are really
    // playing - a mix seeded from the track, not "songs with a similar title".
    if (mode === "radio") {
      try {
        let seedId = this.extractYouTubeId(seed);
        if (!seedId && title) {
          // Metadata-only seeds (Spotify/Deezer/...) carry no YouTube id: find
          // the same song on YouTube Music first so the mix is seeded with the
          // right video rather than an arbitrary search hit.
          const lookup = await this.searchWithTimeout(player, `ytmsearch:${title} ${author}`.trim());
          const sameArtist = lookup.find(
            (t) => this.extractYouTubeId(t) && normalizeArtist(t.info.author) === normalizeArtist(author)
          );
          seedId =
            this.extractYouTubeId(sameArtist) ||
            lookup.map((t) => this.extractYouTubeId(t)).find(Boolean) ||
            null;
        }

        if (seedId) {
          raw.push(
            ...(await this.searchWithTimeout(
              player,
              `https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`
            ))
          );
        }
      } catch (err) {
        logger.debug(`[Autoplay] Radio stage failed: ${err?.message || err}`);
      }
    }

    // Stage 1.5: Last.fm similarity. Returns *other* artists that genuinely
    // sound alike - the signal the platform radio rarely surfaces and the only
    // real one for `discover`. Off unless LASTFM_API_KEY is configured, and
    // always a fast no-op when it is not (one cached call per seed otherwise).
    let lastfmMatches = new Map();
    if (this.isLastfmEnabled() && mode !== "artist" && title) {
      try {
        const similar = await this.fetchSimilarFromLastfm(seed);
        if (similar.length) {
          lastfmMatches = new Map(
            similar.map((entry) => [this.normalizeTitle(entry.name), entry.match])
          );
          raw.push(
            ...(await this.resolveLastfmTracks(player, similar, Number(config.lastfm.maxResolve) || 6))
          );
        }
      } catch (err) {
        logger.debug(`[Autoplay] Last.fm stage failed: ${err?.message || err}`);
      }
    }

    // Stage 2: related searches (and the whole strategy for `artist`/`discover`).
    // No "mix"/"song" suffixes: appending those biased results towards
    // compilations, covers and lyric videos instead of related tracks.
    if (raw.length < size && title) {
      const queries =
        mode === "artist"
          ? [`ytmsearch:${author} mix`.trim(), `ytmsearch:${author} songs`.trim()]
          : [`ytmsearch:${title} ${author}`.trim(), `ytmsearch:${author} radio`.trim()];

      const results = await Promise.allSettled(queries.map((q) => this.searchWithTimeout(player, q)));
      for (const result of results) {
        if (result.status === "fulfilled") raw.push(...result.value);
      }
    }

    const filtered = this.filterCandidates(raw, player.guildId, seed, player, mode);

    // Fold the Last.fm match onto every surviving candidate by title, not by
    // identifier: the same song can arrive from the radio and from Last.fm, and
    // whichever object survived the dedupe must still carry the signal.
    if (lastfmMatches.size) {
      for (const track of filtered) {
        const match = lastfmMatches.get(this.normalizeTitle(track?.info?.title));
        if (match) track.lastfmMatch = match;
      }
    }

    const artistCooldown = Number(config.player.autoplayArtistCooldown) || 2;
    const recentArtists = this.recentArtists(player.guildId, artistCooldown).filter(
      (artist) => artist !== normalizeArtist(author)
    );
    const disliked = this.dislikedFor(player.guildId);

    const scored = filtered.map((track, index) => ({
      track,
      score: this.scoreCandidate(track, {
        seed,
        mode,
        recentArtists,
        disliked,
        position: index,
        total: filtered.length,
      }),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Diversity cap: without it a radio mix that is mostly one artist produced a
    // pool of that one artist, and weighted-random picking turned autoplay into
    // an artist shuffle. `artist` mode is deliberately exempt (a run of the seed
    // artist is the whole point there).
    const maxPerArtist = mode === "artist" ? Number.POSITIVE_INFINITY : 2;
    const perArtist = new Map();
    const chosen = [];
    for (const entry of scored) {
      const artist = normalizeArtist(entry.track?.info?.author);
      const count = perArtist.get(artist) || 0;
      if (artist && count >= maxPerArtist) continue;
      if (artist) perArtist.set(artist, count + 1);
      chosen.push(entry.track);
      if (chosen.length >= size) break;
    }

    return chosen.map((track) => this.stampTrack(track, seed, player, kind));
  }

  /**
   * Backwards-compatible single recommendation.
   */
  async resolveRecommendation(player, lastTrack) {
    const pool = await this.buildPool(player, lastTrack);
    return pool[0] || null;
  }

  /**
   * Weighted-random pick from a pool, re-checking the queue and history at
   * consume time so a track queued by a user in the meantime is not duplicated.
   */
  pickFromPool(pool, player, seed, mode = "radio") {
    const seedArtist = normalizeArtist(seed?.info?.author);
    const queueIds = new Set(
      (player?.queue?.tracks || []).map((t) => t?.info?.identifier).filter(Boolean)
    );
    const artistCooldown = Number(config.player.autoplayArtistCooldown) || 2;
    const recentArtists = this.recentArtists(player.guildId, artistCooldown).filter((a) => a !== seedArtist);
    const disliked = this.dislikedFor(player.guildId);
    const weights = MODES[mode] || MODES.radio;

    const usable = (pool || []).filter((track) => {
      const info = track?.info;
      if (!info?.identifier) return false;
      if (info.identifier === seed?.info?.identifier) return false;
      if (queueIds.has(info.identifier)) return false;
      if (this.isAlreadyPlayed(player.guildId, info.identifier, info.title)) return false;

      const artist = normalizeArtist(info.author);
      if (weights.requireSeedArtist && seedArtist && artist !== seedArtist) return false;
      if (weights.avoidSeedArtist && seedArtist && artist === seedArtist) return false;
      return true;
    });

    if (!usable.length) return null;

    const scores = usable.map((track, index) =>
      Math.max(
        0.05,
        this.scoreCandidate(track, {
          seed,
          mode,
          recentArtists,
          disliked,
          position: index,
          total: usable.length,
        })
      )
    );
    const total = scores.reduce((sum, score) => sum + score, 0);

    let roll = Math.random() * total;
    for (let i = 0; i < usable.length; i++) {
      roll -= scores[i];
      if (roll <= 0) return usable[i];
    }
    return usable[usable.length - 1];
  }

  /**
   * Mark a resolved track with full attribution.
   *
   * @param {object} track
   * @param {object} seed
   * @param {import("lavalink-client").Player} player
   * @param {"autoplay"|"similar"} kind
   */
  stampTrack(track, seed, player, kind = "autoplay") {
    const client = listenerGuard.resolveClient(player);
    const clientUserId =
      client?.user?.id ||
      player?.LavalinkManager?.options?.client?.id ||
      player?.lavalink?.client?.user?.id ||
      "autoplay";

    track.requester = {
      id: clientUserId,
      username: kind === "similar" ? "Similar" : "Autoplay",
      bot: true,
      displayAvatarURL: () => client?.user?.displayAvatarURL?.() || undefined,
    };
    track.isAutoplay = kind === "autoplay";
    track.isSimilar = kind === "similar";
    track.seedTitle = seed?.info?.title || "Music";
    return track;
  }

  // ---------------------------------------------------------------------------
  // Prefetch / consume
  // ---------------------------------------------------------------------------

  getPoolSize(player) {
    const state = player?.get?.("autoplayPool");
    return state?.tracks?.length || 0;
  }

  /**
   * Resolve the next pool while the current track is still playing, so the
   * hand-off at the end of the track is gapless.
   */
  async prefetchAutoplay(player, currentTrack, client) {
    if (!player || !currentTrack) return null;
    if (!Boolean(player.get("autoplay"))) return null;
    if (player.get("isAutoplayPrefetching")) return null;
    // Nobody is listening: do not spend searches (and do not warm a pool the
    // hand-off is going to refuse anyway). This applies to 24/7 too - it keeps
    // the session and queue alive, but an empty channel gets no lookups.
    if (listenerGuard.isAlone(player, client)) return null;

    player.set("isAutoplayPrefetching", true);
    try {
      const mode = this.getMode(player);
      const pool = await this.buildPool(player, currentTrack, { mode });
      if (pool.length) {
        player.set("autoplayPool", {
          seedIdentifier: currentTrack.info?.identifier || null,
          mode,
          createdAt: Date.now(),
          tracks: pool,
        });
        logger.debug(
          `[Autoplay] Pool ready: ${pool.length} candidate(s) for "${currentTrack.info.title}" (${mode})`
        );
      }
      return pool;
    } catch (err) {
      logger.debug(`[Autoplay] Prefetch failed in guild ${player.guildId}: ${err?.message || err}`);
      return null;
    } finally {
      player.set("isAutoplayPrefetching", false);
    }
  }

  /**
   * On-demand recommendations for `/similar`.
   */
  async buildRecommendations(player, seed, options = {}) {
    const amount = Math.max(1, Math.min(10, Number(options.amount) || 5));
    const pool = await this.buildPool(player, seed, {
      mode: options.mode || this.getMode(player),
      kind: "similar",
      size: amount,
    });
    return pool.slice(0, amount);
  }

  /**
   * Single entry point used by the manager's onEmptyQueue hook, the `/autoplay`
   * command and the control panel button.
   *
   * Adds exactly one track from the ranked pool. In hook mode the client starts
   * it; in manual mode this method starts playback itself when the player is idle.
   *
   * @param {import("lavalink-client").Player} player
   * @param {object} lastTrack
   * @param {boolean} [isAutoPlayHook]
   * @param {import("discord.js").Client} [client] used for the empty-channel check
   */
  async executeAutoplay(player, lastTrack, isAutoPlayHook = false, client = null) {
    if (!player) return false;
    if (!Boolean(player.get("autoplay"))) return false;
    if (player._autoplayRunning) return false;

    // Never generate a recommendation for an empty room. This was the real
    // source of endless playback: no voiceStateUpdate fires for a channel that
    // was already empty (restart, boot while alone), so the autoplay hook kept
    // refilling the queue forever with nobody listening. 24/7 is no exception -
    // it keeps the session and queue, but nothing is queued or streamed until
    // somebody joins.
    if (listenerGuard.isAlone(player, client)) {
      logger.debug(
        `[Autoplay] Skipped recommendation for guild ${player.guildId}: voice channel has no listeners.`
      );
      return false;
    }

    player._autoplayRunning = true;
    try {
      const seed = lastTrack || player.queue?.previous?.[0] || player.get("lastPlayedTrack");
      if (!seed?.info) {
        logger.warn(`[Autoplay] No seed track available for guild ${player.guildId}.`);
        return false;
      }

      const mode = this.getMode(player);
      const poolState = player.get("autoplayPool");
      const poolFresh =
        poolState &&
        Array.isArray(poolState.tracks) &&
        poolState.tracks.length > 0 &&
        poolState.seedIdentifier === (seed.info.identifier || null) &&
        poolState.mode === mode &&
        Date.now() - (poolState.createdAt || 0) < (Number(config.player.autoplayPoolTtlMs) || 900000);

      let pool = poolFresh ? poolState.tracks : [];
      let nextTrack = this.pickFromPool(pool, player, seed, mode);

      if (!nextTrack) {
        pool = await this.buildPool(player, seed, { mode });
        nextTrack = this.pickFromPool(pool, player, seed, mode);
      }

      if (!nextTrack) {
        logger.warn(`[Autoplay] Could not resolve a recommendation for guild ${player.guildId}.`);
        return false;
      }

      const remaining = pool.filter((track) => track.info?.identifier !== nextTrack.info.identifier);
      player.set("autoplayPool", {
        seedIdentifier: seed.info.identifier || null,
        mode,
        createdAt: Date.now(),
        tracks: remaining,
      });
      player.set("autoplayHandledAt", Date.now());

      this.recordTrackPlayed(player.guildId, nextTrack.info?.identifier, nextTrack.info?.title, nextTrack.info?.author);
      player.queue.add(nextTrack);
      logger.info(
        `[Autoplay/${mode}] Queued "${nextTrack.info.title}" by "${nextTrack.info.author}" in guild ${player.guildId} (seed: "${seed.info.title}", ${remaining.length} left in pool)`
      );

      const voiceStatusManager = require("./voiceStatusManager");
      voiceStatusManager.onTrackStart(player.lavalink?.client, player, nextTrack);

      // Keep the pool topped up for the track that is about to start.
      if (remaining.length < 3) this.prefetchAutoplay(player, nextTrack, client).catch(() => {});

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

  /**
   * Negative feedback: an autoplay track skipped inside its first
   * `autoplaySkipPercent` percent (or 45s, whichever is shorter) is treated as
   * a miss. That artist is dropped from recommendations for 30 minutes and the
   * rest of the pool is discarded so the station pivots instead of replaying
   * the same corner of it.
   *
   * @returns {{ skipped: boolean, elapsedMs: number }|null}
   */
  recordOutcome(player, track, client) {
    const startedAt = Number(player?.get?.("autoplayTrackStartedAt")) || 0;
    if (!track?.isAutoplay || !startedAt) return null;

    // A guard suspension (empty channel) or an auto-pause ends the track without
    // anyone rejecting it - that must never blacklist the artist.
    if (player.get?.("autoPaused") || player.get?.(listenerGuard.SUSPEND_KEY)) {
      player.set("autoplayTrackStartedAt", null);
      return null;
    }

    player.set("autoplayTrackStartedAt", null);
    const elapsedMs = Date.now() - startedAt;
    const duration = Number(track.info?.duration) || 0;
    const percent = Number(config.player.autoplaySkipPercent) || 25;
    const threshold = Math.min(45000, duration * (percent / 100));

    if (elapsedMs >= threshold) return { skipped: false, elapsedMs };

    const artist = normalizeArtist(track.info?.author);
    if (artist) this.dislikeArtist(player.guildId, artist);
    player.set("autoplayPool", null);

    logger.info(
      `[Autoplay] Early skip after ${Math.round(elapsedMs / 1000)}s - dropping ` +
        `"${track.info?.author || "unknown artist"}" from recommendations for 30 minutes.`
    );
    return { skipped: true, elapsedMs };
  }
}

module.exports = new AutoplayManager();
module.exports.MODES = MODES;
module.exports.normalizeArtist = normalizeArtist;
