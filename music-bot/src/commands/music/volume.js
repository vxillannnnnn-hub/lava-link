const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const { actionWithButtons, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");
const volumeManager = require("../../utils/volumeManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("View or adjust the playback volume (0% to 100%, clipping-safe)")
    .addIntegerOption((option) =>
      option
        .setName("level")
        .setDescription("Volume percentage between 0 and 100 (leave blank to view)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(volumeManager.UNITY_VOLUME)
    ),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply(errorText("No active audio player found in this server."));
    }

    const level = interaction.options.getInteger("level");

    // If no volume argument was provided, display current volume with quick-adjust presets
    if (level === null || level === undefined || isNaN(level)) {
      const currentVol = player.volume ?? volumeManager.UNITY_VOLUME;
      const emoji = emojis.getVolumeEmoji(currentVol);
      return interaction.reply(
        actionWithButtons(
          emoji,
          `Current volume is **${currentVol}%**.`,
          "Clipping-safe presets below — anything above 100% would saturate the Opus encoder and distort:",
          [
            { customId: "pctrl_vol_50", label: "50%", emoji: emojis.volume.low, style: ButtonStyle.Secondary },
            { customId: "pctrl_vol_75", label: "75%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
            { customId: "pctrl_vol_100", label: "100%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
          ]
        )
      );
    }

    const djCheck = djManager.canManagePlayer(interaction.member, player, false);
    if (!djCheck.allowed) {
      return interaction.reply(errorText(djCheck.reason));
    }

    const result = await volumeManager.applyVolume(player, level);
    const emoji = emojis.getVolumeEmoji(result.applied);

    const sub = result.capped
      ? volumeManager.capNotice(result)
      : result.applied === volumeManager.UNITY_VOLUME
      ? "Unity gain: bit-exact Opus passthrough, zero distortion"
      : "Attenuated level (no clipping)";

    return interaction.reply(
      actionWithButtons(emoji, `Volume set to **${result.applied}%**.`, sub, [
        { customId: "pctrl_vol_50", label: "50%", emoji: emojis.volume.low, style: ButtonStyle.Secondary },
        { customId: "pctrl_vol_75", label: "75%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
        { customId: "pctrl_vol_100", label: "100%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
      ])
    );
  },
};
