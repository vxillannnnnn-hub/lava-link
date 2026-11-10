const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { errorText, actionWithButton } = require("../../utils/responses");
const { formatDuration, getSourceBadge, truncate } = require("../../utils/formatters");
const emojis = require("../../utils/emojis");

// Lock buttons reject non-http(s) values; normalise Lavalink identifiers first.
function safeHttpUrl(url, fallback = "https://discord.com") {
  if (typeof url === "string") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    } catch (_) {
      // fall through
    }
  }
  return fallback;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("grab")
    .setDescription("Save the currently playing track to your private Direct Messages"),

  async execute(interaction, client) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.queue.current) {
      return interaction.reply(errorText("No song is currently streaming in this server."));
    }

    const track = player.queue.current;
    const cleanTitle = truncate(track.info.title, 60);
    const uri = safeHttpUrl(track.info.uri);

    // The DM below is a second REST call that can be rate limited, so ack the
    // interaction first instead of racing Discord's 3s window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const dmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Song")
          .setURL(uri)
      );

      const dmContent =
        `${emojis.save} **Saved Track: [${cleanTitle}](${uri})**\n` +
        `• **Artist:** \`${track.info.author || "Unknown"}\`\n` +
        `• **Duration:** \`${formatDuration(track.info.duration)}\`\n` +
        `• **Platform:** ${getSourceBadge(track.info.sourceName)}\n` +
        `• **Saved from:** \`${interaction.guild.name}\`\n\n` +
        `-# Click below to open and listen on your favorite music platform!`;

      await interaction.user.send({
        content: dmContent,
        components: [dmRow],
        flags: MessageFlags.SuppressEmbeds,
        allowedMentions: { parse: [], users: [] },
      });

      return interaction.editReply(
        actionWithButton(
          emojis.save,
          `Sent **[${cleanTitle}](${uri})** straight to your Direct Messages!`,
          "Check your private DMs to listen anytime",
          {
            label: "Open Track",
            url: uri,
          },
          { ephemeral: true }
        )
      );
    } catch (err) {
      return interaction.editReply(
        errorText(
          "Could not deliver Direct Message!",
          "Please ensure your Discord privacy settings allow Direct Messages from server members."
        )
      );
    }
  },
};
