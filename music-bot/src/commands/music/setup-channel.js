const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const db = require("../../database/db");
const { buildPlaceholderPayload } = require("../../utils/requestChannelManager");
const { errorText, successText, actionWithButton } = require("../../utils/responses");
const emojis = require("../../utils/emojis");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup-channel")
    .setDescription("Configure a dedicated song-request channel with a permanent Eara-style player dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Select an existing channel (leave blank to auto-create #pulse-requests)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Setup or remove request channel")
        .addChoices(
          { name: "Setup / Link Channel", value: "setup" },
          { name: "Remove / Reset Channel", value: "remove" }
        )
        .setRequired(false)
    ),

  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply(
        errorText("You need **Manage Server** permissions to configure the song request channel.")
      );
    }

    const action = interaction.options.getString("action") || "setup";

    if (action === "remove") {
      db.clearRequestChannel(interaction.guildId);
      return interaction.reply(
        successText(
          "Dedicated song-request channel configuration removed.",
          "Request channel reset to standard text channel.",
          { ephemeral: true }
        )
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let channel = interaction.options.getChannel("channel");
    const me = interaction.guild.members.me;

    // If channel not specified, create a dedicated channel
    if (!channel) {
      if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply(
          errorText(
            "Missing **Manage Channels** permission to auto-create `#pulse-requests`.",
            "Please either grant the bot **Manage Channels** or specify an existing text channel using `/setup-channel channel:#your-channel`."
          )
        );
      }

      try {
        channel = await interaction.guild.channels.create({
          name: "pulse-requests",
          type: ChannelType.GuildText,
          topic: "Type song names or paste links here to play instantly. Messages auto-clean!",
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ],
        });
      } catch (err) {
        return interaction.editReply(
          errorText(`Failed to auto-create channel: ${err.message}`, "Please specify an existing text channel.")
        );
      }
    }

    // Verify bot permissions in the target channel
    const perms = channel.permissionsFor(me);
    const requiredPerms = [
      { bit: PermissionFlagsBits.ViewChannel, name: "View Channel" },
      { bit: PermissionFlagsBits.SendMessages, name: "Send Messages" },
      { bit: PermissionFlagsBits.EmbedLinks, name: "Embed Links" },
      { bit: PermissionFlagsBits.ReadMessageHistory, name: "Read Message History" },
      { bit: PermissionFlagsBits.ManageMessages, name: "Manage Messages (for auto-clearing requests)" },
    ];

    const missing = requiredPerms.filter((p) => !perms?.has(p.bit)).map((p) => p.name);
    if (missing.length > 0) {
      return interaction.editReply(
        errorText(
          `Missing required permissions in <#${channel.id}>:`,
          `Please grant the bot: **${missing.join(", ")}** in this channel to ensure smooth operation.`
        )
      );
    }

    // Post the permanent interactive player dashboard
    try {
      const payload = buildPlaceholderPayload();
      const msg = await channel.send(payload);

      // Pin the dashboard for visibility
      await msg.pin().catch(() => {});

      // Save in SQLite database
      db.setRequestChannel(interaction.guildId, channel.id, msg.id);

      return interaction.editReply(
        actionWithButton(
          emojis.equalizer,
          `Dedicated song request channel configured in <#${channel.id}>!`,
          "Interactive player card is live · Auto-cleans song request messages · Just type song names",
          {
            url: `https://discord.com/channels/${interaction.guildId}/${channel.id}`,
            label: "Jump to Channel",
          }
        )
      );
    } catch (err) {
      return interaction.editReply(
        errorText(`Failed to initialize dashboard in <#${channel.id}>: ${err.message}`)
      );
    }
  },
};
