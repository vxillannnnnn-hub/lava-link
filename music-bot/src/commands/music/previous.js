const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const { truncate } = require("../../utils/formatters");
const { cleanTrackTitle } = require("../../utils/sourceManager");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("previous")
    .setDescription("Play the previous track from the session history"),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply(errorText("No active music player in this server."));
    }

    const previousTrack = player.queue.previous[0];
    if (!previousTrack) {
      return interaction.reply(errorText("No previous track found in the session history buffer."));
    }

    const djCheck = djManager.canManagePlayer(interaction.member, player, false);
    if (!djCheck.allowed) {
      return interaction.reply(errorText(djCheck.reason));
    }

    // Keep the interrupted song so the listener can return to it.
    const interruptedTrack = player.queue.current;
    const voiceStatusManager = require("../../utils/voiceStatusManager");
    voiceStatusManager.onTrackStart(client, player, previousTrack);
    await player.play({ track: previousTrack });
    if (
      interruptedTrack &&
      interruptedTrack.info?.identifier !== previousTrack.info?.identifier
    ) {
      player.queue.add(interruptedTrack, 0);
    }
    const title = truncate(cleanTrackTitle(previousTrack.info.title), 40);
    const author = truncate(previousTrack.info.author, 24);

    return interaction.reply(
      actionText(emojis.previous, `Playing previous track: **${title}** by **${author}**.`)
    );
  },
};
