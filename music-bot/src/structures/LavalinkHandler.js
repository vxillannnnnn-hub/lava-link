const { LavalinkManager, Player, LavalinkNode } = require("lavalink-client");
const config = require("../config");
const logger = require("../utils/logger");
const autoplayManager = require("../utils/autoplayManager");
const { sendOrUpdatePlayerDashboard, startRealtimeProgressLoop, stopRealtimeProgressLoop } = require("../utils/playerController");
const { updateRequestChannelDashboard } = require("../utils/requestChannelManager");
const { infoEmbed, warnEmbed, errorEmbed } = require("../utils/embed");
const { truncate } = require("../utils/formatters");
const emojis = require("../utils/emojis");
const voiceStatusManager = require("../utils/voiceStatusManager");
const presenceManager = require("../utils/presenceManager");
const audioOptimizer = require("../utils/audioOptimizer");
const audioQuality = require("../utils/audioQuality");
const audioSelfCheck = require("../utils/audioSelfCheck");
const playerActions = require("../utils/playerActions");
const stateManager = require("../utils/stateManager");
const { reconnect247 } = require("../utils/reconnect247");

// =============================================================================
// Resilient Monkey-Patching for LavalinkNode & Player (Self-Healing Audio Engine)
// Prevents unhandled promise rejections and auto-retries transient network timeouts
// =============================================================================
if (LavalinkNode && LavalinkNode.prototype && !LavalinkNode.prototype._patchedResilientRequest) {
  LavalinkNode.prototype._patchedResilientRequest = true;
  const originalRawRequest = LavalinkNode.prototype.rawRequest;

  LavalinkNode.prototype.rawRequest = async function (endpoint, modify) {
    try {
      return await originalRawRequest.call(this, endpoint, modify);
    } catch (err) {
      const isTimeout =
        err.name === "TimeoutError" ||
        err.code === "UND_ERR_HEADERS_TIMEOUT" ||
        err.code === "UND_ERR_BODY_TIMEOUT" ||
        err.message?.toLowerCase().includes("timeout") ||
        err.message?.toLowerCase().includes("aborted");

      if (isTimeout) {
        logger.warn(`[LavalinkNode] REST request to "${endpoint}" timed out on node "${this.id}". Retrying once...`);
        return await originalRawRequest.call(this, endpoint, modify);
      }
      throw err;
    }
  };
}

if (Player && Player.prototype && !Player.prototype._patchedResilientPlay) {
  Player.prototype._patchedResilientPlay = true;
  const originalPlay = Player.prototype.play;
  const originalSkip = Player.prototype.skip;
  const originalPause = Player.prototype.pause;
  const originalResume = Player.prototype.resume;
  const originalDestroy = Player.prototype.destroy;

  Player.prototype.play = function (...args) {
    const promise = (async () => {
      try {
        return await originalPlay.apply(this, args);
      } catch (err) {
        const isTimeout =
          err.name === "TimeoutError" ||
          err.message?.toLowerCase().includes("timeout") ||
          err.message?.toLowerCase().includes("aborted");

        if (isTimeout) {
          logger.warn(`[Player] play() timed out in guild ${this.guildId}. Retrying with fresh request...`);
          try {
            return await originalPlay.apply(this, args);
          } catch (retryErr) {
            logger.error(`[Player] play() retry also failed in guild ${this.guildId}:`, retryErr?.message || retryErr);
            throw retryErr;
          }
        }
        throw err;
      }
    })();

    // Catch floating/detached calls (e.g. autoSkip in lavalink-client) so they never trigger unhandledRejection
    promise.catch((err) => {
      logger.warn(`[Player] Handled background play() error for guild ${this.guildId}: ${err?.message || err}`);
    });

    return promise;
  };

  Player.prototype.skip = function (...args) {
    const promise = originalSkip.apply(this, args);
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        logger.warn(`[Player] Handled background skip() error for guild ${this.guildId}: ${err?.message || err}`);
      });
    }
    return promise;
  };

  Player.prototype.pause = function (...args) {
    const promise = originalPause.apply(this, args);
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        logger.warn(`[Player] Handled background pause() error for guild ${this.guildId}: ${err?.message || err}`);
      });
    }
    return promise;
  };

  Player.prototype.resume = function (...args) {
    const promise = originalResume.apply(this, args);
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        logger.warn(`[Player] Handled background resume() error for guild ${this.guildId}: ${err?.message || err}`);
      });
    }
    return promise;
  };

  Player.prototype.destroy = function (...args) {
    const promise = originalDestroy.apply(this, args);
    if (promise && typeof promise.catch === "function") {
      promise.catch((err) => {
        logger.warn(`[Player] Handled background destroy() error for guild ${this.guildId}: ${err?.message || err}`);
      });
    }
    return promise;
  };
}

/**
 * Initialize and attach optimized LavalinkManager to BotClient
 * @param {import("discord.js").Client} client 
 */
function initLavalink(client) {
  const manager = new LavalinkManager({
    nodes: [
      {
        id: config.lavalink.id,
        host: config.lavalink.host,
        port: config.lavalink.port,
        authorization: config.lavalink.authorization,
        secure: config.lavalink.secure,
        retryAmount: config.lavalink.retryAmount,
        retryDelay: config.lavalink.retryDelay,
        requestSignalTimeoutMS: config.lavalink.requestTimeout,
        heartBeatInterval: config.lavalink.heartBeatInterval, // 25s keep-alive
        enablePingOnStatsCheck: true,
      },
    ],
    sendToShard: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
    autoSkip: true,
    autoSkipOnResolveError: true, // Never freeze on corrupt audio chunks
    emitNewSongsOnly: true,
    playerOptions: {
      defaultSearchPlatform: config.player.defaultSearchPlatform,
      applyVolumeAsFilter: false, // Opus Direct Passthrough: skip PCM transcoding when volume = 100
      minAutoPlayMs: config.player.minAutoPlayMs, // anti-spam guard between autoplay hand-offs
      onDisconnect: {
        autoReconnect: config.player.autoReconnect,
        destroyPlayer: false, // Keep session alive on network glitch
      },
      onEmptyQueue: {
        destroyAfterMs: config.player.inactivityTimeoutMs,
        // Native autoplay hook: the ONLY place autoplay adds tracks when the
        // queue runs out. lavalink-client plays whatever we queue here.
        autoPlayFunction: async (player, track) => {
          try {
            if (!Boolean(player.get("autoplay"))) return;
            await autoplayManager.executeAutoplay(player, track, true);
          } catch (err) {
            // Never throw into the client - a throw here aborts its queue handling
            logger.warn(`[Autoplay] Hook failed in guild ${player.guildId}: ${err?.message || err}`);
          }
        },
      },
    },
    queueOptions: {
      maxPreviousTracks: config.player.maxPreviousTracks,
    },
  });

  // Warn when playback is pinned to a metadata-only platform: those streams are
  // mirrors that often have to be re-encoded, while YouTube Music ships Opus and
  // is forwarded to Discord untouched.
  if (audioQuality.isMetadataOnlyPlatform(config.player.defaultSearchPlatform)) {
    logger.warn(
      `[AudioQuality] DEFAULT_SEARCH_PLATFORM is "${config.player.defaultSearchPlatform}" (metadata-only). For maximum fidelity set DEFAULT_SEARCH_PLATFORM=ytmsearch; previews from this platform will still be repaired automatically.`
    );
  }

  // Helper to ensure asynchronous event callbacks never throw unhandled rejections
  const safeAsync = (fn) => (...args) => {
    Promise.resolve(fn(...args)).catch((err) => {
      logger.error("[Lavalink Event Error]:", err?.stack || err?.message || err);
    });
  };

  // ---------------------------------------------------------------------------
  // Lavalink Node Lifecycle Events & Session Resuming
  // ---------------------------------------------------------------------------
  manager.nodeManager.on("connect", safeAsync(async (node) => {
    logger.lavalink(
      `Connected to node: ${node.id} (${node.options.host}:${node.options.port}) [v${node.info?.version?.semver || "4.x"}]`
    );

    // Activate Lavalink v4 Session Resuming for instantaneous (<50ms) recovery
    try {
      await node.updateSession(true, config.lavalink.sessionResumeTimeout);
      logger.lavalink(`Session resuming armed (timeout: ${config.lavalink.sessionResumeTimeout}s). Reconnects guaranteed < 50ms.`);
    } catch (err) {
      logger.debug("Session resume update warning:", err.message);
    }

    // Report anything that silently degrades audio (outdated build, missing
    // providers, CPU pressure, dropped frames) before any player starts.
    try {
      await audioSelfCheck.runAudioSelfCheck(client, node);
    } catch (err) {
      logger.debug(`[AudioSelfCheck] Skipped: ${err?.message || err}`);
    }

    // Restore active player queues and playback across runner restarts
    await stateManager.restoreState(client);

    // Auto-reconnect all permanent 24/7 channels across all configured servers
    await reconnect247(client);
  }));

  manager.nodeManager.on("disconnect", (node, reason) => {
    logger.warn(`Lavalink node disconnected: ${node.id} - Reason:`, reason);
  });

  manager.nodeManager.on("error", (node, error) => {
    logger.error(`Lavalink node error [${node.id}]:`, error?.message || error);
  });

  manager.nodeManager.on("reconnecting", (node) => {
    logger.info(`Reconnecting to Lavalink node: ${node.id}...`);
  });

  // ---------------------------------------------------------------------------
  // Player Audio Lifecycle Events
  // ---------------------------------------------------------------------------
  manager.on("trackStart", safeAsync((player, track) => emojis.runWithClient(client, async () => {
    if (!player.textChannelId) return;
    const channel = client.channels.cache.get(player.textChannelId);

    logger.info(`Started playing "${track.info.title}" in guild ${player.guildId}`);

    // Always cache last played track so autoplay has an immutable recommendation seed
    player.set("lastPlayedTrack", track);
    player.set("autoPaused", false);
    player.set("voteskips", new Set()); // votes never carry over to the next track

    // Record track in autoplay history buffer so it is never repeated
    autoplayManager.recordTrackPlayed(player.guildId, track.info.identifier, track.info.title);

    // Jockie-style background pre-fetch for 0ms gapless transition
    const isAutoplay = Boolean(player.get("autoplay"));
    if (isAutoplay && player.queue.tracks.length === 0) {
      autoplayManager.prefetchAutoplay(player, track).catch(() => {});
    } else if (player.queue.tracks.length > 0) {
      // Pre-warm the next queued track for 0ms instantaneous track transition
      audioOptimizer.preloadNextQueueTrack(player);
    }

    // Auto-maximize voice channel bitrate for studio-grade audio fidelity
    if (player.voiceChannelId) {
      player.set("lastVoiceChannelId", player.voiceChannelId);
      const vc = client.channels.cache.get(player.voiceChannelId);
      if (vc) audioOptimizer.maximizeVoiceBitrate(vc, client);
    }

    // Update dedicated song request channel dashboard if configured
    updateRequestChannelDashboard(client, player.guildId, player);

    // Update real-time Voice Channel Status without emojis (Rotating Templates)
    voiceStatusManager.onTrackStart(client, player, track);

    // Update real-time bot Streaming Presence (Purple Stream Badge with Song Title)
    presenceManager.onTrackStart(client, player, track);

    if (!channel) return;

    try {
      await sendOrUpdatePlayerDashboard(channel, player, true);
      startRealtimeProgressLoop(player, client);
    } catch (err) {
      logger.error("Failed to send trackStart dashboard:", err.message);
    }
  })));

  manager.on("trackEnd", safeAsync((player, track) => emojis.runWithClient(client, async () => {
    stopRealtimeProgressLoop(player);
    logger.debug(`Finished track "${track.info.title}" in guild ${player.guildId}`);
    const nextTrack = player.queue?.tracks?.[0];
    const hasNext = Boolean(nextTrack) || Boolean(player.get("autoplay"));
    if (nextTrack) {
      voiceStatusManager.onTrackStart(client, player, nextTrack);
    } else if (!hasNext) {
      voiceStatusManager.onTrackEnd(client, player);
    }
    presenceManager.onTrackEnd(client);
  })));

  manager.on("trackStuck", safeAsync((player, track, payload) => emojis.runWithClient(client, async () => {
    stopRealtimeProgressLoop(player);
    logger.warn(`Track stuck: "${track.info.title}" in guild ${player.guildId} threshold ${payload.thresholdMs}ms`);
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) {
        channel.send({
          content: `${emojis.warn} Stream for **${truncate(track.info.title, 45)}** stalled. Skipping...`,
          allowedMentions: { parse: [], users: [] },
        }).then((m) => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
      }
    }
    await playerActions.skipCurrent(player, 0);
  })));

  manager.on("trackError", safeAsync((player, track, payload) => emojis.runWithClient(client, async () => {
    stopRealtimeProgressLoop(player);
    logger.error(`Track error: "${track.info.title}" in guild ${player.guildId}:`, payload.error || payload.message);
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) {
        channel.send({
          content: `${emojis.cross} Audio decode failure for **${truncate(track.info.title, 45)}**. Playing next...`,
          allowedMentions: { parse: [], users: [] },
        }).then((m) => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {});
      }
    }
    await playerActions.skipCurrent(player, 0);
  })));

  manager.on("queueEnd", safeAsync((player, track) => emojis.runWithClient(client, async () => {
    stopRealtimeProgressLoop(player);
    logger.info(`Queue ended in guild ${player.guildId}`);

    // Safety net only: lavalink-client already ran the autoplay hook before
    // emitting queueEnd. If it resolved a track we must not resolve a second one.
    const isAutoplay = Boolean(player.get("autoplay"));
    const hookHandledAt = Number(player.get("autoplayHandledAt")) || 0;
    const hookJustHandled = Date.now() - hookHandledAt < 2000;
    if (isAutoplay && !player.queue.current && !hookJustHandled) {
      const lastTrack = track || player.queue.previous[0] || player.get("lastPlayedTrack");
      if (lastTrack) {
        const success = await autoplayManager.executeAutoplay(player, lastTrack, false);
        if (success) {
          logger.info(`[Jockie Autoplay] QueueEnd fallback resumed playback for guild ${player.guildId}`);
          return;
        }
      }
    }

    // Reset dedicated song request channel dashboard to ready state
    player.set("ownerId", null);
    updateRequestChannelDashboard(client, player.guildId, null);

    // Set cool idle Voice Channel status while bot remains connected in voice
    voiceStatusManager.setIdleVoiceStatus(client, player.voiceChannelId, player.guildId);
    presenceManager.onTrackEnd(client);

    // Clean up previous dashboard
    const prevMsgId = player.get("nowPlayingMsgId");
    if (prevMsgId && player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) {
        channel.messages.delete(prevMsgId).catch(() => {});
      }
      player.set("nowPlayingMsgId", null);
    }

    // Check 24/7 mode
    const is247 = player.get("247");
    if (is247) {
      if (player.textChannelId) {
        const channel = client.channels.cache.get(player.textChannelId);
        if (channel) {
          channel.send({
            content: `${emojis.time} Queue finished. Staying in voice channel (24/7 Mode Active).`,
            allowedMentions: { parse: [], users: [] },
          }).then((m) => setTimeout(() => m.delete().catch(() => {}), 15000)).catch(() => {});
        }
      }
      return;
    }

    // Inactivity leave countdown if not 24/7
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) {
        channel.send({
          content: `${emojis.warn} Queue finished. Bot will disconnect in 3 minutes if no new music is added.`,
          allowedMentions: { parse: [], users: [] },
        }).then((m) => setTimeout(() => m.delete().catch(() => {}), 15000)).catch(() => {});
      }
    }
  })));

  manager.on("playerDestroy", safeAsync((player) => emojis.runWithClient(client, () => {
    stopRealtimeProgressLoop(player);
    player.set("ownerId", null);
    logger.debug(`Player destroyed for guild ${player.guildId}`);
    updateRequestChannelDashboard(client, player.guildId, null);
    const targetVC = player.voiceChannelId || player.get("lastVoiceChannelId");
    voiceStatusManager.clearVoiceStatus(client, targetVC, player.guildId);
    presenceManager.onTrackEnd(client);
    const prevMsgId = player.get("nowPlayingMsgId");
    if (prevMsgId && player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) {
        channel.messages.delete(prevMsgId).catch(() => {});
      }
    }
  })));

  return manager;
}

module.exports = { initLavalink };
