const { ChannelType } = require("discord.js");
const logger = require("../../utils/logger");
const audioOptimizer = require("../../utils/audioOptimizer");
const emojis = require("../../utils/emojis");
const listenerGuard = require("../../utils/listenerGuard");

module.exports = {
  name: "voiceStateUpdate",
  async execute(oldState, newState, client) {
    return emojis.runWithClient(client, async () => {
      const guildId = newState.guild.id;

      // -------------------------------------------------------------------------
      // 1. Stage Channel Auto-Speaker & Voice Fidelity Auto-Maximizer
      // -------------------------------------------------------------------------
      if (newState.id === client.user?.id && newState.channel) {
        // Auto-boost voice channel bitrate to guild maximum (up to 384 kbps)
        audioOptimizer.maximizeVoiceBitrate(newState.channel, client);

        if (newState.channel.type === ChannelType.GuildStageVoice && newState.suppressed) {
          try {
            await newState.guild.members.me.voice.setSuppressed(false);
            logger.info(`Auto-unsuppressed bot in Stage Channel: ${newState.channel.name}`);
          } catch (err) {
            logger.debug("Stage channel unsuppress warning:", err.message);
          }
        }
      }

      const player = client.lavalink.getPlayer(guildId);
      if (!player) return;

      // -------------------------------------------------------------------------
      // 2. Disconnect / Kick / Move Cleanup
      // -------------------------------------------------------------------------
      if (oldState.id === client.user?.id && !newState.channelId) {
        logger.info(`Bot ${client.user?.username} was disconnected from voice channel in guild: ${guildId}`);
        const is247 = Boolean(player?.get("247"));
        // In 24/7 mode the queue is the whole point. Keep the player (and its
        // queue) alive and let the reconnect engine re-attach it; destroying it
        // here wiped the queue on every kick or manual move.
        listenerGuard.clearWatch(client, guildId);
        if (player && !is247) {
          player.destroy("Bot disconnected from voice channel").catch(() => {});
        }
        // Auto-reconnect if 24/7 is enabled
        if (is247) {
          setTimeout(() => {
            const reconnect247 = require("../../utils/reconnect247");
            reconnect247(client).catch(() => {});
          }, 5000);
        }
        return;
      }

      // Handle bot moved between voice channels (only when moved from an existing channel)
      if (oldState.id === client.user?.id && newState.channelId && oldState.channelId && oldState.channelId !== newState.channelId) {
        const voiceStatusManager = require("../../utils/voiceStatusManager");
        voiceStatusManager.clearVoiceStatus(client, oldState.channelId, guildId);
        if (player && player.playing && !player.paused && player.queue.current) {
          voiceStatusManager.onTrackStart(client, player, player.queue.current);
        } else if (player && (!player.queue?.current && !player.playing)) {
          voiceStatusManager.setIdleVoiceStatus(client, newState.channelId, guildId);
        }
      }

      // -------------------------------------------------------------------------
      // 3. Listener Monitoring: pause when alone, disconnect after the grace period
      // -------------------------------------------------------------------------
      if (!player.voiceChannelId) return;

      const outcome = await listenerGuard.enforce(player, client, { notify: true });

      // Humans returned: undo the auto-pause we applied when the room emptied.
      if (outcome.action === "cancelled" && player.paused && player.get("autoPaused")) {
        await player.resume().catch(() => {});
        player.set("autoPaused", false);
        logger.info(`Auto-resumed playback in guild ${guildId} because a listener joined.`);
        const voiceStatusManager = require("../../utils/voiceStatusManager");
        voiceStatusManager.onResume(client, player);
      }
    });
  },
};
