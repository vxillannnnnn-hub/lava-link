const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const autoplayManager = require("../../utils/autoplayManager");
const { truncate } = require("../../utils/formatters");
const { cleanTrackTitle } = require("../../utils/sourceManager");
const { queueCapacity } = require("../../utils/playerActions");
const config = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("similar")
    .setDescription("Queue tracks similar to the one that is playing right now")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("How many similar tracks to queue (1-10, default 5)")
        .setMinValue(1)
        .setMaxValue(10)
    ),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue?.current) {
      return interaction.reply(
        errorText("Nothing is playing right now. Start a track with `/play` first.")
      );
    }

    const amount = interaction.options.getInteger("amount") || 5;
    const seed = player.queue.current;
    const mode = autoplayManager.getMode(player);

    await interaction.deferReply();

    const recommendations = await autoplayManager.buildRecommendations(player, seed, { amount, mode });

    if (!recommendations.length) {
      return interaction.editReply(
        errorText(
          `Could not find anything similar to **${truncate(cleanTrackTitle(seed.info.title), 40)}**. Try another track or \`/autoplay clear\` to reset the history.`
        )
      );
    }

    const capacity = queueCapacity(player);
    const queued = recommendations.slice(0, capacity);
    if (!queued.length) {
      return interaction.editReply(
        errorText(`The queue is full (${config.player.maxQueueSize} tracks). Wait for it to drain or run \`/clear\`.`)
      );
    }

    player.queue.add(queued);

    const list = queued
      .map(
        (track, index) =>
          `\`${index + 1}.\` ${truncate(cleanTrackTitle(track.info.title), 38)} — ${truncate(
            track.info.author || "Unknown",
            22
          )}`
      )
      .join("\n");

    return interaction.editReply(
      actionText(
        emojis.sparkles,
        `Queued **${queued.length}** similar track(s)`,
        `Based on **${truncate(cleanTrackTitle(seed.info.title), 35)}** • Mode: \`${mode}\`\n${list}`
      )
    );
  },
};
