const { ChannelType } = require("discord.js");
const config = require("../../config");
const logger = require("../../utils/logger");
const { warnEmbed } = require("../../utils/embed");
const audioOptimizer = require("../../utils/audioOptimizer");
const emojis = require("../../utils/emojis");

// Map to store guild leave timeouts when voice channel is empty
const emptyChannelTimeouts = new Map();

/**
 * Humans connected to a voice channel, counted from live voice states.
 *
 * `!vs.member?.user?.bot` is not enough on its own: with a bounded member cache
 * an uncached sibling bot looks human, which kept the bot connected to empty
 * channels and stopped the auto-pause from ever firing.
 */
function countHumanListeners(client, guild, channelId) {
  if (!guild || !channelId) return 0;

  const multiBotCoordinator = require("../../utils/multiBotCoordinator");
  let humans = 0;

  for (const vs of guild.voiceStates.cache.values()) {
    if (vs.channelId !== channelId || vs.id === client.user?.id) continue;
    if (multiBotCoordinator.allBotIds?.includes(vs.id)) continue;
    const isBot =
      vs.member?.user?.bot ||
      guild.members.cache.get(vs.id)?.user?.bot ||
      client.users.cache.get(vs.id)?.bot;
    if (!isBot) humans++;
  }

  return humans;
}

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
        if (player && !is247) {
          player.destroy("Bot disconnected from voice channel").catch(() => {});
        }
        const timeoutKey = `${guildId}_${client.user.id}`;
        if (emptyChannelTimeouts.has(timeoutKey)) {
          clearTimeout(emptyChannelTimeouts.get(timeoutKey));
          emptyChannelTimeouts.delete(timeoutKey);
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
      // 3. Listener Monitoring & Smart Auto-Pause / Auto-Resume
      // -------------------------------------------------------------------------
      if (!player.voiceChannelId) return;

      // Count non-bot members using the live gateway voiceStates cache (reliable
      // across 1M+ servers, and independent of the bounded member cache).
      const listeningChannelId = player.voiceChannelId;
      const humanListeners = countHumanListeners(client, newState.guild, listeningChannelId);

      const timeoutKey = `${guildId}_${client.user.id}`;

      // If 24/7 mode is active, do not leave
      if (player.get("247")) {
        if (emptyChannelTimeouts.has(timeoutKey)) {
          clearTimeout(emptyChannelTimeouts.get(timeoutKey));
          emptyChannelTimeouts.delete(timeoutKey);
        }
        return;
      }

      if (humanListeners === 0) {
        // Auto-pause audio stream to conserve CPU and network bandwidth
        if (player.playing && !player.paused) {
          await player.pause().catch(() => {});
          player.set("autoPaused", true);
          logger.info(`Auto-paused playback in guild ${guildId} because voice channel is empty.`);
        }

        // Set cool idle VC status when bot is left alone in voice channel
        const voiceStatusManager = require("../../utils/voiceStatusManager");
        voiceStatusManager.setIdleVoiceStatus(client, player.voiceChannelId, guildId);

        if (!emptyChannelTimeouts.has(timeoutKey)) {
          logger.info(`Voice channel empty in guild ${guildId} for ${client.user.username}. Starting 2-minute auto-leave timer.`);
          
          if (player.textChannelId) {
            const textChannel = newState.guild.channels.cache.get(player.textChannelId);
            if (textChannel) {
              textChannel.send({
                embeds: [
                  warnEmbed(
                    "Voice channel is empty! Playback is auto-paused. The bot will disconnect in 2 minutes if no one rejoins.",
                    "Empty Channel"
                  ),
                ],
              }).then((m) => setTimeout(() => m.delete().catch(() => {}), 15000)).catch(() => {});
            }
          }

          const timeout = setTimeout(async () => {
            // Re-count against the channel this timer was armed for: the player
            // may have been moved since, and a stale count would leave the bot
            // connected (or disconnect it from an occupied channel).
            const stillHumanListeners = countHumanListeners(client, newState.guild, listeningChannelId);

            if (stillHumanListeners === 0) {
              logger.info(`Auto-leaving voice channel in guild ${guildId} for ${client.user.username} due to inactivity.`);
              player.destroy("Voice channel left empty").catch(() => {});
            }
            emptyChannelTimeouts.delete(timeoutKey);
          }, config.player.emptyChannelTimeoutMs);

          emptyChannelTimeouts.set(timeoutKey, timeout);
        }
      } else {
        // Humans returned, cancel timeout and auto-resume if previously paused
        if (emptyChannelTimeouts.has(timeoutKey)) {
          logger.info(`Human listeners present (${humanListeners}) in guild ${guildId}. Cancelling auto-leave timer.`);
          clearTimeout(emptyChannelTimeouts.get(timeoutKey));
          emptyChannelTimeouts.delete(timeoutKey);
        }

        if (player.paused && player.get("autoPaused")) {
          await player.resume();
          player.set("autoPaused", false);
          logger.info(`Auto-resumed playback in guild ${guildId} because listener joined.`);
          const voiceStatusManager = require("../../utils/voiceStatusManager");
          voiceStatusManager.onResume(client, player);
        }
      }
    });
  },
};
