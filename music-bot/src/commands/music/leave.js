const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Disconnect the bot from the voice channel"),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply(errorText("I am not currently connected to any voice channel in this server."));
    }

    const vcId = player.voiceChannelId;
    if (player.get("247")) {
      player.set("247", false);
      const db = require("../../database/db");
      db.set247(interaction.guildId, false, null, null, client.user.id);
    }
    // destroy() is a node REST call plus a voice close; acknowledge first so a
    // slow node cannot fail the interaction after the bot has already left.
    await interaction.deferReply();
    await player.destroy("User ran /leave command");

    return interaction.editReply(
      actionText(emojis.leave, "Disconnected from voice channel.", vcId ? `Left <#${vcId}>` : null)
    );
  },
};
