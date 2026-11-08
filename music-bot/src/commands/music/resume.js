const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const { actionWithButton, errorText, warnText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");
const voiceStatusManager = require("../../utils/voiceStatusManager");
const { truncate } = require("../../utils/formatters");
const { cleanTrackTitle } = require("../../utils/sourceManager");

module.exports = {
  data: new SlashCommandBuilder().setName("resume").setDescription("Resume paused audio playback"),
  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return interaction.reply(errorText("No music is currently streaming in this server."));
    }

    const djCheck = djManager.canManagePlayer(interaction.member, player, false);
    if (!djCheck.allowed) {
      return interaction.reply(errorText(djCheck.reason));
    }

    if (!player.paused) {
      return interaction.reply(warnText("Playback is already actively playing!"));
    }

    await player.resume();
    voiceStatusManager.onResume(client, player);

    // Update now playing dashboard immediately and restart real-time progress loop
    const { sendOrUpdatePlayerDashboard, startRealtimeProgressLoop } = require("../../utils/playerController");
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel) sendOrUpdatePlayerDashboard(channel, player).catch(() => {});
    }
    startRealtimeProgressLoop(player, client);

    const trackTitle = truncate(cleanTrackTitle(player.queue.current?.info?.title) || "Current Track", 40);

    return interaction.reply(
      actionWithButton(
        emojis.play,
        "Audio playback resumed.",
        `Streaming: **${trackTitle}**`,
        { customId: "cmd_pause", label: "Pause", emoji: emojis.pause, style: ButtonStyle.Secondary }
      )
    );
  },
};
