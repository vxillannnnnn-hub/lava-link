const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { actionText, errorText, warnText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const config = require("../../config");
const audioOptimizer = require("../../utils/audioOptimizer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Summon the bot to your current voice channel"),

  async execute(interaction, client) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply(errorText("You must join a voice channel first!"));
    }

    const me = interaction.guild.members.me;
    const permissions = voiceChannel.permissionsFor(me || client.user.id);
    if (!permissions?.has(PermissionFlagsBits.Connect)) {
      return interaction.reply(errorText(`I lack permission to **Connect** to <#${voiceChannel.id}>.`));
    }
    if (!permissions?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply(errorText(`I lack permission to **Speak** in <#${voiceChannel.id}>.`));
    }

    const multiBotCoordinator = require("../../utils/multiBotCoordinator");
    const otherBotInVC = (multiBotCoordinator.clients || []).find((c) => {
      if (c.user?.id === client.user.id) return false;
      const vs = interaction.guild.voiceStates.cache.get(c.user?.id);
      return vs && vs.channelId === voiceChannel.id;
    });

    if (otherBotInVC) {
      return interaction.reply(
        warnText(
          `Another bot (${otherBotInVC.user.username}) is already active in <#${voiceChannel.id}>! Each bot manages its own voice channel.`
        )
      );
    }

    let player = client.lavalink.getPlayer(interaction.guildId);

    // A player can exist with a dead voice connection; creating a second player
    // for the same guild is invalid, so reconnect the existing one instead.
    if (player && player.connected && player.voiceChannelId === voiceChannel.id) {
      return interaction.reply(warnText("I am already connected to your voice channel!"));
    }

    // connect() is a node REST call plus a voice handshake and can exceed the 3s
    // interaction window on a cold node, so acknowledge before doing it.
    await interaction.deferReply();

    if (player) {
      player.voiceChannelId = voiceChannel.id;
      player.textChannelId = interaction.channelId;
      await player.connect();
      audioOptimizer.maximizeVoiceBitrate(voiceChannel, client);

      const db = require("../../database/db");
      const current247 = db.get247(interaction.guildId, client.user.id);
      if (current247.enabled) {
        db.set247(interaction.guildId, true, voiceChannel.id, interaction.channelId, client.user.id);
      }

      return interaction.editReply(
        actionText(emojis.volumeNormal, `Moved to voice channel <#${voiceChannel.id}>.`)
      );
    }

    player = client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: config.player.defaultVolume,
    });
    player.set("autoplay", config.player.defaultAutoplay ?? false);

    await player.connect();
    player.set("ownerId", interaction.user?.id || interaction.author?.id);
    audioOptimizer.maximizeVoiceBitrate(voiceChannel, client);
    const voiceStatusManager = require("../../utils/voiceStatusManager");
    voiceStatusManager.setIdleVoiceStatus(client, voiceChannel.id, interaction.guildId);

    return interaction.editReply(
      actionText(emojis.volumeNormal, `Connected to <#${voiceChannel.id}>.`, "Use `/play` to stream audio")
    );
  },
};
