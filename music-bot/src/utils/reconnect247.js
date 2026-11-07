const logger = require("./logger");
const db = require("../database/db");
const config = require("../config");
const audioOptimizer = require("./audioOptimizer");
const voiceStatusManager = require("./voiceStatusManager");

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
