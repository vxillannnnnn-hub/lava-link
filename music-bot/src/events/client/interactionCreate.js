const { handlePlayerButton, handleFilterSelect } = require("../../utils/playerController");
const { errorText, warnText } = require("../../utils/responses");
const { runWithClient } = require("../../utils/emojis");
const logger = require("../../utils/logger");

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    return runWithClient(client, async () => {
    // -------------------------------------------------------------------------
    // 1. Slash Command Autocomplete Handling
    // -------------------------------------------------------------------------
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command && typeof command.autocomplete === "function") {
        try {
          await command.autocomplete(interaction, client);
        } catch (err) {
          logger.error(`Autocomplete error for /${interaction.commandName}:`, err.message);
        }
      } else {
        // Discord requires an acknowledge for every autocomplete interaction.
        // Staying silent leaves the user with "This interaction failed".
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 2. Interactive Button Handling
    // -------------------------------------------------------------------------
    if (interaction.isButton()) {
      try {
        await handlePlayerButton(interaction, client);
      } catch (err) {
        logger.error(`Button error [${interaction.customId}]:`, err);
        const replyPayload = errorText(`An error occurred while processing this button: ${err.message}`);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyPayload).catch(() => {});
        } else {
          await interaction.reply(replyPayload).catch(() => {});
        }
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 3. String Select Menu Handling
    // -------------------------------------------------------------------------
    if (interaction.isStringSelectMenu()) {
      try {
        if (interaction.customId === "select_filter" || interaction.customId === "ctrl_select_filter") {
          await handleFilterSelect(interaction, client);
          return;
        }

        // Generic select menu routing (e.g., search command results or help command)
        if (interaction.customId.startsWith("select_search_")) {
          const searchCmd = client.commands.get("search");
          if (searchCmd && typeof searchCmd.handleMenuSelect === "function") {
            await searchCmd.handleMenuSelect(interaction, client);
            return;
          }
        }

        if (interaction.customId === "select_help_category") {
          const helpCmd = client.commands.get("help");
          if (helpCmd && typeof helpCmd.handleCategorySelect === "function") {
            await helpCmd.handleCategorySelect(interaction, client);
            return;
          }
        }
      } catch (err) {
        logger.error(`SelectMenu error [${interaction.customId}]:`, err);
        const replyPayload = errorText(`Menu selection failed: ${err.message}`);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyPayload).catch(() => {});
        } else {
          await interaction.reply(replyPayload).catch(() => {});
        }
      }
      return;
    }

    // -------------------------------------------------------------------------
    // 4. Slash Chat Input Command Handling
    // -------------------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        return interaction.reply(errorText(`Command \`/${interaction.commandName}\` does not exist.`));
      }

      // Voice channel checks for music playback/control commands (excludes non-voice management/informational commands, 247, and join)
      const exemptMusicCommands = ["nowplaying", "queue", "lyrics", "grab", "setup-channel", "dj", "playlist", "247", "join"];
      if (command.category === "music" && !exemptMusicCommands.includes(command.data.name)) {
        if (!interaction.member?.voice?.channelId) {
          return interaction.reply(
            warnText("You must be connected to a voice channel to use music commands.")
          );
        }

        const player = client.lavalink.getPlayer(interaction.guildId);
        if (player && player.voiceChannelId && interaction.member.voice.channelId !== player.voiceChannelId) {
          return interaction.reply(
            warnText(`You must be in the same voice channel (<#${player.voiceChannelId}>) as the bot to use music controls.`)
          );
        }
      }

      // Anti-Hogging Multi-Bot Ownership Guard for Slash Commands
      if (["play", "join", "search"].includes(command.data.name)) {
        const userVoiceChannelId = interaction.member?.voice?.channelId;
        const player = client.lavalink?.getPlayer(interaction.guildId);
        if (userVoiceChannelId && (!player || player.voiceChannelId !== userVoiceChannelId)) {
          const multiBotCoordinator = require("../../utils/multiBotCoordinator");
          const conflict = multiBotCoordinator.checkUserSessionConflict(interaction.guild, interaction.user.id, userVoiceChannelId);
          if (conflict) {
            const botName = conflict.bot.user?.username || "Pulse";
            return interaction.reply(
              warnText(
                `You already have an active playback session with **${botName}** in <#${conflict.channelId}>.`,
                `Finish that session or ask an administrator to enable multi-room playback using \`/settings multi-ownership enable\`.`
              )
            );
          }
        }
      }

      try {
        await command.execute(interaction, client);
      } catch (err) {
        logger.error(`Execution error for /${interaction.commandName}:`, err);
        const replyPayload = errorText(`Error executing command: \`${err.message}\``);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyPayload).catch(() => {});
        } else {
          await interaction.reply(replyPayload).catch(() => {});
        }
      }
    }
    });
  },
};
