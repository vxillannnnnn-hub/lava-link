const logger = require("./logger");
const db = require("../database/db");
const config = require("../config");
const audioOptimizer = require("./audioOptimizer");
const voiceStatusManager = require("./voiceStatusManager");
const multiBotCoordinator = require("./multiBotCoordinator");

// Guard to prevent concurrent reconnect loops
let isReconnecting = false;

/**
 * Auto-reconnect all configured 24/7 voice channels across all servers
 * @param {import("discord.js").Client} client 
 */
async function reconnect247(client) {
  if (isReconnecting) return;
  isReconnecting = true;

  try {
    const list = db.getAll247Guilds();
    if (!list || list.length === 0) {
      isReconnecting = false;
      return;
    }

    logger.info(`[24/7 Engine] Found ${list.length} permanent 24/7 guild(s). Checking connections...`);

    for (const row of list) {
      try {
        const guild = client.guilds.cache.get(row.guild_id);
        if (!guild) continue; // This bot is not in this guild (in multi-bot setups, another clone handles it)

        const voiceChannel = guild.channels.cache.get(row.voice_247_channel_id);
        if (!voiceChannel) {
          logger.debug(`[24/7 Engine] Voice channel ${row.voice_247_channel_id} not found in ${guild.name}`);
          continue;
        }

        // ---------------------------------------------------------------------
        // Fleet Arbitration for 24/7 Voice Channels:
        // ---------------------------------------------------------------------
        // 1. Check if another bot from our fleet is ALREADY connected in this voice channel
        const isFleetBotConnected = (multiBotCoordinator.allBotIds || []).some((botId) => {
          if (botId === client.user.id) return false;
          const vs = guild.voiceStates.cache.get(botId);
          return vs && vs.channelId === row.voice_247_channel_id;
        });

        if (isFleetBotConnected) {
          // Another fleet clone is already holding this 24/7 voice channel
          continue;
        }

        // 2. If a specific bot was assigned to 24/7 for this guild, ensure that bot handles it
        if (row.bot_247_user_id) {
          if (row.bot_247_user_id !== client.user.id) {
            // Check if the assigned bot is actually present in this guild
            const assignedBotPresent = (multiBotCoordinator.clients || []).some(
              (c) => c.user?.id === row.bot_247_user_id && c.guilds.cache.has(row.guild_id)
            );
            if (assignedBotPresent) {
              // The assigned bot is in the fleet and present in this guild, let it reconnect
              continue;
            }
            // If the assigned bot is not present in this guild, fallback to lowest index bot
            const botsInGuild = (multiBotCoordinator.clients || [])
              .filter((c) => c.user?.id && c.guilds.cache.has(row.guild_id))
              .sort((a, b) => (a.botIndex ?? 0) - (b.botIndex ?? 0));
            if (botsInGuild[0] && botsInGuild[0].user.id !== client.user.id) {
              continue;
            }
          }
        } else {
          // No specific bot assigned: lowest-indexed bot present in this guild takes ownership
          const botsInGuild = (multiBotCoordinator.clients || [])
            .filter((c) => c.user?.id && c.guilds.cache.has(row.guild_id))
            .sort((a, b) => (a.botIndex ?? 0) - (b.botIndex ?? 0));
          if (botsInGuild[0] && botsInGuild[0].user.id !== client.user.id) {
            continue;
          }
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
          logger.success(`[24/7 Engine] ✅ Reconnected to 24/7 voice channel in ${guild.name} (<#${voiceChannel.id}>)`);
        }

        // If no music is currently playing, ensure cool idle voice channel status is displayed
        if (!player.queue?.current) {
          voiceStatusManager.setIdleVoiceStatus(client, voiceChannel.id, row.guild_id);
        }
      } catch (err) {
        logger.warn(`[24/7 Engine] Error reconnecting guild ${row.guild_id}:`, err.message);
      }
    }
  } catch (err) {
    logger.error("[24/7 Engine] Failed to execute 24/7 auto-reconnect:", err.message);
  } finally {
    isReconnecting = false;
  }
}

/**
 * Start background 60-second self-healing health check for 24/7 channels
 * @param {import("discord.js").Client} client 
 */
function start247HealthCheck(client) {
  const timer = setInterval(() => {
    if (client?.isReady()) {
      reconnect247(client).catch(() => {});
    }
  }, 60000);
  timer.unref();
}

module.exports = {
  reconnect247,
  start247HealthCheck,
};
