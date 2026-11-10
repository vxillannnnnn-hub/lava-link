const logger = require("./logger");
const db = require("../database/db");
const config = require("../config");
const audioOptimizer = require("./audioOptimizer");
const voiceStatusManager = require("./voiceStatusManager");
const multiBotCoordinator = require("./multiBotCoordinator");
const listenerGuard = require("./listenerGuard");

// Per-client guard to prevent concurrent reconnect loops while allowing fleet instances to reconnect concurrently
const reconnectingClients = new Set();

/**
 * Auto-reconnect all configured 24/7 voice channels across all servers
 * @param {import("discord.js").Client} client 
 */
async function reconnect247(client) {
  if (!client?.user?.id) return;
  if (reconnectingClients.has(client.user.id)) return;
  reconnectingClients.add(client.user.id);

  try {
    const list = db.getAll247Guilds();
    if (!list || list.length === 0) {
      return;
    }

    for (const row of list) {
      try {
        const guild = client.guilds.cache.get(row.guild_id);
        if (!guild) continue; // This bot is not in this guild

        // ---------------------------------------------------------------------
        // Fleet Assignment for 24/7 Voice Channels:
        // ---------------------------------------------------------------------
        if (row.bot_247_user_id && row.bot_247_user_id !== "default") {
          // If a specific fleet bot was assigned, ONLY that bot handles reconnecting
          if (row.bot_247_user_id !== client.user.id) {
            continue;
          }
        } else {
          // Legacy or unassigned row: lowest-indexed bot present in this guild takes ownership
          const botsInGuild = (multiBotCoordinator.clients || [])
            .filter((c) => c.user?.id && c.guilds.cache.has(row.guild_id))
            .sort((a, b) => (a.botIndex ?? 0) - (b.botIndex ?? 0));
          if (botsInGuild[0] && botsInGuild[0].user.id !== client.user.id) {
            continue;
          }
        }

        const voiceChannel = guild.channels.cache.get(row.voice_247_channel_id);
        if (!voiceChannel) {
          logger.debug(`[24/7 Engine] Voice channel ${row.voice_247_channel_id} not found in ${guild.name}`);
          continue;
        }

        // Check if another bot from our fleet is ALREADY connected in this voice channel
        const otherFleetBotInVC = (multiBotCoordinator.clients || []).some((c) => {
          if (c.user?.id === client.user.id) return false;
          const vs = guild.voiceStates.cache.get(c.user?.id);
          return vs && vs.channelId === row.voice_247_channel_id;
        });

        if (otherFleetBotInVC) {
          continue;
        }

        let player = client.lavalink.getPlayer(row.guild_id);
        if (!player) {
          player = client.lavalink.createPlayer({
            guildId: row.guild_id,
            voiceChannelId: row.voice_247_channel_id,
            textChannelId: row.text_247_channel_id || null,
            selfDeaf: true,
            volume: config.player?.defaultVolume || 100,
          });
        }

        player.set("247", true);

        // Connect if not already connected to the designated channel
        if (!player.connected || player.voiceChannelId !== row.voice_247_channel_id) {
          player.voiceChannelId = row.voice_247_channel_id;
          await player.connect();
          audioOptimizer.maximizeVoiceBitrate(voiceChannel, client);
          logger.success(
            `[24/7 Engine] ✅ Reconnected ${client.user.username} to 24/7 voice channel in ${guild.name} (<#${voiceChannel.id}>)`
          );
        }

        // If no music is currently playing, ensure cool idle voice channel status is displayed
        if (!player.queue?.current) {
          voiceStatusManager.setIdleVoiceStatus(client, voiceChannel.id, row.guild_id);
        }
      } catch (err) {
        logger.warn(`[24/7 Engine] Error reconnecting guild ${row.guild_id} for ${client.user?.username}:`, err.message);
      }
    }
  } catch (err) {
    logger.error("[24/7 Engine] Failed to execute 24/7 auto-reconnect:", err.message);
  } finally {
    reconnectingClients.delete(client.user.id);
  }
}

/**
 * Start background 60-second self-healing health check for 24/7 channels
 * @param {import("discord.js").Client} client 
 */
function start247HealthCheck(client) {
  const timer = setInterval(() => {
    if (client?.isReady()) {
      // Event-independent safety net: pause/leave an abandoned channel even when
      // no voiceStateUpdate ever fired for it (restored sessions, boot while alone).
      listenerGuard.reconcile(client).catch(() => {});
      reconnect247(client).catch(() => {});
    }
  }, 60000);
  timer.unref();
}

module.exports = {
  reconnect247,
  start247HealthCheck,
};
