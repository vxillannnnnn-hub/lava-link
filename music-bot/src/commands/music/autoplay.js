const { SlashCommandBuilder } = require("discord.js");
const { actionText, errorText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const autoplayManager = require("../../utils/autoplayManager");
const { truncate } = require("../../utils/formatters");
const { cleanTrackTitle } = require("../../utils/sourceManager");
const djManager = require("../../utils/djManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Configure AI Autoplay for continuous related music recommendations")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("toggle")
        .setDescription("Toggle autoplay on or off")
        .addBooleanOption((option) =>
          option.setName("enabled").setDescription("Explicitly enable or disable autoplay")
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("View current autoplay configuration and seed song")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription("Clear guild autoplay history buffer")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("mode")
        .setDescription("Choose how recommendations are picked")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("radio = endless mix, artist = same artist, discover = new artists")
            .setRequired(true)
            .addChoices(
              { name: "Radio (endless mix, default)", value: "radio" },
              { name: "Artist (same artist catalogue)", value: "artist" },
              { name: "Discover (avoid the seed artist)", value: "discover" }
            )
        )
    ),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply(errorText("No active audio player found in this server. Use `/play` first."));
    }

    const subcommand = interaction.options.getSubcommand() || "toggle";

    // Autoplay and its mode change what everyone hears, so they follow the
    // same DJ protection as the rest of the playback controls.
    if (subcommand === "toggle" || subcommand === "mode") {
      const djCheck = djManager.canManagePlayer(interaction.member, player, false);
      if (!djCheck.allowed) {
        return interaction.reply(errorText(djCheck.reason));
      }
    }

    if (subcommand === "toggle") {
      const explicitState = interaction.options.getBoolean("enabled");
      const currentState = Boolean(player.get("autoplay"));
      const newState = explicitState !== null ? explicitState : !currentState;

      player.set("autoplay", newState);

      const seedTrack = player.queue.current || player.queue.previous[0] || player.get("lastPlayedTrack");
      if (newState && seedTrack) {
        if (!player.playing && player.queue.tracks.length === 0) {
          await autoplayManager.executeAutoplay(player, seedTrack, false, client);
        } else {
          await autoplayManager.prefetchAutoplay(player, seedTrack, client);
        }
      }

      return interaction.reply(
        actionText(
          emojis.autoplay,
          `Autoplay recommendations **${newState ? "ENABLED" : "DISABLED"}**.`,
          newState
            ? "Similar tracks will stream automatically when the active queue finishes"
            : "Playback will halt once the queue ends"
        )
      );
    }

    if (subcommand === "mode") {
      const mode = interaction.options.getString("mode");
      if (!autoplayManager.setMode(player, mode)) {
        return interaction.reply(errorText("Unknown autoplay mode. Use `radio`, `artist` or `discover`."));
      }

      return interaction.reply(
        actionText(
          emojis.autoplay,
          `Autoplay mode set to **${autoplayManager.describeMode(mode)}**`,
          mode === "artist"
            ? "Recommendations will stay inside the seed artist's catalogue"
            : mode === "discover"
              ? "Recommendations will avoid the seed artist to surface new artists"
              : "Recommendations will follow the platform radio mix"
        )
      );
    }

    if (subcommand === "status") {
      const isEnabled = Boolean(player.get("autoplay"));
      const historyCount = autoplayManager.getHistorySize(player.guildId);
      const mode = autoplayManager.getMode(player);
      const poolSize = autoplayManager.getPoolSize(player);
      const rawSeed = player.queue.current?.info?.title || player.get("lastPlayedTrack")?.info?.title || "None (Waiting for playback)";
      const seedTitle = truncate(cleanTrackTitle(rawSeed), 40);

      return interaction.reply(
        actionText(
          emojis.autoplay,
          `Autoplay status: **${isEnabled ? "ACTIVE" : "INACTIVE"}**`,
          `Mode: **${autoplayManager.describeMode(mode)}** • Signal: **${autoplayManager.describeSignal()}**\n` +
            `Seed: **${seedTitle}** • Pool: \`${poolSize}\` ready • History: \`${historyCount}/100\``,
          { ephemeral: true }
        )
      );
    }

    if (subcommand === "clear") {
      autoplayManager.clearHistory(player.guildId);
      player.set("autoplayPool", null);
      return interaction.reply(
        actionText(
          emojis.reset,
          "Cleared autoplay playback history cache.",
          "All related tracks can now be recommended fresh",
          { ephemeral: true }
        )
      );
    }
  },
};
