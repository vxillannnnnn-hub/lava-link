const { SlashCommandBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { actionWithButton, errorText } = require("../../utils/responses");
const { formatDuration, truncate } = require("../../utils/formatters");
const { detectSource, getPlatformTheme, cleanTrackTitle } = require("../../utils/sourceManager");
const { handleSearchAutocomplete } = require("../../utils/searchAutocomplete");
const emojis = require("../../utils/emojis");
const config = require("../../config");
const logger = require("../../utils/logger");
const audioOptimizer = require("../../utils/audioOptimizer");
const audioQuality = require("../../utils/audioQuality");
const { queueCapacity } = require("../../utils/playerActions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play any track, album, playlist, or stream (Spotify, YouTube, SoundCloud, JioSaavn)")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, artist, or direct URL (Spotify, YouTube, SoundCloud, JioSaavn)")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("source")
        .setDescription("Force search platform (defaults to auto / Spotify)")
        .addChoices(
          { name: "Spotify (Full Track Audio)", value: "spsearch" },
          { name: "YouTube (Videos & Music)", value: "ytsearch" },
          { name: "SoundCloud (Independent & Mixes)", value: "scsearch" },
          { name: "JioSaavn (Bollywood & Indian)", value: "jssearch" }
        )
    ),

  /**
   * Ultra-Low-Latency Autocomplete (< 1ms cache response, dual Lavalink & Google resolver)
   */
  async autocomplete(interaction, client) {
    return handleSearchAutocomplete(interaction, client);
  },

  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    if (!query || !query.trim()) {
      return interaction.reply(
        errorText("Provide a song name or a link.", "Example: `/play query:never gonna give you up` or `.play <song>`")
      );
    }
    const forcedSource = interaction.options.getString("source");
    const member = interaction.member;
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply(errorText("You need to be in a voice channel to play music!"));
    }

    const me = interaction.guild.members.me;
    const permissions = voiceChannel.permissionsFor(me || client.user.id);
    if (!permissions?.has(PermissionFlagsBits.Connect)) {
      return interaction.reply(errorText(`I lack permission to **Connect** to <#${voiceChannel.id}>.`));
    }
    if (!permissions?.has(PermissionFlagsBits.Speak)) {
      return interaction.reply(errorText(`I lack permission to **Speak** in <#${voiceChannel.id}>.`));
    }

    await interaction.deferReply();

    // Create or retrieve player
    let player = client.lavalink.getPlayer(interaction.guildId);
    let createdPlayer = false;

    if (!player) {
      createdPlayer = true;
      player = client.lavalink.createPlayer({
        guildId: interaction.guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: config.player.defaultVolume,
      });
      player.set("autoplay", config.player.defaultAutoplay ?? false);
    } else if (player.get("autoplay") === undefined) {
      player.set("autoplay", config.player.defaultAutoplay ?? false);
    }

    if (!player.get("ownerId")) {
      player.set("ownerId", interaction.user?.id || interaction.author?.id);
    }

    // Auto-maximize channel bitrate to guild Nitro tier (up to 384 kbps)
    player.set("lastVoiceChannelId", voiceChannel.id);
    audioOptimizer.maximizeVoiceBitrate(voiceChannel, client);

    // Resolve the query and complete the voice handshake in parallel. Lavalink
    // only needs the voice credentials before the first frame, so overlapping
    // both removes the full connection round-trip from time-to-first-audio.
    const searchPromise = (async () => {
      const isUrl = /^https?:\/\//i.test(query);
      const isPrefixed = /^(ytsearch|ytmsearch|spsearch|scsearch|jssearch):/i.test(query);

      let formattedQuery = query;
      if (!isUrl && !isPrefixed) {
        const prefix = forcedSource || audioQuality.resolvePlaybackPlatform();
        formattedQuery = `${prefix}:${query}`;
      }

      let resolved = await player.search({ query: formattedQuery }, interaction.user);

      if ((!resolved || !resolved.tracks || resolved.tracks.length === 0) && !isUrl && !forcedSource) {
        resolved = await player.search({ query: `ytsearch:${query}` }, interaction.user);
      }

      return resolved;
    })();

    const [connectOutcome, searchOutcome] = await Promise.allSettled([
      player.connected ? Promise.resolve() : player.connect(),
      searchPromise,
    ]);

    if (connectOutcome.status === "rejected") {
      logger.error(
        `Voice connect failed in guild ${interaction.guildId}:`,
        connectOutcome.reason?.message || connectOutcome.reason
      );
      // Do not leak a broken player: it would make every later /play reuse a
      // dead voice connection.
      if (createdPlayer) await player.destroy("Voice connect failed").catch(() => {});
      return interaction.editReply(errorText("Could not join the voice channel. Please try `/play` again."));
    }

    if (searchOutcome.status === "rejected") {
      logger.error("Player search failed:", searchOutcome.reason);
      return interaction.editReply(
        errorText(`Failed to resolve audio: \`${searchOutcome.reason?.message || searchOutcome.reason}\``)
      );
    }

    const searchRes = searchOutcome.value;

    if (!searchRes || !searchRes.tracks || searchRes.tracks.length === 0) {
      return interaction.editReply(errorText(`No tracks found matching \`${query}\`.`));
    }

    switch (searchRes.loadType) {
      case "track":
      case "search": {
        // Never stream a 30s preview or a low-bitrate mirror when a full-length
        // Opus source for the same song is available.
        const track = await audioQuality.ensureFullQualityTrack(player, searchRes.tracks[0], interaction.user);
        player.queue.add(track);
        const position = player.queue.tracks.length;
        const willPlayNow = !player.playing && !player.paused;

        if (willPlayNow) {
          const voiceStatusManager = require("../../utils/voiceStatusManager");
          if (track) voiceStatusManager.onTrackStart(client, player, track);
          await player.play();
        }

        const cleanTitle = truncate(cleanTrackTitle(track.info.title), 42);
        const cleanAuthor = truncate(track.info.author, 26);
        const uri = track.info.uri || "https://discord.com";
        const theme = getPlatformTheme(track.info.sourceName);
        const duration = track.info.isStream ? "LIVE" : formatDuration(track.info.duration);

        if (willPlayNow) {
          return interaction.editReply(
            actionWithButton(
              theme.badge || emojis.music,
              `Now playing [**${cleanTitle}**](${uri}) by **${cleanAuthor}**`,
              `${theme.name} • \`${duration}\` • Requested by <@${interaction.user.id}>`,
              { customId: "btn_open_player", label: "Open Player", emoji: emojis.openPlayer, style: ButtonStyle.Secondary }
            )
          );
        }

        return interaction.editReply(
          actionWithButton(
            emojis.check,
            `Added [**${cleanTitle}**](${uri}) to queue (\`#${position}\`)`,
            `${cleanAuthor} • \`${duration}\` • Requested by <@${interaction.user.id}>`,
            { customId: "cmd_queue", label: "View Queue", emoji: emojis.queue, style: ButtonStyle.Secondary }
          )
        );
      }

      case "playlist": {
        // Metadata-only playlists (Spotify without node credentials) can be all
        // 30-second previews; upgrade those before they reach the queue.
        const tracks = await audioQuality.ensureFullQualityTracks(
          player,
          searchRes.tracks,
          interaction.user
        );

        const capacity = queueCapacity(player);
        if (capacity <= 0) {
          return interaction.editReply(
            errorText(`The queue is full (${config.player.maxQueueSize} tracks). Wait for it to drain or run \`/clear\`.`)
          );
        }

        const queued = tracks.slice(0, capacity);
        player.queue.add(queued);
        const willPlayNow = !player.playing && !player.paused;

        if (willPlayNow) {
          const voiceStatusManager = require("../../utils/voiceStatusManager");
          if (queued[0]) voiceStatusManager.onTrackStart(client, player, queued[0]);
          await player.play();
        }

        const totalDuration = queued.reduce((acc, t) => acc + (t.info.duration || 0), 0);
        const title = truncate(searchRes.playlist?.name || "Curated Playlist", 42);
        const capNote = tracks.length > queued.length ? ` • Queue capped at ${config.player.maxQueueSize}` : "";

        return interaction.editReply(
          actionWithButton(
            emojis.playlist,
            `Enqueued playlist **${title}** (\`${queued.length} tracks\`)`,
            `Total Duration: \`${formatDuration(totalDuration)}\` • Requested by <@${interaction.user.id}>${capNote}`,
            { customId: "cmd_queue", label: "View Queue", emoji: emojis.queue, style: ButtonStyle.Secondary }
          )
        );
      }

      case "empty": {
        return interaction.editReply(errorText(`No results found matching \`${query}\`.`));
      }

      case "error": {
        return interaction.editReply(errorText(`Error resolving track: ${searchRes.exception?.message || "Lavalink Exception"}`));
      }

      default: {
        const track = searchRes.tracks[0];
        if (track) {
          player.queue.add(track);
          if (!player.playing && !player.paused) {
            const voiceStatusManager = require("../../utils/voiceStatusManager");
            voiceStatusManager.onTrackStart(client, player, track);
            await player.play();
          }
          const cleanTitle = truncate(cleanTrackTitle(track.info.title), 42);
          return interaction.editReply(
            actionWithButton(
              emojis.check,
              `Added **${cleanTitle}** to queue (\`#${player.queue.tracks.length}\`)`,
              `Requested by <@${interaction.user.id}>`,
              { customId: "cmd_queue", label: "View Queue", emoji: emojis.queue, style: ButtonStyle.Secondary }
            )
          );
        }
        return interaction.editReply(errorText("Unable to load track."));
      }
    }
  },
};
