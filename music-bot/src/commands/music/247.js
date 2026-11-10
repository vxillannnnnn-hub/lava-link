const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { actionText, errorText, warnText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const db = require("../../database/db");
const config = require("../../config");
const audioOptimizer = require("../../utils/audioOptimizer");
const voiceStatusManager = require("../../utils/voiceStatusManager");
const multiBotCoordinator = require("../../utils/multiBotCoordinator");
const djManager = require("../../utils/djManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Toggle permanent 24/7 mode so the bot stays connected in voice channel across all restarts"),

  async execute(interaction, client) {
    let player = client.lavalink.getPlayer(interaction.guildId);

    // 24/7 is a server-level setting that survives restarts, so it takes the
    // same admin gate as /setup-channel. An existing session's DJ may also
    // toggle it, which keeps the normal "DJ parks the bot" workflow working.
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) {
      const djCheck = player
        ? djManager.canManagePlayer(interaction.member, player, false)
        : { allowed: false };
      if (!djCheck.allowed) {
        return interaction.reply(
          errorText("You need **Manage Server** or DJ permissions to change 24/7 mode.")
        );
      }
    }

    // Identify target voice channel: either member's current VC or existing player VC
    const memberVC = interaction.member?.voice?.channel;
    const playerVCId = player?.voiceChannelId;
    const targetVC = memberVC || (playerVCId ? interaction.guild.channels.cache.get(playerVCId) : null);

    if (!targetVC) {
      return interaction.reply(
        errorText(
          "You must be connected to a voice channel to configure 24/7 mode!",
          "Join a voice channel first and run `/247` again."
        )
      );
    }

    const botId = client.user.id;
    const current247 = db.get247(interaction.guildId, botId);

    // If this bot is already 24/7 in this exact channel, toggle it off.
    // If this bot is 24/7 in a different channel, move it to this new channel.
    // If this bot does not have 24/7 enabled, turn it on!
    let newState;
    if (current247.enabled && current247.voiceChannelId === targetVC.id) {
      newState = false;
    } else {
      newState = true;
    }

    if (newState) {
      // Fleet conflict check: ensure another bot from our fleet is not already connected to targetVC
      const fleetClients = multiBotCoordinator.clients || [];
      const otherBotInVC = fleetClients.find((c) => {
        if (c.user?.id === botId) return false;
        const vs = interaction.guild.voiceStates.cache.get(c.user?.id);
        return vs && vs.channelId === targetVC.id;
      });

      if (otherBotInVC) {
        return interaction.reply(
          warnText(
            `Another bot (${otherBotInVC.user.username}) is already active in <#${targetVC.id}>! Each bot manages its own voice channel.`
          )
        );
      }

      // Check bot permissions in target channel
      const perms = targetVC.permissionsFor(interaction.guild.members.me || client.user.id);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        return interaction.reply(errorText(`I lack permission to **Connect** to <#${targetVC.id}>.`));
      }

      // Voice handshake + node REST happen below, so acknowledge first: the
      // reply would otherwise race Discord's 3s window on a cold node.
      await interaction.deferReply();

      // 1. Permanently save to SQLite and JSON mirror for THIS bot
      db.set247(interaction.guildId, true, targetVC.id, interaction.channelId, botId);

      // 2. Create or connect player instance
      if (!player) {
        player = client.lavalink.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: targetVC.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: config.player?.defaultVolume || 100,
        });
      }

      player.set("247", true);
      if (!player.connected || player.voiceChannelId !== targetVC.id) {
        player.voiceChannelId = targetVC.id;
        await player.connect();
      }

      audioOptimizer.maximizeVoiceBitrate(targetVC, client);

      // If idle, set cool idle Voice Channel status
      if (!player.queue?.current) {
        voiceStatusManager.setIdleVoiceStatus(client, targetVC.id, interaction.guildId);
      }

      const botTag = client.user.username || "Bot";
      return interaction.editReply(
        actionText(
          emojis.time,
          `24/7 Voice Channel mode **ENABLED** for **${botTag}** in <#${targetVC.id}>.`,
          "Persistent across all restarts · This bot will automatically reconnect to this voice channel 24/7."
        )
      );
    } else {
      // Disable 24/7 mode in database for THIS bot
      db.set247(interaction.guildId, false, null, null, botId);

      if (player) {
        player.set("247", false);
      }

      const botTag = client.user.username || "Bot";
      return interaction.reply(
        actionText(
          emojis.time,
          `24/7 Voice Channel mode **DISABLED** for **${botTag}**.`,
          "Bot will now automatically disconnect when the queue finishes or the voice channel is empty."
        )
      );
    }
  },
};
