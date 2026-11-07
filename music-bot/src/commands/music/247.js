const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { actionText, errorText, warnText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const db = require("../../database/db");
const config = require("../../config");
const audioOptimizer = require("../../utils/audioOptimizer");
const voiceStatusManager = require("../../utils/voiceStatusManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle permanent 24/7 mode so the bot stays connected in voice channel across all restarts"),

  async execute(interaction, client) {
    let player = client.lavalink.getPlayer(interaction.guildId);

    // Identify target voice channel: either member's current VC or existing player VC
    const memberVC = interaction.member.voice?.channel;
    const playerVCId = player?.voiceChannelId;
    const targetVC = memberVC || (playerVCId ? interaction.guild.channels.cache.get(playerVCId) : null);

    if (!targetVC) {
      return interaction.reply(
        errorText(
          "You must be connected to a voice channel to configure 24/7 mode!",
          "Join a voice channel first and run `/247` again."
        )
      );
    }

    const current247 = db.get247(interaction.guildId);
    const newState = !current247.enabled;

    if (newState) {
      // Check bot permissions in target channel
      const perms = targetVC.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        return interaction.reply(errorText(`I lack permission to **Connect** to <#${targetVC.id}>.`));
      }

      // 1. Permanently save to SQLite and JSON mirror
      db.set247(interaction.guildId, true, targetVC.id, interaction.channelId);

      // 2. Create or connect player instance
      if (!player) {
        player = client.lavalink.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: targetVC.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: config.player?.defaultVolume || 100,
        });
      }

      player.set("247", true);
      if (!player.connected) {
        player.voiceChannelId = targetVC.id;
        await player.connect();
      }

      audioOptimizer.maximizeVoiceBitrate(targetVC, client);

      // If idle, set cool idle Voice Channel status
      if (!player.queue?.current) {
        voiceStatusManager.setIdleVoiceStatus(client, targetVC.id, interaction.guildId);
      }

      return interaction.reply(
        actionText(
          emojis.time,
          `24/7 Voice Channel mode **ENABLED** in <#${targetVC.id}>.`,
          "Persistent across all restarts · Bot will automatically reconnect to this voice channel 24/7."
        )
      );
    } else {
      // Disable 24/7 mode in database
      db.set247(interaction.guildId, false, null, null);

      if (player) {
        player.set("247", false);
      }

      return interaction.reply(
        actionText(
          emojis.time,
          "24/7 Voice Channel mode **DISABLED**.",
          "Bot will now automatically disconnect when the queue finishes or the voice channel is empty."
        )
      );
    }
  },
};
