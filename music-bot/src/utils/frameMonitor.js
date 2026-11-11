/**
 * Per-player frame-deficit logging + load correlation
 * ---------------------------------------------------------------------------
 * Lavalink's `frameStats` (sent / nulled / deficit) are cumulative and *per
 * node* - there is no per-player counter anywhere in the protocol. That is why
 * "it stutters sometimes" is normally guesswork: the bot looks healthy, the
 * node's ping looks fine, and the audible gaps are invisible.
 *
 * This monitor samples the node counters on an interval, converts them to
 * deltas, and attributes each bad window to the players that were actually
 * streaming in it. Track windows are recorded too, so a dropout can be matched
 * to the song that was playing at the time.
 *
 * On top of that it records node CPU, player count and - crucially - how many
 * of those players are *transcoding* (volume != 100, an active filter, a
 * non-Opus source or a livestream). Every window is then correlated against
 * those three signals, so a dropout can be attributed to transcode load, CPU
 * starvation or neither (route/jitter) instead of being guessed at.
 *
 * A deficit means the node failed to produce/send the expected 20ms audio
 * frames. Nothing in the bot process can cause or fix that, so every log line
 * says so explicitly and points at the node.
 */

const config = require("../config");
const logger = require("./logger");
const audioQuality = require("./audioQuality");

// One Opus frame is 20ms of audio.
const FRAME_MS = 20;
// Total silence in a track window that a listener will actually notice. Two
// frames over a four-minute track is measurement noise, not a defect.
const AUDIBLE_SILENCE_MS = 100;
// How many raw samples to retain for on-demand summaries.
const MAX_HISTORY = 240;

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function fmtR(value) {
  return value === null || value === undefined ? "n/a" : value.toFixed(2);
}

/**
 * Pull `frameStats` out of a node, a stats payload or a REST /v4/stats body.
 * @returns {{ sent: number, nulled: number, deficit: number }|null}
 */
function readFrameStats(source) {
  const stats = source?.frameStats || source?.stats?.frameStats || null;
  if (!stats) return null;
  return {
    sent: num(stats.sent),
    nulled: num(stats.nulled),
    deficit: num(stats.deficit),
  };
}

/**
 * Cumulative counters -> window delta. Returns null when the counter moved
 * backwards, which means the node restarted and the caller needs a new baseline.
 */
function diffFrames(previous, next) {
  if (!previous || !next) return null;
  if (next.sent < previous.sent || next.deficit < previous.deficit) return null;

  return {
    sent: next.sent - previous.sent,
    nulled: next.nulled >= previous.nulled ? next.nulled - previous.nulled : 0,
    deficit: next.deficit - previous.deficit,
  };
}

/**
 * Classify a window delta: dropped frames, drop rate and whether it is audible.
 *
 * @param {{sent:number,nulled:number,deficit:number}} previous
 * @param {{sent:number,nulled:number,deficit:number}} next
 * @param {{ warnFrames?: number, warnRatePercent?: number }} [options]
 */
function classifyFrameDelta(previous, next, options = {}) {
  const delta = diffFrames(previous, next);
  if (!delta) return null;

  // `deficit` is frames the node never sent; `nulled` is frames it sent as
  // silence because no audio was ready. Both are silence reaching the listener,
  // and under DAVE the nulled counter is the one that actually moves.
  const silentFrames = delta.deficit + delta.nulled;
  const total = delta.sent + delta.deficit;
  const ratePercent = total > 0 ? (silentFrames / total) * 100 : 0;
  const warnFrames = Number.isFinite(options.warnFrames)
    ? options.warnFrames
    : config.audio.frameWarnDeficitFrames;
  const warnRatePercent = Number.isFinite(options.warnRatePercent)
    ? options.warnRatePercent
    : config.audio.frameWarnRatePercent;

  return {
    ...delta,
    silentFrames,
    ratePercent,
    silenceMs: silentFrames * FRAME_MS,
    // Two independent signals: enough absolute frames of silence, or a high
    // silence rate in a low-traffic window. Either one is audible.
    healthy: silentFrames < warnFrames && ratePercent < warnRatePercent,
  };
}

/**
 * Short human summary of a window delta.
 */
function describeFrameDelta(delta, windowSeconds) {
  const window = Number.isFinite(windowSeconds) ? `${windowSeconds}s window` : "window";
  if (!delta) return "no frame data";
  if (delta.deficit === 0 && delta.nulled === 0) return `${window} clean (${delta.sent} frames sent)`;

  return (
    `${delta.deficit} frame(s) (~${delta.silenceMs}ms of silence) in the ${window} • ` +
    `${delta.sent} sent • ${delta.ratePercent.toFixed(1)}% drop rate`
  );
}

/**
 * Players that were streaming during a window, with the track each one had and
 * whether that track is on the bit-exact Opus path (i.e. not transcoding).
 */
function activePlayerSummaries(client) {
  const players = client?.lavalink?.players;
  const list = players instanceof Map ? [...players.values()] : Array.isArray(players) ? players : [];

  return list
    .filter((player) => player?.playing)
    .map((player) => {
      const track = player.queue?.current || null;
      return {
        guildId: player.guildId,
        title: track?.info?.title || null,
        passthrough: audioQuality.isPassthroughTrack(player, track),
      };
    });
}

/**
 * One-line attribution suffix: which guilds/tracks were affected.
 */
function describePlayers(players) {
  if (!players.length) return "no active players";
  return players
    .slice(0, 6)
    .map((p) => `guild ${p.guildId}${p.title ? ` ("${p.title}")` : ""}`)
    .join(", ")
    .concat(players.length > 6 ? ` +${players.length - 6} more` : "");
}

function describeCpu(stats) {
  const cpu = stats?.cpu;
  if (!cpu) return "CPU unknown";
  return (
    `CPU ${pct(nullableNum(cpu.lavalinkLoad))} lavalink / ${pct(nullableNum(cpu.systemLoad))} system` +
    (cpu.cores ? ` • ${cpu.cores} cores` : "")
  );
}

/**
 * Pearson correlation over [x, y] pairs. Returns null when the data cannot
 * support a conclusion (too few points, or a constant series).
 */
function pearson(pairs, minimum = 3) {
  const valid = (pairs || []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (valid.length < minimum) return null;

  const n = valid.length;
  const meanX = valid.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = valid.reduce((sum, [, y]) => sum + y, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of valid) {
    const dx = x - meanX;
    const dy = y - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function average(values) {
  const valid = (values || []).filter((v) => Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function strength(r) {
  if (r === null || !Number.isFinite(r)) return "no signal";
  const magnitude = Math.abs(r);
  if (magnitude >= 0.5) return "strong";
  if (magnitude >= 0.3) return "moderate";
  return "weak";
}

/**
 * Turn a correlation report into a plain-language conclusion.
 */
function describeVerdict(report) {
  if (!report.windows) return "No samples collected yet.";
  if (report.deficitWindows === 0) return "No dropped frames in this window - nothing to attribute.";
  if (!report.hasEnoughSamples) {
    return `Only ${report.windows} sampled window(s); need ${report.minSamples} before correlating.`;
  }

  const { transcode, cpu, players } = report;
  const transcodeDetail =
    report.avgDeficitWithTranscoding !== null && report.avgDeficitWithoutTranscoding !== null
      ? ` Dropped frames average ${report.avgDeficitWithTranscoding.toFixed(1)} per window with transcoding vs ` +
        `${report.avgDeficitWithoutTranscoding.toFixed(1)} without.`
      : "";

  if (transcode !== null && transcode >= 0.3) {
    return (
      `Dropped frames rise with transcoding players (r=${fmtR(transcode)}, ${strength(transcode)}).${transcodeDetail} ` +
      `Transcoding is the likely driver - keep playback on Opus sources at volume 100% and drop live DSP.`
    );
  }
  // Player count before CPU: concurrency is the cause and CPU is its symptom,
  // so blaming CPU here would recommend more cores for a capacity problem.
  if (players !== null && players >= 0.3 && (cpu === null || players >= cpu)) {
    return (
      `Dropped frames rise with the number of playing players (r=${fmtR(players)})` +
      (cpu !== null && cpu >= 0.3 ? `, and with the CPU that load causes (r=${fmtR(cpu)})` : "") +
      `, while transcoding does not lead - this is a node-wide capacity limit, not per-track cost.`
    );
  }
  if (cpu !== null && cpu >= 0.3) {
    return (
      `Dropped frames rise with node CPU (r=${fmtR(cpu)}, ${strength(cpu)}; avg ${pct(report.avgCpu)}, ` +
      `peak ${pct(report.maxCpu)}) while player count and transcoding do not lead. The node is CPU-starved.`
    );
  }
  if (report.avgCpu !== null && report.avgCpu >= 0.7) {
    return (
      `Node CPU averages ${pct(report.avgCpu)} but drops do not track load linearly - suspect GC pauses or a ` +
      `throttled vCPU rather than steady load.`
    );
  }
  return (
    `Drops track neither CPU, player count nor transcoding - the node's route to Discord ` +
    `(jitter / packet loss) is the remaining suspect.`
  );
}

/**
 * Summarise sampled windows: coefficients plus a verdict.
 *
 * @param {Array<object>} samples
 * @param {{ minSamples?: number }} [options]
 */
function summarizeSamples(samples, options = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const minSamples = Number.isFinite(options.minSamples)
    ? options.minSamples
    : config.audio.correlationMinSamples;

  const withTranscoding = list.filter((s) => num(s.transcoding) > 0);
  const withoutTranscoding = list.filter((s) => s.transcoding !== null && num(s.transcoding) === 0);

  const report = {
    windows: list.length,
    deficitWindows: list.filter((s) => num(s.deficit) > 0).length,
    transcode: pearson(list.map((s) => [nullableNum(s.transcoding), num(s.deficit)])),
    cpu: pearson(list.map((s) => [nullableNum(s.lavalinkLoad), num(s.deficit)])),
    players: pearson(list.map((s) => [nullableNum(s.playing), num(s.deficit)])),
    avgCpu: average(list.map((s) => nullableNum(s.lavalinkLoad))),
    maxCpu: list.reduce((max, s) => {
      const value = nullableNum(s.lavalinkLoad);
      return value === null ? max : Math.max(max, value);
    }, null),
    avgDeficitWithTranscoding: average(withTranscoding.map((s) => num(s.deficit))),
    avgDeficitWithoutTranscoding: average(withoutTranscoding.map((s) => num(s.deficit))),
    totalDeficit: list.reduce((sum, s) => sum + num(s.deficit), 0),
    minSamples,
  };

  report.hasEnoughSamples = report.windows >= minSamples;
  report.verdict = describeVerdict(report);
  return report;
}

/**
 * Everything that forces this player onto the decode -> re-encode path, in the
 * order a listener would fix them. Each reason carries the single action that
 * removes it, so the verdict never has to guess at a fix.
 *
 * @param {import("lavalink-client").Player} player
 * @param {object|null} track
 * @returns {Array<{ key: string, label: string, fix: string }>}
 */
function transcodeReasons(player, track) {
  const reasons = [];
  if (!track?.info) return reasons;

  const volume = Number(player?.volume ?? 100);
  if (volume !== 100) {
    reasons.push({
      key: "volume",
      label: `volume ${volume}% instead of unity`,
      fix: "Set the volume to 100% with `/volume 100`. Every other value makes the node decode and re-encode the whole track - a second lossy generation, and the CPU work that drops frames.",
    });
  }

  if (audioQuality.hasActiveFilters(player)) {
    reasons.push({
      key: "filter",
      label: "an active DSP filter",
      fix: "Reset the filters with `/filter reset`. DSP needs decoded PCM, so it always re-encodes - check the clean path before blaming the node.",
    });
  }

  if (track.info.isStream) {
    reasons.push({
      key: "stream",
      label: "a livestream (no Opus packets to forward)",
      fix: "Nothing to fix for a livestream: it can only be encoded live, so its quality is capped by the source bitrate.",
    });
  } else if (audioQuality.isMetadataOnlyTrack(track)) {
    reasons.push({
      key: "mirror",
      label: `${track.info.sourceName || "a metadata-only provider"} mirror audio`,
      fix: "Play the song through the default YouTube Music source (`/play`), which hands the node real Opus packets instead of a re-encoded mirror.",
    });
  } else if (!audioQuality.isOpusNativeTrack(track)) {
    reasons.push({
      key: "codec",
      label: `${track.info.codec || track.info.sourceName || "a non-Opus"} source`,
      fix: `Use an Opus source for this track (YouTube Music / SoundCloud). The node is receiving ${track.info.codec || "a non-Opus codec"} and has to transcode it.`,
    });
  }

  return reasons;
}

/**
 * Choose the one action worth taking, by what actually costs frames.
 *
 * Priority: our own transcode (volume, then filters) -> the source's codec ->
 * node CPU -> the node-wide transcode count -> the node's route to Discord.
 * A list of four suspects is not actionable, so exactly one fix comes back.
 *
 * @param {{ audible: boolean, passthrough: boolean, reasons?: object[], nodeCpu?: number|null, ourPlayingPlayers?: number, ourTranscodingPlayers?: number, correlation?: number|null }} context
 * @returns {{ severity: "healthy"|"warning"|"critical", fix: string|null }}
 */
function recommendFix(context) {
  const {
    audible,
    passthrough,
    reasons = [],
    nodeCpu = null,
    ourPlayingPlayers = 0,
    ourTranscodingPlayers = 0,
    correlation = null,
  } = context;

  // Clean window: only suggest something if the path itself is lossy.
  if (!audible) {
    if (passthrough) return { severity: "healthy", fix: null };
    const cause = reasons.find((reason) => reason.key !== "stream");
    return { severity: "healthy", fix: cause ? cause.fix : null };
  }

  // Audible dropouts: fix our own doing first, it is free and immediate.
  const selfInflicted = reasons.find((reason) => reason.key === "volume" || reason.key === "filter");
  if (selfInflicted) return { severity: "critical", fix: selfInflicted.fix };

  const sourceIssue = reasons.find((reason) => reason.key === "mirror" || reason.key === "codec");
  if (sourceIssue) return { severity: "warning", fix: sourceIssue.fix };

  if (nodeCpu !== null && nodeCpu >= 0.7) {
    const correlated =
      correlation !== null && correlation >= 0.3
        ? `, and the sampled windows agree (drops rise with CPU, r=${correlation.toFixed(2)})`
        : "";
    return {
      severity: "critical",
      fix: `The node is CPU-starved (Lavalink CPU ${(nodeCpu * 100).toFixed(0)}%)${correlated}. Give it more cores or move guilds off it before changing anything else.`,
    };
  }

  if (ourTranscodingPlayers > 0) {
    return {
      severity: "warning",
      fix: `${ourTranscodingPlayers} of our ${Math.max(ourPlayingPlayers, ourTranscodingPlayers)} playing players are transcoding; that is the cheapest load to remove - set those guilds to 100% volume with no filters.`,
    };
  }

  // The DAVE send path encrypts on the JVM thread instead of draining the
  // pre-filled NAS buffer, so a periodic 100-400ms stall shows up as a sustained
  // packet rate well under 50/s per player, with no CPU pressure and nothing
  // transcoding (lavalink-devs/Lavalink#1222). No buffer setting can mask it.
  const fps = Number(context.framesPerSecondPerPlayer);
  if (Number.isFinite(fps) && fps >= 25 && fps < 46) {
    return {
      severity: "critical",
      fix:
        `The node is sending ~${fps.toFixed(0)} frames/s per player instead of 50, in bursts, while its CPU is fine and nothing is transcoding. ` +
        "That is the DAVE send-path stall (lavalink-devs/Lavalink#1222): frames are encrypted on the JVM thread rather than drained from the NAS buffer, so no `bufferDurationMs` value hides it. " +
        "Run a Lavalink build whose koe/libdave carries the fix (upstream `dev` after #1234) - this is a node build problem, not a bot setting.",
    };
  }

  return {
    severity: "warning",
    fix: "Nothing on the bot side is transcoding, so the gaps are the node's route to Discord (or the koe 3.0.0 DAVE stall): run the patched Lavalink build configured in application.yml and host the node in the voice region.",
  };
}

class FrameMonitor {
  constructor() {
    // Map<nodeId, { node, client, prev, latest, timer, busy, history }>
    this.states = new Map();
  }

  /**
   * Latest sampled counters for a node (fresher than node.stats' 60s push).
   */
  latest(nodeOrId) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id;
    return id ? this.states.get(id)?.latest || null : null;
  }

  /**
   * Full sample history for a node (most recent last).
   */
  history(nodeOrId) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id;
    return id ? [...(this.states.get(id)?.history || [])] : [];
  }

  /**
   * Correlation summary for the configured window, for on-demand reporting.
   */
  summarize(nodeOrId) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?.id;
    const state = id ? this.states.get(id) : null;
    if (!state) return null;

    const window = Math.max(10, num(config.audio.correlationWindowSamples) || 60);
    return summarizeSamples(state.history.slice(-window));
  }

  /**
   * Start sampling a node. Replaces any existing sampler for the same node.
   */
  start(client, node) {
    if (!node?.id) return false;
    this.stop(node.id);

    const state = {
      node,
      client,
      prev: null,
      latest: readFrameStats(node),
      timer: null,
      busy: false,
      history: [],
      lastSample: null,
      lastCorrelationLogAt: 0,
    };
    this.states.set(node.id, state);

    const interval = Math.max(1000, num(config.audio.frameLogIntervalMs) || 15000);
    state.timer = setInterval(() => {
      void this.sample(node.id);
    }, interval);
    if (state.timer.unref) state.timer.unref();

    // Baseline immediately so the first real window is already meaningful.
    void this.sample(node.id, { prime: true });
    logger.debug(`[FrameMonitor] Sampling node "${node.id}" every ${Math.round(interval / 1000)}s`);
    return true;
  }

  stop(nodeId) {
    const state = this.states.get(nodeId);
    if (!state) return;
    if (state.timer) clearInterval(state.timer);
    this.states.delete(nodeId);
  }

  stopAll() {
    for (const nodeId of [...this.states.keys()]) this.stop(nodeId);
  }

  /**
   * Read counters and load: prefer a live REST fetch (also gives CPU and player
   * counts), fall back to the pushed stats.
   */
  async readNode(node) {
    if (typeof node?.fetchStats === "function") {
      try {
        const stats = await node.fetchStats();
        const frames = readFrameStats(stats);
        if (frames) return { frames, stats };
      } catch (err) {
        logger.debug(`[FrameMonitor] fetchStats failed for "${node?.id}": ${err?.message || err}`);
      }
    }

    const stats = node?.stats || null;
    return { frames: readFrameStats(stats), stats };
  }

  /**
   * Frames only, for callers that just need counters.
   */
  async read(node) {
    const { frames } = await this.readNode(node);
    return frames;
  }

  /**
   * Measure jitter on demand: two fresh counter reads `windowMs` apart, turned
   * into per-second rates.
   *
   * `/ping` needs this because the pushed `node.stats` object can be a minute
   * old - useless for "is it crackling right now?", and a lifetime counter
   * cannot show a periodic stall at all. `sent` is what the node actually put
   * on the wire; `deficit` is 20ms slots it missed; `nulled` is slots it filled
   * with silence. A healthy node sends 50 frames/s per playing player.
   *
   * @param {import("lavalink-client").LavalinkNode} node
   * @param {{ windowMs?: number }} [options]
   */
  async sampleLiveJitter(node, { windowMs = 2000 } = {}) {
    const window = Math.min(Math.max(num(windowMs) || 2000, 500), 10000);

    const before = await this.readNode(node);
    if (!before.frames) return { available: false, reason: "no frame counters from the node" };

    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, window));
    const after = await this.readNode(node);
    const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);

    const delta = diffFrames(before.frames, after.frames);
    if (!delta) return { available: false, reason: "frame counters reset while sampling" };

    const playing = Math.max(0, num(after.stats?.playingPlayers ?? before.stats?.playingPlayers));
    const expectedPerSecond = playing * (1000 / FRAME_MS);
    const sentPerSecond = delta.sent / elapsedSeconds;
    const droppedPerSecond = delta.deficit / elapsedSeconds;
    const nulledPerSecond = delta.nulled / elapsedSeconds;

    const total = delta.sent + delta.deficit;
    const silentFrames = delta.deficit + delta.nulled;
    const silenceRatePercent = total > 0 ? (silentFrames / total) * 100 : 0;
    const warnFrames = num(config.audio.frameWarnDeficitFrames) || 2;
    const warnRate = num(config.audio.frameWarnRatePercent) || 1;
    const healthy = silentFrames < warnFrames && silenceRatePercent < warnRate;

    // Delivered share of the 50/s-per-player budget. The DAVE send-path stall
    // (lavalink-devs/Lavalink#1222) shows up as a sustained ~0.75, in bursts.
    const deliveryRatio = expectedPerSecond > 0 ? sentPerSecond / expectedPerSecond : null;
    const framesPerSecondPerPlayer = playing > 0 ? sentPerSecond / playing : null;
    const daveSignature = Boolean(
      playing > 0 && deliveryRatio !== null && deliveryRatio >= 0.6 && deliveryRatio < 0.92
    );

    let verdict;
    if (playing === 0) {
      verdict = "idle: no players on the node";
    } else if (silentFrames === 0 && healthy) {
      verdict = `clean: no frames lost or padded in ${elapsedSeconds.toFixed(1)}s`;
    } else if (daveSignature) {
      verdict =
        `DAVE send-path pattern: ${framesPerSecondPerPlayer.toFixed(0)} frames/s per player instead of 50 ` +
        "(lavalink-devs/Lavalink#1222)";
    } else if (!healthy) {
      verdict =
        `audible gaps: ${silentFrames} frame(s) of silence (~${silentFrames * FRAME_MS}ms) in ` +
        `${elapsedSeconds.toFixed(1)}s`;
    } else {
      verdict = `${silentFrames} frame(s) of silence in ${elapsedSeconds.toFixed(1)}s - below the audible threshold`;
    }

    return {
      available: true,
      windowMs: Math.round(elapsedSeconds * 1000),
      playing,
      expectedPerSecond,
      sentPerSecond,
      droppedPerSecond,
      nulledPerSecond,
      framesPerSecondPerPlayer,
      deliveryRatio,
      silentFrames,
      silenceRatePercent,
      healthy,
      daveSignature,
      verdict,
    };
  }

  /**
   * Sample once and log the window. Returns the delta (null when there is no
   * usable baseline, e.g. first sample or a node restart).
   */
  async sample(nodeId, { prime = false } = {}) {
    const state = this.states.get(nodeId);
    if (!state || state.busy) return null;

    state.busy = true;
    try {
      const { frames, stats } = await this.readNode(state.node);
      if (!frames) return null;

      const previous = state.prev;
      state.prev = frames;
      state.latest = frames;

      if (prime || !previous) return null;

      const delta = classifyFrameDelta(previous, frames);
      if (!delta) return null;

      this.record(state, delta, stats);
      this.report(state, delta, stats);
      return delta;
    } finally {
      state.busy = false;
    }
  }

  /**
   * Persist one sampled window with the load metrics it should be correlated
   * against.
   */
  record(state, delta, stats) {
    const players = activePlayerSummaries(state.client);
    const nodePlaying = nullableNum(stats?.playingPlayers);

    const sample = {
      at: Date.now(),
      sent: delta.sent,
      nulled: delta.nulled,
      deficit: delta.deficit,
      ratePercent: delta.ratePercent,
      lavalinkLoad: nullableNum(stats?.cpu?.lavalinkLoad),
      systemLoad: nullableNum(stats?.cpu?.systemLoad),
      // Node-wide count when the node reports it, otherwise what we can see.
      playing: nodePlaying !== null ? nodePlaying : players.length,
      // Only our own players can be inspected for transcode state, so this is
      // null when no player of ours is streaming.
      transcoding: players.length ? players.filter((p) => !p.passthrough).length : null,
    };

    state.history.push(sample);
    if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
    state.lastSample = sample;
    return sample;
  }

  report(state, delta, stats) {
    const windowSeconds = Math.max(1, Math.round((num(config.audio.frameLogIntervalMs) || 15000) / 1000));
    const players = activePlayerSummaries(state.client);

    if (delta.deficit === 0) {
      if (config.audio.frameLogCleanSamples) {
        logger.debug(
          `[FrameMonitor] Node "${state.node.id}" ${describeFrameDelta(delta, windowSeconds)} • ${players.length} playing`
        );
      }
      return;
    }

    const transcoding = players.filter((p) => !p.passthrough).length;
    const load =
      `${players.length} playing` +
      (players.length ? ` (${transcoding} transcoding)` : "") +
      ` • ${describeCpu(stats)}`;

    const line =
      `[FrameMonitor] Node "${state.node.id}" dropped ${describeFrameDelta(delta, windowSeconds)} → ` +
      `node-side encode/send path, not the bot. Load: ${load}. Affected: ${describePlayers(players)}`;

    if (delta.healthy) logger.info(line);
    else logger.warn(line);

    this.logCorrelation(state);
  }

  /**
   * Emit the load correlation when deficits keep happening, throttled so it
   * does not become noise.
   */
  logCorrelation(state) {
    const now = Date.now();
    const every = Math.max(5000, num(config.audio.correlationLogIntervalMs) || 60000);
    if (now - (state.lastCorrelationLogAt || 0) < every) return null;

    const window = Math.max(10, num(config.audio.correlationWindowSamples) || 60);
    const summary = summarizeSamples(state.history.slice(-window));
    if (!summary.hasEnoughSamples || summary.deficitWindows === 0) return null;

    state.lastCorrelationLogAt = now;
    logger.info(
      `[FrameMonitor] Correlation over ${summary.windows} windows: ` +
        `deficit↔transcoding r=${fmtR(summary.transcode)} (${strength(summary.transcode)}), ` +
        `deficit↔CPU r=${fmtR(summary.cpu)} (${strength(summary.cpu)}), ` +
        `deficit↔players r=${fmtR(summary.players)} (${strength(summary.players)}) → ${summary.verdict}`
    );
    return summary;
  }

  /**
   * Record the counters at the start of a track, so the track's own window can
   * be attributed when it ends.
   *
   * Reads the live counters rather than the last interval sample: a 15s-stale
   * baseline would let dropouts from the previous track leak into this one.
   */
  async beginTrack(player, track) {
    const live = await this.read(player?.node);
    const stats = live || this.latest(player?.node?.id) || readFrameStats(player?.node);
    if (!stats) return false;

    player.set("frameBaseline", stats);
    player.set("frameBaselineAt", Date.now());
    if (track) player.set("frameBaselineTitle", track.info?.title || null);
    return true;
  }

  /**
   * Log what the node dropped while this track was playing.
   *
   * The counter is node-wide: it covers every player on that node, so the line
   * reports how many others were streaming alongside this guild.
   */
  endTrack(player, track, client) {
    const baseline = player.get("frameBaseline");
    if (!baseline) return null;

    const stats = this.latest(player?.node?.id) || readFrameStats(player?.node);
    const startedAt = player.get("frameBaselineAt") || Date.now();
    player.set("frameBaseline", null);

    if (!stats) return null;

    const delta = diffFrames(baseline, stats);
    if (!delta) return null;

    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const title = track?.info?.title || player.get("frameBaselineTitle") || "unknown track";
    const transcoding = audioQuality.isPassthroughTrack(player, track)
      ? "passthrough"
      : "transcoded";

    if (delta.deficit === 0) {
      logger.debug(
        `[FrameMonitor] Guild ${player.guildId} "${title}" ran ${seconds}s with 0 dropped frames (${transcoding})`
      );
      return delta;
    }

    const others = activePlayerSummaries(client).filter((p) => String(p.guildId) !== String(player.guildId));
    logger.warn(
      `[FrameMonitor] Guild ${player.guildId} "${title}" ran ${seconds}s (${transcoding}) while the node dropped ` +
        `${delta.deficit} frame(s) (~${delta.deficit * FRAME_MS}ms of silence). Node-wide counter shared with ` +
        `${others.length ? describePlayers(others) : "no other players"}. ${describeCpu(player?.node?.stats)}`
    );
    return delta;
  }

  /**
   * Live verdict for one guild.
   *
   * Unlike the node-wide correlation report, this judges the playback the user
   * is actually listening to: the frames the node dropped while *this* track
   * played, compared against the node's CPU, how many of our players are
   * transcoding and this player's own volume. The node frame counter is
   * node-wide, so the numbers are labelled as such rather than pretending to be
   * per-track in isolation.
   *
   * @param {import("lavalink-client").Player} player
   * @param {import("discord.js").Client} [client]
   */
  async guildVerdict(player, client = player?.lavalink?.client) {
    const track = player?.queue?.current || null;
    const node = player?.node || null;
    const volume = Number(player?.volume ?? 100);

    // Fresh counters when the node answers (one REST call), sampled ones when not.
    const read = node ? await this.readNode(node) : { frames: null, stats: null };
    const liveFrames = read.frames || this.latest(node);

    const nodeCpu = nullableNum(read.stats?.cpu?.lavalinkLoad) ?? nullableNum(node?.stats?.cpu?.lavalinkLoad);
    const systemCpu = nullableNum(read.stats?.cpu?.systemLoad) ?? nullableNum(node?.stats?.cpu?.systemLoad);
    const cores = nullableNum(read.stats?.cpu?.cores) ?? nullableNum(node?.stats?.cpu?.cores);
    const playingPlayers = nullableNum(read.stats?.playingPlayers) ?? nullableNum(node?.stats?.playingPlayers);

    const ours = activePlayerSummaries(client);
    const passthrough = audioQuality.isPassthroughTrack(player, track);
    const reasons = transcodeReasons(player, track);
    const summary = node ? this.summarize(node) : null;

    const base = {
      available: false,
      severity: "unknown",
      verdict: "",
      fix: null,
      windowSeconds: 0,
      sentFrames: 0,
      droppedFrames: 0,
      silenceMs: 0,
      dropRatePercent: 0,
      audible: false,
      nodeCpu,
      systemCpu,
      cores,
      playingPlayers,
      ourPlayingPlayers: ours.length,
      ourTranscodingPlayers: ours.filter((p) => !p.passthrough).length,
      passthrough,
      transcodeReasons: reasons.map((reason) => reason.label),
      volume,
      correlation: summary?.hasEnoughSamples ? summary.cpu : null,
    };

    if (!track) {
      return {
        ...base,
        verdict: "No track is playing, so there is nothing to measure. Start one with `/play`.",
      };
    }

    // baseline is recorded at trackStart and cleared at trackEnd, so this is
    // exactly the window the listener has heard so far.
    const delta = diffFrames(player.get("frameBaseline"), liveFrames);
    if (!delta) {
      return {
        ...base,
        verdict: "Frame counters are not baselined yet - the verdict appears a few seconds into the track.",
      };
    }

    const startedAt = Number(player.get("frameBaselineAt")) || Date.now();
    const windowSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const total = delta.sent + delta.deficit;
    // deficit = frames never sent, nulled = frames sent as silence. Both are
    // audible gaps; the DAVE stall mostly moves `nulled`.
    const silentFrames = delta.deficit + delta.nulled;
    const dropRatePercent = total > 0 ? (silentFrames / total) * 100 : 0;
    const silenceMs = silentFrames * FRAME_MS;
    const warnRate = num(config.audio.frameWarnRatePercent) || 1;
    const audible = silenceMs >= AUDIBLE_SILENCE_MS || dropRatePercent >= warnRate;

    const cpuText = nodeCpu === null ? "unknown" : `${(nodeCpu * 100).toFixed(0)}%`;
    const labels = reasons.map((reason) => reason.label).join(", ");

    const silenceDetail =
      delta.nulled > 0
        ? `${delta.deficit} dropped + ${delta.nulled} nulled frame(s)`
        : `${delta.deficit} dropped frame(s)`;

    const verdict = audible
      ? `${silenceDetail} (~${silenceMs} ms of silence) in ${windowSeconds}s while the node ran at ${cpuText} CPU, ${base.ourTranscodingPlayers}/${base.ourPlayingPlayers} of our players were transcoding and volume was ${volume}%.`
      : passthrough
        ? `No audible dropouts in ${windowSeconds}s (${delta.deficit} dropped, ${delta.nulled} nulled, ${dropRatePercent.toFixed(1)}%) and this track is on the bit-exact Opus path.`
        : `No audible dropouts in ${windowSeconds}s, but this track is being re-encoded (${labels}).`;

    // Frames per second per player: 50 is the expected rate for a 20ms frame.
    // A sustained rate in the high 20s-40s is the DAVE stall signature.
    const playersOnNode = Math.max(
      1,
      Number(playingPlayers) || Number(base.ourPlayingPlayers) || 1
    );
    const framesPerSecondPerPlayer =
      windowSeconds > 0 ? delta.sent / windowSeconds / playersOnNode : null;

    const { severity, fix } = recommendFix({
      audible,
      passthrough,
      reasons,
      nodeCpu,
      ourPlayingPlayers: base.ourPlayingPlayers,
      ourTranscodingPlayers: base.ourTranscodingPlayers,
      correlation: base.correlation,
      framesPerSecondPerPlayer,
    });

    return {
      ...base,
      available: true,
      windowSeconds,
      sentFrames: delta.sent,
      droppedFrames: delta.deficit,
      nulledFrames: delta.nulled,
      silentFrames,
      framesPerSecondPerPlayer,
      silenceMs,
      dropRatePercent,
      audible,
      severity,
      verdict,
      fix,
    };
  }
}

module.exports = new FrameMonitor();
module.exports.FrameMonitor = FrameMonitor;
module.exports.readFrameStats = readFrameStats;
module.exports.diffFrames = diffFrames;
module.exports.classifyFrameDelta = classifyFrameDelta;
module.exports.describeFrameDelta = describeFrameDelta;
module.exports.activePlayerSummaries = activePlayerSummaries;
module.exports.pearson = pearson;
module.exports.summarizeSamples = summarizeSamples;
module.exports.describeVerdict = describeVerdict;
module.exports.transcodeReasons = transcodeReasons;
module.exports.recommendFix = recommendFix;
