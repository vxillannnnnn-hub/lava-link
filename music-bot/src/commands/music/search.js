const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const { trackEnqueuedEmbed, errorEmbed } = require("../../utils/embed");
const { formatDuration, truncate } = require("../../utils/formatters");
const { getPlatformTheme, cleanTrackTitle } = require("../../utils/sourceManager");
const { handleSearchAutocomplete } = require("../../utils/searchAutocomplete");
const emojis = require("../../utils/emojis");
const config = require("../../config");
const audioQuality = require("../../utils/audioQuality");

/**
 * Discord rejects non-http(s) thumbnail URLs (and nodes can report relative
 * artwork paths), which would fail the whole search menu payload.
 */
function safeHttpUrl(url) {
  if (typeof url === "string") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    } catch (_) {
      // fall through
    }
  }
  return null;
}

// Store active search results in memory temporarily
const activeSearches = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search tracks across Spotify, YouTube, SoundCloud, or JioSaavn with interactive menu")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("The song or artist to search for")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("source")
        .setDescription("Streaming platform to query")
        .addChoices(
          { name: "Spotify", value: "spsearch" },
          { name: "YouTube", value: "ytsearch" },
          { name: "SoundCloud", value: "scsearch" },
          { name: "JioSaavn", value: "jssearch" }
        )
    ),

  /**
   * Real-time search autocomplete for search input
   */
  async autocomplete(interaction, client) {
    return handleSearchAutocomplete(interaction, client);
  },

  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    if (!query || !query.trim()) {
      return interaction.reply({
        content: `${emojis.warn} Provide a song name or a link to search for.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    const forcedSource = interaction.options.getString("source") || audioQuality.resolvePlaybackPlatform();
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: `${emojis.warn} You need to be in a voice channel to search music!`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    const me = interaction.guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return interaction.reply({
        content: `${emojis.cross} I lack permission to **Connect** to <#${voiceChannel.id}>.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    if (!perms?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply({
        content: `${emojis.cross} I lack permission to **Speak** in <#${voiceChannel.id}>.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) {
      player = client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: config.player.defaultVolume,
      });
    }

    if (!player.connected) {
      await player.connect();
    }

    const isUrl = /^https?:\/\//i.test(query);
    const isPrefixed = /^(ytsearch|ytmsearch|spsearch|scsearch|jssearch):/i.test(query);
    const searchPrefixed = isUrl || isPrefixed ? query : `${forcedSource}:${query}`;
    let searchRes = await player.search({ query: searchPrefixed }, interaction.user);

    // Fallback to YouTube if initial platform returned empty
    if ((!searchRes || !searchRes.tracks || searchRes.tracks.length === 0) && forcedSource !== "ytsearch") {
      searchRes = await player.search({ query: `ytsearch:${query}` }, interaction.user);
    }

    if (!searchRes || !searchRes.tracks || searchRes.tracks.length === 0) {
      return interaction.editReply({
        content: `${emojis.cross} No search results found for \`${query}\`.`,
      });
    }

    const tracks = searchRes.tracks.slice(0, 10);
    const firstTheme = getPlatformTheme(tracks[0]?.info?.sourceName);
    const searchId = `${interaction.guildId}_${interaction.user.id}_${Date.now()}`;
    activeSearches.set(searchId, { tracks, player, userId: interaction.user.id });

    // Clean up cache after 60 seconds (unref'd so it never holds the process open)
    const searchCacheTimer = setTimeout(() => activeSearches.delete(searchId), 60000);
    if (searchCacheTimer.unref) searchCacheTimer.unref();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_search_${searchId}`)
      .setPlaceholder("Choose a track to enqueue...");

    const descriptionLines = [];

    tracks.forEach((track, index) => {
      const cleanTitle = truncate(cleanTrackTitle(track.info.title), 40);
      const cleanAuthor = truncate(track.info.author, 22);
      const duration = track.info.duration;
      const durationDisplay = formatDuration(duration);
      // Duration badge: LIVE, SHORT, or LONG
      let durationBadge = "";
      if (track.info.isStream) {
        durationBadge = emojis.live + " LIVE";
      } else if (duration && duration > 0) {
        const durMinutes = Math.round(duration / 60000);
        if (durMinutes <= 3) {
          durationBadge = emojis.short + " Short";
        } else if (durMinutes > 10) {
          durationBadge = emojis.long + " Long";
        }
      }

      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${index + 1}. ${cleanTitle}`)
          .setDescription(`${cleanAuthor} • ${formatDuration(duration)}`)
          .setValue(index.toString())
          .setEmoji(emojis.music)
      );

      descriptionLines.push(
        `\`${index + 1}.\` ${cleanTitle} - \`${cleanAuthor}\` (\`${duration}\`)`
      );
    });

    // Compact landscape search embed
    const embed = new EmbedBuilder()
      .setColor(config.colors.surface || 0x2b2d31)
      .setAuthor({
        name: `Interactive Search • ${firstTheme.name}`,
        iconURL: firstTheme.icon,
      })
      .setTitle(`Results for "${truncate(query, 40)}"`)
      .setDescription(
        descriptionLines.join("\n") +
        "\n\n-# Select a track from the dropdown below within 60 seconds."
      )
      .setTimestamp();

    const artworkUrl = safeHttpUrl(tracks[0]?.info?.artworkUrl);
    if (artworkUrl) {
      embed.setThumbnail(artworkUrl);
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [], users: [] },
    });
  },

  async handleMenuSelect(interaction, client) {
    const searchId = interaction.customId.replace("select_search_", "");
    const searchData = activeSearches.get(searchId);

    if (!searchData) {
      return interaction.reply({
        content: `${emojis.cross} This search menu has expired. Please run \`/search\` again.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    if (interaction.user.id !== searchData.userId) {
      return interaction.reply({
        content: `${emojis.warn} Only the user who initiated this search can select a track.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    const selectedIndex = parseInt(interaction.values[0], 10);
    const chosenTrack = searchData.tracks[selectedIndex];

    if (!chosenTrack) {
      return interaction.reply({
        content: `${emojis.cross} Track not found.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    // A second voice channel must not hijack an active session's playback.
    const memberVoiceChannelId = interaction.member?.voice?.channelId;
    const connectedPlayer = client.lavalink.getPlayer(interaction.guildId);
    if (
      connectedPlayer?.connected &&
      connectedPlayer.voiceChannelId &&
      memberVoiceChannelId !== connectedPlayer.voiceChannelId
    ) {
      return interaction.reply({
        content: `${emojis.warn} I am already playing in <#${connectedPlayer.voiceChannelId}>. Join that channel to add tracks.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    let player = client.lavalink.getPlayer(interaction.guildId);
    if (!player || !player.connected) {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          content: `${emojis.cross} Audio player was disconnected. Please join a voice channel and run \`/play\` again.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }

      // Never create a second player for one guild: reconnect the existing one.
      if (player) {
        player.voiceChannelId = voiceChannel.id;
        player.textChannelId = interaction.channelId || player.textChannelId;
        await player.connect();
      } else {
        player = client.lavalink.createPlayer({
          guildId: interaction.guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId,
          selfDeaf: true,
          volume: config.player.defaultVolume,
        });
        await player.connect();
      }
    }

    // Search hits are often metadata previews or low-bitrate mirrors; upgrade
    // to the full-quality source before the track reaches the queue.
    const playableTrack = await audioQuality.ensureFullQualityTrack(
      player,
      chosenTrack,
      interaction.user
    );
    player.queue.add(playableTrack);

    if (!player.playing && !player.paused) {
      const voiceStatusManager = require("../../utils/voiceStatusManager");
      voiceStatusManager.onTrackStart(client, player, playableTrack);
      await player.play();
    }

    activeSearches.delete(searchId);

    const cleanTitle = truncate(cleanTrackTitle(playableTrack.info.title), 40);
    const cleanAuthor = truncate(playableTrack.info.author, 24);
    const uri = playableTrack.info.uri || "https://discord.com";
    const pos = player.queue.tracks.length;

    await interaction.update({
      content: `${emojis.check} Selected and enqueued [**${cleanTitle}**](${uri}) by **${cleanAuthor}**!`,
      embeds: [],
      components: [],
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [], users: [] },
    });

    if (interaction.channel) {
      await interaction.channel.send({
        content: `${emojis.check} Enqueued [**${cleanTitle}**](${uri}) by **${cleanAuthor}** (\`#${pos}\`).\n-# Requested by **${truncate(interaction.user.username, 20)}**`,
        flags: MessageFlags.SuppressEmbeds,
        allowedMentions: { parse: [], users: [] },
      }).catch(() => {});
    }
  },
};
