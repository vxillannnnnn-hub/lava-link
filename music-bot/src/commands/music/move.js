const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const { truncate } = require("../../utils/formatters");
const { cleanTrackTitle } = require("../../utils/sourceManager");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .addIntegerOption((option) =>
      option.setName("from").setDescription("Current position number").setRequired(true).setMinValue(1)
    )
    .addIntegerOption((option) =>
      option.setName("to").setDescription("Destination position number in queue").setRequired(true).setMinValue(1)
    ),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || player.queue.tracks.length < 2) {
      return interaction.reply(errorText("Queue needs at least 2 tracks to move positions."));
    }

    const djCheck = djManager.canManagePlayer(interaction.member, player, false);
    if (!djCheck.allowed) {
      return interaction.reply(errorText(djCheck.reason));
    }

    const from = interaction.options.getInteger("from");
    const to = interaction.options.getInteger("to");
    const total = player.queue.tracks.length;

    if (!from || !to || from < 1 || to < 1 || from > total || to > total) {
      return interaction.reply(errorText(`Positions must be valid numbers between 1 and ${total}.`));
    }

    if (from === to) {
      return interaction.reply(errorText("Origin and destination positions are identical."));
    }

    const track = player.queue.tracks.splice(from - 1, 1)[0];
    player.queue.tracks.splice(to - 1, 0, track);
    const title = truncate(cleanTrackTitle(track.info.title), 38);

    return interaction.reply(
      actionText(emojis.queue, `Moved **${title}** from position **#${from}** to **#${to}**.`)
    );
  },
};
