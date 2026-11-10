const { PermissionFlagsBits, ChannelType } = require("discord.js");
const logger = require("./logger");
const config = require("../config");

// Discord's hard ceiling, whatever the guild tier is.
const MAX_DISCORD_BITRATE = 384000;
// Stage channels reject anything above 64kbps (API error 50035).
const STAGE_MAX_BITRATE = 64000;
const ABSOLUTE_MIN_BITRATE = 8000;
// One Opus frame is 20ms, so the counters are a silence estimate.
const FRAME_MS = 20;
const DOWNSHIFT_WINDOW_MS = 3600000;

function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function isVoiceBased(channel) {
  return (
    channel?.type === ChannelType.GuildVoice ||
    channel?.type === ChannelType.GuildStageVoice
  );
}

function frameCounters(frames) {
  const read = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  return { sent: read(frames?.sent), nulled: read(frames?.nulled), deficit: read(frames?.deficit) };
}

/**
 * Delta between the counters recorded at trackStart and the node's live ones.
 * A node restart resets the counters, so a negative delta is discarded rather
 * than reported as a huge deficit.
 */
function diffFrames(baseline, next) {
  if (!baseline || !next) return null;
  const before = frameCounters(baseline);
  const after = frameCounters(next);
  if (after.sent < before.sent || after.deficit < before.deficit) return null;
  return {
    sent: after.sent - before.sent,
    deficit: after.deficit - before.deficit,
    nulled: after.nulled - before.nulled,
  };
}

/**
 * Adaptive Voice Channel Bitrate Governor
 * ---------------------------------------------------------------------------
 * Discord caps a channel's bitrate by guild tier (96k / 128k / 256k / 384k) but
 * never applies the ceiling for you - a boosted channel sits at 64kbps until
 * somebody edits it. Most Lavalink bots therefore never use the quality the
 * server has already paid for, and the ones that do only ever raise it once,
 * so an admin edit or a boost-tier drop silently leaves the channel throttled.
 *
 * This module owns the whole lifecycle:
 *
 *   raise    -> set the channel to min(tier ceiling, configured max), verified
 *               against what Discord actually stored
 *   reconcile-> a periodic tick repairs drift (admin edit, tier change, a
 *               channel that was recreated mid-session)
 *   adapt    -> when audio is arriving incomplete while the node has CPU to
 *               spare and is not transcoding, drop one step; climb back after a
 *               run of clean windows. Hysteresis + a downshift budget stop it
 *               from oscillating, and every attempt is cooldown-gated so a
 *               rejected edit can never become one REST call per track.
 *
 * Honest scope: the bitrate cap is what Discord will accept from the stream.
 * Raising it is what lets a transcoded track (Spotify mirror, MP3 source, filter
 * active) keep its detail, and lowering it relieves a saturated link. It cannot
 * fix a starved node - for Opus passthrough the node forwards the source's
 * packets untouched, so channel bitrate is not the limiting factor there.
 */
class VoiceBitrateManager {
  constructor() {
    // Map<guildId, state>
    this.state = new Map();
    this.timer = null;
    this.ticking = false;
  }

  settings() {
    const raw = config.voiceBitrate || {};
    return {
      enabled: raw.enabled !== false,
      max: clampInt(raw.max, ABSOLUTE_MIN_BITRATE, MAX_DISCORD_BITRATE, MAX_DISCORD_BITRATE),
      min: clampInt(raw.min, ABSOLUTE_MIN_BITRATE, MAX_DISCORD_BITRATE, 64000),
      stepDown: clampInt(raw.stepDown, ABSOLUTE_MIN_BITRATE, 128000, 64000),
      tickMs: clampInt(raw.tickMs, 5000, 300000, 15000),
      retryCooldownMs: clampInt(raw.retryCooldownMs, 30000, 3600000, 300000),
      adaptCooldownMs: clampInt(raw.adaptCooldownMs, 60000, 3600000, 300000),
      healthyWindowsForUp: clampInt(raw.healthyWindowsForUp, 2, 40, 4),
      maxDownshiftsPerHour: clampInt(raw.maxDownshiftsPerHour, 0, 20, 2),
      audibleSilenceMs: clampInt(raw.audibleSilenceMs, 20, 5000, 100),
    };
  }

  stateFor(guildId) {
    let state = this.state.get(guildId);
    if (!state) {
      state = {
        channelId: null,
        offset: 0,
        actual: null,
        target: null,
        lastAttemptAt: 0,
        lastSuccessAt: 0,
        lastAdaptAt: 0,
        lastHealth: null,
        downshifts: [],
        healthyWindows: 0,
        failures: 0,
        lastError: null,
      };
      this.state.set(guildId, state);
    }
    return state;
  }

  /** The highest bitrate this channel could ever accept. */
  tierCeiling(channel) {
    const guildMax = Number(channel?.guild?.maximumBitrate) || MAX_DISCORD_BITRATE;
    const ceiling = Math.min(guildMax, MAX_DISCORD_BITRATE);
    return channel?.type === ChannelType.GuildStageVoice
      ? Math.min(ceiling, STAGE_MAX_BITRATE)
      : ceiling;
  }

  /** What the channel should be at right now, including any adaptive offset. */
  targetBitrate(channel) {
    const cfg = this.settings();
    const ceiling = Math.min(this.tierCeiling(channel), cfg.max);
    const floor = Math.min(cfg.min, ceiling);
    const offset = Math.max(0, Number(this.state.get(channel?.guild?.id)?.offset) || 0);
    return Math.max(Math.min(ceiling - offset, ceiling), floor);
  }

  /**
   * Bring one channel to its target bitrate.
   * @param {import("discord.js").VoiceChannel|import("discord.js").StageChannel} channel
   * @param {import("discord.js").Client} client
   * @param {{ reason?: string, force?: boolean }} [options]
   */
  async ensure(channel, client, { reason = "reconcile", force = false } = {}) {
    const cfg = this.settings();
    if (!cfg.enabled) return null;
    if (!isVoiceBased(channel) || !channel.guild) return null;

    const guild = channel.guild;
    const state = this.stateFor(guild.id);
    const now = Date.now();
    const target = this.targetBitrate(channel);
    const actual = Number(channel.bitrate) || 0;

    state.channelId = channel.id;
    state.target = target;
    state.actual = actual;

    if (actual === target) {
      state.lastError = null;
      state.lastSuccessAt = state.lastSuccessAt || now;
      return { changed: false, applied: actual, target, reason };
    }

    // Claim the attempt window before the REST call: a rejection (permissions,
    // tier clamp) would otherwise retry on every track start.
    if (!force && now - state.lastAttemptAt < cfg.retryCooldownMs) {
      return { changed: false, applied: actual, target, reason: "cooldown" };
    }
    state.lastAttemptAt = now;

    try {
      const me = guild.members?.me || (await guild.members?.fetchMe?.().catch(() => null));
      if (!me) {
        state.lastError = "bot member unavailable";
        return { changed: false, applied: actual, target, reason: "no-member" };
      }

      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
        state.lastError = "missing Manage Channels";
        logger.debug(
          `[Bitrate] Cannot set #${channel.name} in "${guild.name}": missing Manage Channels.`
        );
        return { changed: false, applied: actual, target, reason: "no-permission" };
      }

      const updated = await channel.setBitrate(target, reason);
      const applied = Number(updated?.bitrate) || target;
      state.actual = applied;
      state.lastSuccessAt = now;
      state.failures = 0;
      state.lastError =
        applied === target ? null : `Discord clamped to ${Math.round(applied / 1000)}kbps`;

      if (applied !== actual) {
        logger.info(
          `[Bitrate] #${channel.name} in "${guild.name}": ${Math.round(actual / 1000)}kbps -> ` +
            `${Math.round(applied / 1000)}kbps (ceiling ${Math.round(this.tierCeiling(channel) / 1000)}kbps, ${reason})`
        );
      } else if (applied !== target) {
        logger.debug(
          `[Bitrate] #${channel.name}: Discord kept ${Math.round(applied / 1000)}kbps ` +
            `(target ${Math.round(target / 1000)}kbps).`
        );
      }

      return { changed: applied !== actual, applied, target, reason };
    } catch (err) {
      state.failures += 1;
      state.lastError = err?.message || String(err);
      logger.debug(`[Bitrate] Update failed for #${channel?.name || channel?.id}: ${state.lastError}`);
      return { changed: false, applied: actual, target, reason: "error", error: state.lastError };
    }
  }

  /**
   * Health of the current playback window, without any extra REST call.
   * @param {import("lavalink-client").Player} player
   */
  readHealth(player) {
    const cfg = this.settings();
    const node = player?.node;
    const delta = diffFrames(player?.get?.("frameBaseline"), node?.stats?.frameStats);
    const load = Number(node?.stats?.cpu?.lavalinkLoad);
    const nodeCpu = Number.isFinite(load) ? load : null;

    if (!delta) {
      return { measured: false, audible: false, nodeCpu, transcoding: null, deficitFrames: 0, silenceMs: 0, dropRate: 0 };
    }

    const silenceMs = delta.deficit * FRAME_MS;
    const total = delta.sent + delta.deficit;
    const dropRate = total > 0 ? (delta.deficit / total) * 100 : 0;

    let transcoding = null;
    try {
      const audioQuality = require("./audioQuality");
      transcoding = audioQuality.isPassthroughTrack(player, player.queue?.current) ? 0 : 1;
    } catch (_) {
      // Classification is advisory; a missing module must not block the governor.
    }

    return {
      measured: true,
      audible: silenceMs >= cfg.audibleSilenceMs || dropRate >= 1,
      nodeCpu,
      transcoding,
      deficitFrames: delta.deficit,
      silenceMs,
      dropRate,
    };
  }

  /**
   * Fold one health window into the guild's adaptive offset. Pure state work so
   * it is testable and cannot spam REST: the caller applies the change.
   */
  applyHealth(channel, health, cfg = this.settings()) {
    if (!channel?.guild || !isVoiceBased(channel)) return null;
    const state = this.stateFor(channel.guild.id);
    state.lastHealth = health;
    if (!health?.measured) return null;

    const now = Date.now();
    const ceiling = this.tierCeiling(channel);
    const floor = Math.min(cfg.min, ceiling);
    const cooldownOk = now - state.lastAdaptAt >= cfg.adaptCooldownMs;

    // Audio is arriving incomplete while the node has CPU to spare and is not
    // transcoding: the link is the constraint, so spend fewer bits per frame.
    const transportBound =
      health.audible && (health.nodeCpu ?? 0) < 0.7 && health.transcoding === 0;

    if (transportBound) {
      state.healthyWindows = 0;
      const recent = state.downshifts.filter((at) => now - at < DOWNSHIFT_WINDOW_MS);
      state.downshifts = recent;
      if (cooldownOk && recent.length < cfg.maxDownshiftsPerHour && ceiling - state.offset > floor) {
        state.offset = Math.min(state.offset + cfg.stepDown, ceiling - floor);
        state.lastAdaptAt = now;
        state.downshifts = [...recent, now];
        return { direction: "down", offset: state.offset, health };
      }
      return null;
    }

    if (!health.audible) {
      state.healthyWindows += 1;
      if (state.offset > 0 && state.healthyWindows >= cfg.healthyWindowsForUp && cooldownOk) {
        state.offset = Math.max(0, state.offset - cfg.stepDown);
        state.lastAdaptAt = now;
        state.healthyWindows = 0;
        return { direction: "up", offset: state.offset, health };
      }
    }

    return null;
  }

  /** One governor tick: adapt where needed, otherwise reconcile drift. */
  async tick(client) {
    if (this.ticking) return;
    const cfg = this.settings();
    if (!cfg.enabled || !client?.lavalink) return;

    this.ticking = true;
    try {
      const players = client.lavalink.players?.values
        ? [...client.lavalink.players.values()]
        : [];

      for (const player of players) {
        if (!player?.voiceChannelId || !player.guildId) continue;
        const channel = client.channels?.cache?.get?.(player.voiceChannelId);
        if (!isVoiceBased(channel)) continue;

        const health = this.readHealth(player);
        const change = this.applyHealth(channel, health, cfg);

        if (change) {
          logger.debug(
            `[Bitrate] Guild ${player.guildId}: adaptive ${change.direction}-shift to ` +
              `${Math.round(this.targetBitrate(channel) / 1000)}kbps after ` +
              `${health.deficitFrames} dropped frame(s) (~${health.silenceMs}ms silence).`
          );
          await this.ensure(channel, client, {
            reason: `auto-adaptive ${change.direction}-shift`,
            force: true,
          });
        } else {
          await this.ensure(channel, client, { reason: "periodic reconcile" });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Arm the governor. Safe to call twice. */
  start(client) {
    const cfg = this.settings();
    if (!cfg.enabled) {
      logger.debug("[Bitrate] Auto voice-bitrate governor disabled by config.");
      return;
    }

    this.stop();
    this.timer = setInterval(() => {
      this.tick(client).catch((err) =>
        logger.debug(`[Bitrate] Governor tick failed: ${err?.message || err}`)
      );
    }, cfg.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();

    logger.info(
      `[Bitrate] Adaptive voice-bitrate governor armed (tick ${Math.round(cfg.tickMs / 1000)}s, ` +
        `ceiling ${Math.round(cfg.max / 1000)}kbps, floor ${Math.round(cfg.min / 1000)}kbps).`
    );
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One-line state for diagnostics (`/audio`). */
  describe(guildId, channel) {
    const cfg = this.settings();
    if (!cfg.enabled) return "auto-bitrate disabled";
    if (!isVoiceBased(channel)) return "not a voice channel";

    const kb = (value) => `${Math.round(value / 1000)}kbps`;
    const state = this.state.get(guildId);
    const actual = Number(channel.bitrate) || 0;
    const ceiling = Math.min(this.tierCeiling(channel), cfg.max);
    const target = state ? this.targetBitrate(channel) : ceiling;

    const parts = [`\`${kb(actual)}\` / max \`${kb(ceiling)}\``];
    if (target !== ceiling) parts.push(`adaptive \`${kb(target)}\``);
    if (actual === target) parts.push("in sync");
    else if (state?.lastError) parts.push(`blocked: ${state.lastError}`);
    else parts.push("raising");
    if (state?.offset) parts.push(`offset \`${kb(state.offset)}\``);

    return parts.join(" • ");
  }
}

module.exports = new VoiceBitrateManager();
module.exports.VoiceBitrateManager = VoiceBitrateManager;
module.exports.MAX_DISCORD_BITRATE = MAX_DISCORD_BITRATE;
module.exports.diffFrames = diffFrames;
