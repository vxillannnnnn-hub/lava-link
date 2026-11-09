const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Configure loop repeat mode for current track or entire queue")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Select repeat mode")
        .setRequired(true)
        .addChoices(
          { name: "Off (Disable repeat)", value: "off" },
          { name: "Track (Repeat currently playing song)", value: "track" },
          { name: "Queue (Repeat the entire queue sequentially)", value: "queue" }
        )
    ),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply(errorText("No active audio player found in this server."));
    }

    const djCheck = djManager.canManagePlayer(interaction.member, player, false);
    if (!djCheck.allowed) {
      return interaction.reply(errorText(djCheck.reason));
    }

    let mode = interaction.options.getString("mode");
    if (mode) {
      mode = mode.toLowerCase();
      if (mode === "song") mode = "track";
    } else {
      // Toggle mode if none provided
      const current = player.repeatMode || "off";
      if (current === "off") mode = "track";
      else if (current === "track") mode = "queue";
      else mode = "off";
    }

    const descriptions = {
      off: { title: "Loop mode turned **OFF**.", sub: "Tracks will play once through sequentially" },
      track: { title: "Loop mode set to **TRACK**.", sub: "Current song will repeat continuously" },
      queue: { title: "Loop mode set to **QUEUE**.", sub: "Entire queue will replay upon reaching the end" },
    };

    if (!descriptions[mode]) {
      return interaction.reply(
        errorText("Invalid loop mode! Available options: `off`, `track`, `queue`.")
      );
    }

    player.setRepeatMode(mode);

    const targetEmoji = mode === "track" ? emojis.loopOne : emojis.loop;
    const info = descriptions[mode];

    return interaction.reply(actionText(targetEmoji, info.title, info.sub));
  },
};
