const { SlashCommandBuilder, ButtonStyle } = require("discord.js");
const { actionWithButtons, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const djManager = require("../../utils/djManager");
const volumeManager = require("../../utils/volumeManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("View or adjust the playback volume (100% = unity gain, up to the bonus ceiling)")
    .addIntegerOption((option) =>
      option
        .setName("level")
        .setDescription(
          `Volume percentage between 0 and ${volumeManager.MAX_VOLUME} (above 100% adds digital gain and can clip)`
        )
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(volumeManager.MAX_VOLUME)
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
          `100% is unity gain (lossless Opus passthrough). Up to **${volumeManager.MAX_VOLUME}%** is allowed, but that is digital gain: loud tracks can clip. Presets below:`,
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

    // `gainNotice` states the real trade-off for the requested level: unity is
    // lossless, attenuation re-encodes, and a boost can clip.
    const sub = volumeManager.gainNotice(result);

    return interaction.reply(
      actionWithButtons(emoji, `Volume set to **${result.applied}%**.`, sub, [
        { customId: "pctrl_vol_50", label: "50%", emoji: emojis.volume.low, style: ButtonStyle.Secondary },
        { customId: "pctrl_vol_75", label: "75%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
        { customId: "pctrl_vol_100", label: "100%", emoji: emojis.volume.normal, style: ButtonStyle.Secondary },
      ])
    );
  },
};
