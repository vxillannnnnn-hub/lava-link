const config = require("../config");
const logger = require("./logger");
const { warnEmbed } = require("./embed");

/**
 * Empty-voice-channel watchdog
 * ---------------------------------------------------------------------------
 * A music player must not keep streaming into an empty channel, and it must not
 * keep the seat forever either. Both decisions lived inside the
 * `voiceStateUpdate` handler, which only runs when somebody *moves* - so an
 * abandoned session restored after a restart (or a boot while alone) never got
 * a pause or a leave timer at all, and autoplay happily refilled the queue.
 *
 * This module owns the rule so every entry point agrees:
 *   - humans present            -> cancel the leave timer, resume anything we suspended
 *   - alone, 24/7 off           -> pause now, disconnect after the grace period
 *   - alone, 24/7 on            -> stop streaming, keep the session AND the queue
 *
 * 24/7 used to only *pause*, which looked safe but was not: pausing leaves the
 * node player loaded, and lavalink-client's autoplay hand-off calls
 * `play({ paused: false })` - so the next recommendation un-paused the player
 * and the bot went on broadcasting to nobody. Suspending instead tears the node
 * track down, parks the upcoming queue and restores both on the next join.
 *
 * It is fail-open: an unknown guild/channel counts as "not alone", because a
 * cache miss must never mute a channel that actually has listeners.
 */

// `${guildId}_${botId}` -> { timer, channelId }
const watches = new Map();

/**
 * Humans connected to a voice channel, counted from live voice states.
 *
 * `!vs.member?.user?.bot` is not enough on its own: with a bounded member cache
 * an uncached sibling bot looks human, which kept the bot connected to empty
 * channels and stopped the auto-pause from ever firing.
 */
function countHumanListeners(client, guild, channelId) {
  if (!guild || !channelId) return 0;

  const multiBotCoordinator = require("./multiBotCoordinator");
  const botIds = multiBotCoordinator.allBotIds || [];
  let humans = 0;

  // 1. Direct channel member inspection (most authoritative in Discord.js)
  const channel = guild.channels?.cache?.get?.(channelId);
  if (channel?.members?.size > 0) {
    for (const member of channel.members.values()) {
      if (!member?.user) continue;
      if (botIds.includes(member.user.id) || member.user.bot) continue;
      humans++;
    }
    if (humans > 0) return humans;
  }

  // 2. Check guild.voiceStates.cache
  if (guild.voiceStates?.cache) {
    for (const vs of guild.voiceStates.cache.values()) {
      if (vs.channelId !== channelId || vs.id == null) continue;
      if (botIds.includes(vs.id)) continue;
      const isBot =
        vs.member?.user?.bot ||
        guild.members?.cache?.get(vs.id)?.user?.bot ||
        client?.users?.cache?.get?.(vs.id)?.bot;
      if (!isBot) humans++;
    }
  }

  return humans;
}
/**
 * Resolve the discord.js client for a player.
 *
 * lavalink-client keeps NO reference to the discord.js client on the player:
 * the only back-reference is `player.LavalinkManager`, and its `options.client`
 * is just `{ id, username }`. Reading `player.lavalink.client` / `player.client`
 * (as this guard used to) therefore resolved to `undefined` every single time,
 * which made the guard fail open and let autoplay refill an abandoned channel
 * forever. Order: explicit argument -> client attached by LavalinkHandler ->
 * fleet lookup by application id -> AsyncLocalStorage context.
 */
function resolveClient(player, client) {
  if (client) return client;
  if (player?.client) return player.client;

  const manager = player?.LavalinkManager || player?.lavalink || null;
  if (manager?.client) return manager.client;

  const appId = manager?.options?.client?.id;
  if (appId) {
    const multiBotCoordinator = require("./multiBotCoordinator");
    const match = (multiBotCoordinator.clients || []).find((c) => c?.user?.id === appId);
    if (match) return match;
  }

  try {
    return require("./emojis").getActiveClient?.() || null;
  } catch (_) {
    return null;
  }
}

function resolveGuild(client, player) {
  return client?.guilds?.cache?.get(player?.guildId) || player?.guild || null;
}

/**
 * True only when we can positively see an empty channel. A missing cache is
 * reported as "not alone" so the guard can never silence a busy channel.
 */
function isAlone(player, client) {
  if (!player?.voiceChannelId) return false;
  const resolvedClient = resolveClient(player, client);
  const guild = resolveGuild(resolvedClient, player);
  if (!guild?.voiceStates?.cache) return false;
  return countHumanListeners(resolvedClient, guild, player.voiceChannelId) === 0;
}

const SUSPEND_KEY = "suspended";

/**
 * Stop streaming while keeping everything needed to continue later.
 *
 * The node track is torn down with `stopPlaying(false, false)` (which also flips
 * lavalink-client's internal autoplay guard). The upcoming tracks are parked
 * first: while the queue is empty the node's TrackEnd takes the `queueEnd` path
 * instead of auto-advancing, so the stop cannot turn into "play the next song".
 *
 * @returns {Promise<boolean>} whether anything was actually suspended
 */
async function suspendStreaming(player) {
  if (!player?.queue) return false;
  if (player.get?.(SUSPEND_KEY)) return false; // already suspended

  const current = player.queue.current || null;
  const upcoming = Array.from(player.queue.tracks || []);
  if (!current && upcoming.length === 0) return false;

  // Mark before stopping: trackEnd fires during the stop and must not be read as
  // a listener skip (that would blacklist the artist) or as a queue end to announce.
  player.set?.(SUSPEND_KEY, {
    track: current,
    position: Number(player.position) || 0,
    queue: upcoming,
  });
  player.set?.("autoPaused", true);

  if (upcoming.length) {
    await Promise.resolve(player.queue.splice?.(0, upcoming.length)).catch(() => {});
  }

  if (typeof player.stopPlaying === "function") {
    await player.stopPlaying(false, false).catch(() => {});
  } else if (typeof player.pause === "function") {
    await player.pause().catch(() => {});
  }

  return true;
}

/**
 * Undo a suspension (or an auto-pause). Restores the parked queue first so the
 * player has something to play even if the original track is gone.
 *
 * @returns {Promise<boolean>} whether playback was restarted
 */
async function resumeStreaming(player) {
  const suspended = player?.get?.(SUSPEND_KEY) || null;

  if (!suspended) {
    if (!player?.paused) return false;
    await player.resume().catch(() => {});
    player.set?.("autoPaused", false);
    return true;
  }

  player.set?.(SUSPEND_KEY, null);
  player.set?.("autoPaused", false);

  if (suspended.queue?.length) player.queue.add(suspended.queue);

  if (!suspended.track) {
    if (!player.playing && player.queue?.tracks?.length) await player.play().catch(() => {});
    return true;
  }

  // Resume the exact track where it stopped. `position` must stay below the
  // duration or lavalink-client rejects the call.
  const duration = Number(suspended.track.info?.duration) || 0;
  const position = Math.max(0, Math.min(suspended.position || 0, duration > 2000 ? duration - 1000 : 0));

  try {
    await player.play({ clientTrack: suspended.track, position });
  } catch (err) {
    logger.warn(
      `[ListenerGuard] Could not resume the suspended track in guild ${player.guildId}: ${err?.message || err}`
    );
    if (!player.playing && player.queue?.tracks?.length) await player.play().catch(() => {});
  }
  return true;
}

function watchKey(client, guildId, channelId) {
  return `${guildId}_${channelId}_${client?.user?.id}`;
}

function clearWatch(client, guildId, channelId) {
  const key = watchKey(client, guildId, channelId);
  const existing = watches.get(key);
  if (!existing) return false;
  clearTimeout(existing.timer);
  watches.delete(key);
  return true;
}

async function notifyEmpty(client, player, channelId) {
  if (!player?.textChannelId) return;
  const textChannel = client?.channels?.cache?.get?.(player.textChannelId);
  if (!textChannel) return;

  const minutes = Math.max(1, Math.round((Number(config.player.emptyChannelTimeoutMs) || 120000) / 60000));
  const stayNote = player.get?.("247")
    ? "24/7 mode is on, so the bot stays connected."
    : `The bot will disconnect in ${minutes} minute(s) if nobody rejoins.`;

  try {
    const message = await textChannel.send({
      embeds: [warnEmbed(`Voice channel is empty! Playback is paused. ${stayNote}`, "Empty Channel")],
    });
    setTimeout(() => message.delete().catch(() => {}), 15000);
  } catch (_) {
    // A missing Send Messages permission must not break the watchdog.
  }
}

/**
 * Apply the listener rule to one player.
 * @returns {Promise<{ humans: number|null, action: string }>}
 */
async function enforce(player, client, { notify = false, graceMs } = {}) {
  if (!player?.voiceChannelId || !player.guildId) return { humans: null, action: "idle" };

  const resolvedClient = resolveClient(player, client);
  const guild = resolveGuild(resolvedClient, player);
  if (!guild?.voiceStates?.cache) return { humans: null, action: "unknown" };

  const channelId = player.voiceChannelId;
  const humans = countHumanListeners(resolvedClient, guild, channelId);
  const key = watchKey(resolvedClient, player.guildId, channelId);

  if (humans > 0) {
    const cancelled = clearWatch(resolvedClient, player.guildId, channelId);
    if (cancelled) {
      logger.info(
        `[ListenerGuard] Human listener(s) present (${humans}) in guild ${player.guildId}. Auto-leave cancelled.`
      );
    }
    // Resume here rather than in the caller: 24/7 never arms a leave timer, so
    // its suspension had no "cancelled" signal and stayed stopped forever.
    if (player.get?.("autoPaused") || player.get?.(SUSPEND_KEY)) {
      if (await resumeStreaming(player)) {
        logger.info(`[ListenerGuard] Resumed playback in guild ${player.guildId}: a listener joined.`);
        return { humans, action: "resumed" };
      }
    }
    return { humans, action: cancelled ? "cancelled" : "listening" };
  }

  // Alone. 24/7 keeps the seat. If stopStreamingAloneIn247 is explicitly true, suspend streaming.
  if (player.get?.("247")) {
    clearWatch(resolvedClient, player.guildId, channelId);
    if (config.player?.stopStreamingAloneIn247 === true) {
      const suspended = await suspendStreaming(player);
      if (suspended) {
        logger.info(
          `[ListenerGuard] Stopped 24/7 streaming in guild ${player.guildId}: channel is empty ` +
            "(staying connected, queue preserved for the next join)."
        );
        return { humans: 0, action: "stopped-247" };
      }
    }
    return { humans: 0, action: "stay-247" };
  }

  if (player.playing && !player.paused) {
    await player.pause().catch(() => {});
    player.set("autoPaused", true);
    logger.info(`[ListenerGuard] Auto-paused playback in guild ${player.guildId}: voice channel is empty.`);
  }

  if (watches.has(key)) return { humans: 0, action: "waiting" };

  // `graceMs` exists so the disconnect path is testable without waiting minutes.
  const configuredGrace = Number(config.player.emptyChannelTimeoutMs) || 120000;
  const graceDelay = Number.isFinite(Number(graceMs))
    ? Math.max(0, Number(graceMs))
    : Math.max(30000, configuredGrace);
  const watch = { channelId, timer: null };

  watch.timer = setTimeout(async () => {
    watches.delete(key);

    // The player may have been moved while this countdown ran (an admin drag, a
    // `/join` into another channel, a 24/7 reconnect). Destroying it then killed
    // a healthy session that had listeners in its NEW channel.
    if (player.voiceChannelId && player.voiceChannelId !== channelId) return;
    // A replacement player for the same guild must not be destroyed by the old
    // one's timer either.
    const registered = resolvedClient?.lavalink?.getPlayer?.(player.guildId);
    if (registered && registered !== player) return;

    // Re-count against the channel this timer was armed for: the player may have
    // been moved since, and a stale count would disconnect an occupied channel.
    const stillAlone = countHumanListeners(resolvedClient, guild, channelId) === 0;
    if (!stillAlone) return;
    logger.info(`[ListenerGuard] Disconnecting from empty channel in guild ${player.guildId}.`);
    await Promise.resolve(player.destroy?.("Voice channel left empty")).catch(() => {});
  }, graceDelay);

  if (typeof watch.timer.unref === "function") watch.timer.unref();
  watches.set(key, watch);

  if (notify) await notifyEmpty(resolvedClient, player, channelId);
  return { humans: 0, action: "armed" };
}

/**
 * Safety net for states no event covers: restored sessions, a bot that was
 * already alone when it joined, and a missed gateway update.
 */
async function reconcile(client) {
  const players = client?.lavalink?.players?.values
    ? [...client.lavalink.players.values()]
    : [];
  const results = [];
  for (const player of players) {
    results.push(await enforce(player, client, { notify: false }));
  }
  return results;
}

module.exports = {
  countHumanListeners,
  resolveClient,
  isAlone,
  enforce,
  reconcile,
  clearWatch,
  suspendStreaming,
  resumeStreaming,
  SUSPEND_KEY,
  watches,
};
