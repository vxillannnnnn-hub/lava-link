const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const config = require("../config");
const { getPlatformTheme, cleanTrackTitle } = require("./sourceManager");
const {
  formatDuration,
  createProgressBar,
  truncate,
  formatRequester,
  getSourceBadge,
} = require("./formatters");
const { buildComponentsV2Payload } = require("./componentsV2");
const autoplayManager = require("./autoplayManager");
const djManager = require("./djManager");
const db = require("../database/db");
const emojis = require("./emojis");
const voiceStatusManager = require("./voiceStatusManager");
const logger = require("./logger");
const volumeManager = require("./volumeManager");
const playerActions = require("./playerActions");

/**
 * Build Ultra-Compact Landscape Embed (Eara / Jockie Style Fallback)
 * Minimalist, micro-height, zero bloat, ZERO PINGS
 */
function buildNowPlayingEmbed(player) {
  const track = player.queue.current;
  if (!track) {
    return new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(`[Ready for Music](https://discord.com) — Pulse\nUse \`/play\` to stream audio.\n\n00:00 ${createProgressBar(0, 100, 12)} 00:00`);
  }

  const theme = getPlatformTheme(track.info.sourceName);
  const cleanTitle = truncate(cleanTrackTitle(track.info.title), 40);
  const cleanAuthor = truncate(track.info.author, 25);
  const uri = track.info.uri || "https://discord.com";
  const albumOrSource = track.pluginInfo?.albumName || track.pluginInfo?.album?.name || theme.name;

  const progressSlider = track.info.isStream
    ? `${emojis.live} \`[LIVE STREAM]\``
    : `${formatDuration(player.position)} ${createProgressBar(player.position, track.info.duration, 12)} ${formatDuration(track.info.duration)}`;

  // Eara Format Line 1: [Title](URI) — Artist
  const line1 = `[${cleanTitle}](${uri}) — ${cleanAuthor}`;

  // Eara Format Line 2: <@Requester> · Album/Source (Zero pings enforced via allowedMentions)
  const requesterId = track.requester?.id || (typeof track.requester === "string" && /^\d+$/.test(track.requester) ? track.requester : null);
  const requesterBadge = track.isAutoplay
    ? `${emojis.sparkles} \`Autoplay\` · ${truncate(track.seedTitle || albumOrSource, 25)}`
    : requesterId
      ? `<@${requesterId}> · ${albumOrSource}`
      : `@${formatRequester(track.requester)} · ${albumOrSource}`;

  // Eara Format Line 3: 00:18 [progress-bar] 03:42
  const line3 = progressSlider;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setDescription(`${line1}\n${requesterBadge}\n\n${line3}`);

  if (track.info.artworkUrl) {
    embed.setThumbnail(track.info.artworkUrl);
  }

  return embed;
}

/**
 * Build Minimal Single-Row Transport Component Layout (Option 1)
 * Clean, modern, zero-clutter 4-button media bar:
 * [ ⏮ Previous ] [ ⏯ Play/Pause ] [ ⏭ Skip ] [ 🎛 Controls ]
 */
function buildNowPlayingComponents(player) {
  const isPaused = Boolean(player.paused);
  const hasPrevious = (player.queue?.previous?.length || 0) > 0;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_prev")
      .setEmoji(emojis.previous)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrevious),
    new ButtonBuilder()
      .setCustomId("btn_pause_resume")
      .setEmoji(isPaused ? emojis.play : emojis.pause)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_skip")
      .setEmoji(emojis.skip)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("btn_open_player")
      .setEmoji(emojis.openPlayer)
      .setLabel("Controls")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row];
}

/**
 * Build Ephemeral Audio Control Drawer Payload
 * Complete control console (Toggles, Volume presets, DSP Filters) in an ephemeral, reactive window.
 */
function buildControlDrawerPayload(player) {
  const client = player.lavalink?.client;
  return emojis.runWithClient(client, () => {
  const currentTrack = player.queue.current;
  const is247 = Boolean(player.get("247"));
  const isAutoplay = Boolean(player.get("autoplay"));
  const loopMode = player.repeatMode || "off";
  const activeFilter = player.get("activeFilter") || "Flat EQ / Direct Passthrough";
  const totalDuration = player.queue.tracks.reduce(
    (acc, t) => acc + (t.info.duration || 0),
    currentTrack?.info?.duration || 0
  );

  const trackTitle = currentTrack ? truncate(cleanTrackTitle(currentTrack.info.title), 36) : "No song playing";
  const trackUri = currentTrack?.info?.uri || "https://discord.com";
  const trackAuthor = currentTrack ? truncate(currentTrack.info.author, 24) : "Unknown";

  const loopLabel = loopMode === "track" ? "Loop: Track" : loopMode === "queue" ? "Loop: Queue" : "Loop: Off";
  const autoplayLabel = isAutoplay ? "Autoplay: ON" : "Autoplay: OFF";

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("Audio Console & Control Center")
    .setDescription(
      `${emojis.play} **Now Playing:** [${trackTitle}](${trackUri}) — \`${trackAuthor}\`\n\n` +
      `• **Volume:** \`${player.volume}%\` · **Repeat:** \`${loopMode.toUpperCase()}\`\n` +
      `• **Autoplay:** \`${isAutoplay ? "ENABLED" : "OFF"}\` · **24/7:** \`${is247 ? "ACTIVE" : "OFF"}\`\n` +
      `• **Filter:** \`${activeFilter}\`\n` +
      `• **Queue:** \`${player.queue.tracks.length} track(s)\` (\`${formatDuration(totalDuration)}\` total)\n\n` +
      `-# Select a playback toggle, quick volume preset, or audio filter below:`
    );

  // Row 1 (5 items): Mode Toggles & Stop
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ctrl_loop")
      .setEmoji(loopMode === "track" ? emojis.loopOne : emojis.loop)
      .setLabel(loopLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_shuffle")
      .setEmoji(emojis.shuffle)
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(player.queue.tracks.length < 2),
    new ButtonBuilder()
      .setCustomId("ctrl_autoplay")
      .setEmoji(emojis.autoplay)
      .setLabel(autoplayLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_save")
      .setEmoji(emojis.heart)
      .setLabel("Save")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_stop")
      .setEmoji(emojis.stop)
      .setLabel("Stop")
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2 (4 items): Clipping-safe volume presets & Queue
  // Digital gain above 100% multiplies PCM and saturates the Opus encoder, so
  // every preset here stays inside the clipping-free range (see volumeManager).
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ctrl_vol_50")
      .setEmoji(emojis.volumeLow)
      .setLabel(player.volume === 50 ? "[50%]" : "50%")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_vol_75")
      .setEmoji(emojis.volumeNormal)
      .setLabel(player.volume === 75 ? "[75%]" : "75%")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_vol_100")
      .setEmoji(emojis.volumeBoost)
      .setLabel(player.volume === 100 ? "[100%]" : "100%")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ctrl_queue")
      .setEmoji(emojis.queue)
      .setLabel("View Queue")
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 3 (1 item): Audio DSP Equalizer & Presets
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ctrl_select_filter")
    .setPlaceholder("Select Audio Filter / DSP Preset...")
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel("Reset / Flat Passthrough")
        .setDescription("Clear all active audio filters (0ms Opus Direct)")
        .setValue("reset"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Bass Boost")
        .setDescription("Deep 4-band dynamic bass frequency boost")
        .setValue("bass"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Nightcore")
        .setDescription("1.25x tempo speedup and high pitch elevation")
        .setValue("nightcore"),
      new StringSelectMenuOptionBuilder()
        .setLabel("8D Spatial Surround")
        .setDescription("Orbital 360° rotating spatial audio")
        .setValue("8d"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Vaporwave")
        .setDescription("Slowed 0.8x tempo and deep lo-fi chillwave")
        .setValue("vaporwave")
    ]);

  const row3 = new ActionRowBuilder().addComponents(selectMenu);

  return {
    embeds: [embed],
    components: [row1, row2, row3],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [], users: [] },
  };
  });
}

/**
 * Build standard Discord embed fallback payload (Zero Pings guaranteed)
 */
function getFallbackEmbedPayload(player) {
  const client = player.lavalink?.client;
  const runner = client ? (fn) => emojis.runWithClient(client, fn) : (fn) => fn();
  return runner(() => {
    const components = buildNowPlayingComponents(player);
    return {
      embeds: [buildNowPlayingEmbed(player)],
      components,
      allowedMentions: { parse: [], users: [] },
    };
  });
}

/**
 * Build the payload for sending or editing the dashboard
 */
function getDashboardPayload(player) {
  const client = player.lavalink?.client;
  return emojis.runWithClient(client, () => {
    const components = buildNowPlayingComponents(player);

    if (config.player.useComponentsV2) {
      try {
        const v2Payload = buildComponentsV2Payload(player, components);
        v2Payload.allowed_mentions = { parse: [], users: [] };
        return v2Payload;
      } catch (err) {
        logger.debug("Components V2 payload error:", err.message);
      }
    }

    return getFallbackEmbedPayload(player);
  });
}

// Active real-time dashboard progress intervals mapped by guildId
const dashboardIntervals = new Map();

// Debounce timers for smoothly keeping now playing dashboard at the bottom of the channel
const bottomDebounceTimers = new Map();

/**
 * Send or Edit in-place the Player Dashboard (Jockie / Eara Best Practice)
 * Prevents channel spam, completely stops repeated user notification pings,
 * and always keeps the active embed pinned to the bottom of the channel when new messages arrive.
 */
async function sendOrUpdatePlayerDashboard(channel, player, forceBottom = false) {
  if (!channel || !player) return null;
  if (!player.queue?.current && !player.playing) return null;

  // Prevent concurrent duplicate sends/edits during rapid progress ticks or burst messages
  if (player.get("isDashboardUpdating")) return null;
  player.set("isDashboardUpdating", true);

  try {
    const payload = getDashboardPayload(player);
    const prevMsgId = player.get("nowPlayingMsgId");

    if (prevMsgId) {
      // Always delete the old dashboard message first for clean repositioning
      try {
        const prevMsg = await channel.messages.fetch(prevMsgId).catch(() => null);
        if (prevMsg && prevMsg.deletable) {
          await prevMsg.delete().catch(() => {});
        }
      } catch (_) {}

      if (!forceBottom) {
        // Normal progress tick: edit the now-deleted message position
        try {
          const prevMsg = await channel.messages.fetch(prevMsgId).catch(() => null);
          if (prevMsg && prevMsg.editable) {
            return await prevMsg.edit(payload);
          }
        } catch (_) {}
      } else {
        // forceBottom: send fresh dashboard at channel bottom
        try {
          const msg = await channel.send(payload);
          player.set("nowPlayingMsgId", msg.id);
          return msg;
        } catch (err) {
          logger.debug("Failed to send dashboard:", err.message);
          return null;
        }
      }
    }

    // Otherwise send a new dashboard at the bottom and store its ID
    try {
      const msg = await channel.send(payload);
      player.set("nowPlayingMsgId", msg.id);
      return msg;
    } catch (err) {
      // If Components V2 failed (e.g. channel restrictions), gracefully fall back
      if (payload?.flags === 32768) {
        try {
          const fallback = getFallbackEmbedPayload(player);
          const msg = await channel.send(fallback);
          player.set("nowPlayingMsgId", msg.id);
          return msg;
        } catch (innerErr) {
          logger.debug("Failed to send fallback player dashboard:", innerErr.message);
          return null;
        }
      }
      logger.debug("Failed to send player dashboard:", err.message);
      return null;
    }
  } finally {
    player.set("isDashboardUpdating", false);
  }
}

/**
 * Start real-time progress update loop for the now playing dashboard.
 * Ticks every 5 seconds (strictly compliant with Discord's 5s channel rate limits).
 * Automatically repositions the embed to the bottom of the channel if users send messages.
 */
function startRealtimeProgressLoop(player, client) {
  if (!player || !player.guildId) return;

  // Clear existing timer if any
  stopRealtimeProgressLoop(player);

  const UPDATE_INTERVAL_MS = 5000; // 5 seconds (optimal rate limit safety)
  const timerKey = `${player.guildId}:${client?.user?.id || "default"}`;

  const timer = setInterval(async () => {
    try {
      if (!player || !player.connected || !player.queue?.current) {
        stopRealtimeProgressLoop(player);
        return;
      }

      // If playback is paused or is a livestream, freeze progress slider updates
      if (player.paused || player.queue?.current?.info?.isStream) return;

      const channelId = player.textChannelId;
      if (!channelId) return;

      const channel = client.channels.cache.get(channelId);
      if (!channel) return;

      await sendOrUpdatePlayerDashboard(channel, player);
    } catch (err) {
      logger.debug(`Dashboard progress tick notice [${player.guildId}]:`, err.message);
    }
  }, UPDATE_INTERVAL_MS);

  if (timer.unref) timer.unref();
  player._dashboardTimer = timer;
  player._dashboardTimerKey = timerKey;
  dashboardIntervals.set(timerKey, timer);
}

/**
 * Stop active real-time progress loop
 */
function stopRealtimeProgressLoop(player) {
  if (!player || !player.guildId) return;

  if (player._dashboardTimer) {
    clearInterval(player._dashboardTimer);
    player._dashboardTimer = null;
  }
  if (player._bottomDebounceTimer) {
    clearTimeout(player._bottomDebounceTimer);
    player._bottomDebounceTimer = null;
  }

  // Fleet-safe cleanup: a single guild can host several bot instances, so only
  // the timer created for THIS player may be cleared. Matching by guildId
  // prefix would kill another bot's dashboard in the same server.
  const dashboardKey = player._dashboardTimerKey;
  if (dashboardKey && dashboardIntervals.has(dashboardKey)) {
    clearInterval(dashboardIntervals.get(dashboardKey));
    dashboardIntervals.delete(dashboardKey);
  }
  player._dashboardTimerKey = null;

  const bottomKey = player._bottomDebounceKey;
  if (bottomKey && bottomDebounceTimers.has(bottomKey)) {
    clearTimeout(bottomDebounceTimers.get(bottomKey));
    bottomDebounceTimers.delete(bottomKey);
  }
  player._bottomDebounceKey = null;
}

/**
 * Keeps the now playing dashboard at the bottom of the channel when new messages arrive.
 * Debounced gently (2000ms) to prevent Discord API spam during rapid chat bursts.
 */
function keepDashboardAtBottom(player, client, channel) {
  if (!player || !player.guildId || !player.queue?.current || !channel) return;
  const prevMsgId = player.get("nowPlayingMsgId");
  if (!prevMsgId) return;

  const timerKey = `${player.guildId}:${client?.user?.id || "default"}`;
  const existing = bottomDebounceTimers.get(timerKey) || player._bottomDebounceTimer;
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    try {
      if (!player.connected || !player.queue?.current) return;
      if (channel.lastMessageId && channel.lastMessageId !== player.get("nowPlayingMsgId")) {
        await sendOrUpdatePlayerDashboard(channel, player, true);
      }
    } catch (_) {}
  }, 2000);

  if (timer.unref) timer.unref();
  player._bottomDebounceTimer = timer;
  player._bottomDebounceKey = timerKey;
  bottomDebounceTimers.set(timerKey, timer);
}

/**
 * Update interaction with Components V2 or Landscape Embed fallback
 */
async function updatePlayerInteraction(interaction, player) {
  const payload = getDashboardPayload(player);

  try {
    return await interaction.update(payload);
  } catch (err) {
    try {
      const fallback = getFallbackEmbedPayload(player);
      return await interaction.update(fallback);
    } catch (fallbackErr) {
      logger.debug("Interaction update fallback:", fallbackErr.message);
    }
  }
}

/**
 * Handle interactive button clicks on the player controller
 */
async function handlePlayerButton(interaction, client) {
  const { customId, guildId, member } = interaction;

  // Handle playlist playback triggers directly from playlist buttons
  if (customId === "cmd_pl_play_favs" || customId.startsWith("cmd_pl_play_")) {
    const voiceChannel = member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: `${emojis.warn} You must be connected to a voice channel to stream playlists.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let targetTracks = [];
    let playlistName = "";

    if (customId === "cmd_pl_play_favs") {
      playlistName = "Favorites";
      targetTracks = db.getFavorites(member.id);
    } else {
      playlistName = customId.replace("cmd_pl_play_", "");
      const pl = db.getPlaylist(member.id, playlistName);
      if (pl) {
        targetTracks = db.getPlaylistTracks(pl.id);
      }
    }

    if (!targetTracks || targetTracks.length === 0) {
      return interaction.editReply({
        content: `${emojis.cross} Playlist **${playlistName}** is empty or does not exist.`,
      });
    }

    let activePlayer = client.lavalink.getPlayer(guildId);
    // Never hijack a playback session another voice channel is using.
    if (activePlayer?.voiceChannelId && activePlayer.voiceChannelId !== voiceChannel.id) {
      return interaction.editReply({
        content: `${emojis.warn} I am already streaming in <#${activePlayer.voiceChannelId}>. Join that channel first, or stop that session.`,
      });
    }

    if (!activePlayer) {
      activePlayer = client.lavalink.createPlayer({
        guildId,
        voiceChannelId: voiceChannel.id,
        textChannelId: interaction.channelId,
        selfDeaf: true,
        volume: config.player.defaultVolume,
      });
      activePlayer.set("autoplay", config.player.defaultAutoplay ?? false);
    }

    if (!activePlayer.connected) {
      await activePlayer.connect();
    }

    let loaded = 0;
    for (const item of targetTracks) {
      try {
        const res = await activePlayer.search({ query: item.uri || item.title }, interaction.user);
        if (res?.tracks?.length > 0) {
          activePlayer.queue.add(res.tracks[0]);
          loaded++;
        }
      } catch {}
    }

    if (!activePlayer.playing && !activePlayer.paused) {
      await activePlayer.play();
    }

    return interaction.editReply({
      content: `${emojis.music} Loaded and queued **${loaded} track(s)** from **${playlistName}**!`,
    });
  }

  const player = client.lavalink.getPlayer(guildId);

  if (!player) {
    return interaction.reply({
      content: `${emojis.cross} No active audio player found in this server.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }

  // Voice channel safety validation
  if (!member.voice.channelId) {
    return interaction.reply({
      content: `${emojis.warn} You must be connected to a voice channel to use audio controls.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }

  if (player.voiceChannelId && member.voice.channelId !== player.voiceChannelId) {
    return interaction.reply({
      content: `${emojis.warn} You must be in the same voice channel (<#${player.voiceChannelId}>) to use audio controls.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }

  // Helper to enforce DJ permissions on playback modifications
  const checkDJ = (isSkip = false) => {
    const perm = djManager.canManagePlayer(member, player, isSkip);
    if (!perm.allowed) {
      interaction.reply({
        content: perm.reason,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      return false;
    }
    return true;
  };

  switch (customId) {
    case "cmd_resume":
    case "cmd_pause":
    case "btn_pause_resume": {
      if (!checkDJ(false)) return;
      if (player.paused) {
        await player.resume();
        voiceStatusManager.onResume(client, player);
        startRealtimeProgressLoop(player, client);
      } else {
        await player.pause();
        voiceStatusManager.onPause(client, player);
      }
      if (customId === "btn_pause_resume") {
        await updatePlayerInteraction(interaction, player);
      } else {
        await interaction.reply({
          content: player.paused ? `${emojis.pause} Playback paused.` : `${emojis.play} Playback resumed.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
      break;
    }

    case "btn_skip": {
      if (!checkDJ(true)) return;
      const currentTitle = player.queue.current?.info?.title || "current track";
      const nextTrack = player.queue.tracks[0];
      if (nextTrack) {
        voiceStatusManager.onTrackStart(client, player, nextTrack);
      } else if (!player.get("autoplay")) {
        voiceStatusManager.setIdleVoiceStatus(client, player.voiceChannelId, player.guildId);
      }
      await playerActions.skipCurrent(player, 0);
      await interaction.reply({
        content: `${emojis.skip} Skipped **${truncate(currentTitle, 45)}**`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      break;
    }

    case "btn_prev": {
      if (!checkDJ(false)) return;
      const prevTrack = player.queue.previous[0];
      if (!prevTrack) {
        return interaction.reply({
          content: `${emojis.cross} No previous track found in session history.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
      // Capture the interrupted track before play() replaces the current one,
      // then put it back at the head of the queue so "previous" is reversible.
      const interruptedTrack = player.queue.current;
      voiceStatusManager.onTrackStart(client, player, prevTrack);
      await player.play({ track: prevTrack });
      if (
        interruptedTrack &&
        interruptedTrack.info?.identifier !== prevTrack.info?.identifier
      ) {
        player.queue.add(interruptedTrack, 0);
      }
      await interaction.reply({
        content: `${emojis.previous} Playing previous: **${truncate(prevTrack.info.title, 45)}**`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      break;
    }

    case "btn_save": {
      const track = player.queue.current;
      if (!track) {
        return interaction.reply({
          content: `${emojis.cross} No song is currently streaming.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }

      // Save directly into SQLite favorites library
      db.addFavorite(interaction.user.id, track);

      const cleanTitle = truncate(track.info.title, 50);
      const uri = track.info.uri || "https://discord.com";

      const dmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Song")
          .setURL(uri)
      );

      const dmContent =
        `${emojis.heart} **Saved to Favorites: [${cleanTitle}](${uri})**\n` +
        `• **Artist:** \`${track.info.author || "Unknown"}\`\n` +
        `• **Duration:** \`${formatDuration(track.info.duration)}\`\n` +
        `• **Server:** \`${interaction.guild.name}\`\n\n` +
        `-# Use \`/playlist play-favorites\` to stream all your saved songs anytime!`;

      try {
        await interaction.user.send({
          content: dmContent,
          components: [dmRow],
          allowedMentions: { parse: [], users: [] },
        });
        return interaction.reply({
          content: `${emojis.heart} Saved **[${cleanTitle}](${uri})** to your Favorites & sent details to your DMs!\n-# Use \`/playlist play-favorites\` to stream anytime`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      } catch {
        return interaction.reply({
          content: `${emojis.heart} Saved **[${cleanTitle}](${uri})** to your Favorites!\n-# Use \`/playlist play-favorites\` to stream anytime`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
    }

    case "btn_controls":
    case "btn_open_player": {
      const payload = buildControlDrawerPayload(player);
      return interaction.reply(payload);
    }

    case "ctrl_loop": {
      if (!checkDJ(false)) return;
      let nextMode = "off";
      if (player.repeatMode === "off") nextMode = "track";
      else if (player.repeatMode === "track") nextMode = "queue";
      else nextMode = "off";

      player.setRepeatMode(nextMode);
      return await interaction.update(buildControlDrawerPayload(player));
    }

    case "ctrl_shuffle": {
      if (!checkDJ(false)) return;
      if (player.queue.tracks.length < 2) {
        return interaction.reply({
          content: `${emojis.warn} Not enough songs in queue to shuffle (minimum 2 needed).`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
      player.queue.shuffle();
      await interaction.update(buildControlDrawerPayload(player));
      await interaction.followUp({
        content: `${emojis.shuffle} Shuffled **${player.queue.tracks.length}** songs in queue!`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      break;
    }

    case "ctrl_autoplay": {
      if (!checkDJ(false)) return;
      const currentAutoplay = Boolean(player.get("autoplay"));
      const newAutoplay = !currentAutoplay;
      player.set("autoplay", newAutoplay);

      // Persist the seed track identifier for autoplay across bot restarts
      const seedTrack = player.queue.current || player.queue.previous[0] || player.get("lastPlayedTrack");
      player.set("autoplaySeedTrack", seedTrack?.info?.identifier || null);

      if (newAutoplay && seedTrack) {
        if (!player.playing && player.queue.tracks.length === 0) {
          await autoplayManager.executeAutoplay(player, seedTrack, false);
        } else {
          await autoplayManager.prefetchAutoplay(player, seedTrack);
        }
      }

      return await interaction.update(buildControlDrawerPayload(player));
    }

    case "ctrl_stop": {
      if (!checkDJ(false)) return;
      player.queue.tracks.splice(0, player.queue.tracks.length);
      await player.destroy("User pressed Stop button in Controls Drawer");
      return await interaction.update({
        content: `${emojis.stop} Playback stopped, queue cleared, and disconnected from voice channel.`,
        embeds: [],
        components: [],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    case "ctrl_save": {
      const track = player.queue.current;
      if (!track) {
        return interaction.reply({
          content: `${emojis.cross} No song is currently streaming.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }

      db.addFavorite(interaction.user.id, track);

      const cleanTitle = truncate(track.info.title, 50);
      const uri = track.info.uri || "https://discord.com";

      const dmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Open Song")
          .setURL(uri)
      );

      const dmContent =
        `${emojis.heart} **Saved to Favorites: [${cleanTitle}](${uri})**\n` +
        `• **Artist:** \`${track.info.author || "Unknown"}\`\n` +
        `• **Duration:** \`${formatDuration(track.info.duration)}\`\n` +
        `• **Server:** \`${interaction.guild.name}\`\n\n` +
        `-# Use \`/playlist play-favorites\` to stream all your saved songs anytime!`;

      try {
        await interaction.user.send({
          content: dmContent,
          components: [dmRow],
          allowedMentions: { parse: [], users: [] },
        });
        return interaction.reply({
          content: `${emojis.heart} Saved **[${cleanTitle}](${uri})** to your Favorites & sent details to your DMs!\n-# Use \`/playlist play-favorites\` to stream anytime`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      } catch {
        return interaction.reply({
          content: `${emojis.heart} Saved **[${cleanTitle}](${uri})** to your Favorites!\n-# Use \`/playlist play-favorites\` to stream anytime`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
    }

    case "ctrl_queue": {
      const current = player.queue.current;
      const tracks = player.queue.tracks;

      if (!current && tracks.length === 0) {
        return interaction.reply({
          content: `${emojis.queue} The queue is currently empty. Use \`/play\` to add tracks!`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }

      const queueItems = tracks.slice(0, 10).map((t, idx) => {
        return `\`${idx + 1}.\` [${truncate(t.info.title, 36)}](${t.info.uri || "https://discord.com"}) — \`${formatDuration(t.info.duration)}\``;
      });

      const remaining = tracks.length > 10 ? `\n*...and ${tracks.length - 10} more tracks*` : "";
      const totalDuration = tracks.reduce(
        (acc, t) => acc + (t.info.duration || 0),
        current?.info?.duration || 0
      );

      const queueContent =
        `${emojis.queue} **Upcoming Queue — ${tracks.length} track(s)**\n\n` +
        `${emojis.play} **Now Playing:** [${truncate(current?.info?.title || "Nothing", 40)}](${current?.info?.uri || "https://discord.com"})\n\n` +
        `**Next Tracks:**\n${queueItems.length > 0 ? queueItems.join("\n") + remaining : "*No upcoming tracks in queue.*"}\n\n` +
        `-# Total Duration: \`${formatDuration(totalDuration)}\` · Autoplay: \`${player.get("autoplay") ? "ON" : "OFF"}\``;

      return interaction.reply({
        content: queueContent,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    case "ctrl_vol_50": {
      if (!checkDJ(false)) return;
      await volumeManager.applyVolume(player, 50);
      return await interaction.update(buildControlDrawerPayload(player));
    }
    case "ctrl_vol_75": {
      if (!checkDJ(false)) return;
      await volumeManager.applyVolume(player, 75);
      return await interaction.update(buildControlDrawerPayload(player));
    }
    case "ctrl_vol_100": {
      if (!checkDJ(false)) return;
      await volumeManager.applyVolume(player, 100);
      return await interaction.update(buildControlDrawerPayload(player));
    }
    case "ctrl_vol_150": {
      // Legacy button id from dashboards posted before the clipping-safe gain path
      if (!checkDJ(false)) return;
      const legacyResult = await volumeManager.applyVolume(player, 150);
      await interaction.update(buildControlDrawerPayload(player));
      return interaction.followUp({
        content: `${emojis.volumeNormal} ${volumeManager.capNotice(legacyResult)}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "ctrl_crossfade": {
      if (!checkDJ(false)) return;
      const seconds = Math.max(0, Math.min(10, Number(interaction.options.getString("duration")) || 3));
      await volumeManager.setCrossfade(player, seconds * 1000);
      return interaction.followUp({
        content: `${emojis.crossfade} Crossfade set to **${seconds}** second${seconds !== 1 ? "s" : ""}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    case "btn_loop": {
      if (!checkDJ(false)) return;
      let nextMode = "off";
      if (player.repeatMode === "off") nextMode = "track";
      else if (player.repeatMode === "track") nextMode = "queue";
      else nextMode = "off";

      player.setRepeatMode(nextMode);
      await updatePlayerInteraction(interaction, player);
      break;
    }

    case "btn_shuffle": {
      if (!checkDJ(false)) return;
      if (player.queue.tracks.length < 2) {
        return interaction.reply({
          content: `${emojis.warn} Not enough songs in queue to shuffle (minimum 2 needed).`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
      player.queue.shuffle();
      await interaction.reply({
        content: `${emojis.shuffle} Shuffled **${player.queue.tracks.length}** songs in queue!`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      break;
    }

    case "btn_autoplay": {
      if (!checkDJ(false)) return;
      const currentAutoplay = Boolean(player.get("autoplay"));
      const newAutoplay = !currentAutoplay;
      player.set("autoplay", newAutoplay);

      // Persist the seed track identifier for autoplay across bot restarts
      const seedTrack = player.queue.current || player.queue.previous[0] || player.get("lastPlayedTrack");
      player.set("autoplaySeedTrack", seedTrack?.info?.identifier || null);

      if (newAutoplay && seedTrack) {
        if (!player.playing && player.queue.tracks.length === 0) {
          // If queue ended already, immediately start autoplaying!
          await autoplayManager.executeAutoplay(player, seedTrack, false);
        } else {
          await autoplayManager.prefetchAutoplay(player, seedTrack);
        }
      }

      await updatePlayerInteraction(interaction, player);
      await interaction.followUp({
        content: newAutoplay
          ? `${emojis.autoplay} **Autoplay enabled**: Next songs will play automatically after this track finishes.`
          : `${emojis.autoplay} **Autoplay disabled**.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
      break;
    }

    case "cmd_queue":
    case "btn_queue": {
      const current = player.queue.current;
      const tracks = player.queue.tracks;

      if (!current && tracks.length === 0) {
        return interaction.reply({
          content: `${emojis.queue} The queue is currently empty. Use \`/play\` to add tracks!`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }

      const queueItems = tracks.slice(0, 10).map((t, idx) => {
        return `\`${idx + 1}.\` [${truncate(t.info.title, 36)}](${t.info.uri || "https://discord.com"}) — \`${formatDuration(t.info.duration)}\``;
      });

      const remaining = tracks.length > 10 ? `\n*...and ${tracks.length - 10} more tracks*` : "";
      const totalDuration = tracks.reduce(
        (acc, t) => acc + (t.info.duration || 0),
        current?.info?.duration || 0
      );

      const queueContent =
        `${emojis.queue} **Upcoming Queue — ${tracks.length} track(s)**\n\n` +
        `${emojis.play} **Now Playing:** [${truncate(current?.info?.title || "Nothing", 40)}](${current?.info?.uri || "https://discord.com"})\n\n` +
        `**Next Tracks:**\n${queueItems.length > 0 ? queueItems.join("\n") + remaining : "*No upcoming tracks in queue.*"}\n\n` +
        `-# Total Duration: \`${formatDuration(totalDuration)}\` · Autoplay: \`${player.get("autoplay") ? "ON" : "OFF"}\``;

      return interaction.reply({
        content: queueContent,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    case "btn_stop": {
      if (!checkDJ(false)) return;
      player.queue.tracks.splice(0, player.queue.tracks.length);
      const vcId = player.voiceChannelId;
      if (player.get("247")) {
        await playerActions.stopPlayback(player, { clearQueue: true, executeAutoplay: false });
        voiceStatusManager.setIdleVoiceStatus(client, vcId, player.guildId);
        await interaction.reply({
          content: `${emojis.stop} Playback stopped and queue cleared (24/7 Mode Active).`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      } else {
        await player.destroy("User pressed Stop button");
        await interaction.reply({
          content: `${emojis.stop} Playback stopped, queue cleared, and disconnected from voice channel.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [], users: [] },
        });
      }
      break;
    }

    // Quick Console Handlers (all volume writes go through the clipping-safe path)
    case "pctrl_vol_50": {
      if (!checkDJ(false)) return;
      const v50 = await volumeManager.applyVolume(player, 50);
      return interaction.reply({
        content: `${emojis.volumeLow} ${volumeManager.describe(v50)}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_vol_75": {
      if (!checkDJ(false)) return;
      const v75 = await volumeManager.applyVolume(player, 75);
      return interaction.reply({
        content: `${emojis.volumeNormal} ${volumeManager.describe(v75)}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_vol_100": {
      if (!checkDJ(false)) return;
      const v100 = await volumeManager.applyVolume(player, 100);
      return interaction.reply({
        content: `${emojis.volumeNormal} ${volumeManager.describe(v100)}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_vol_150": {
      // Legacy preset: applied as a capped, clipping-safe request
      if (!checkDJ(false)) return;
      const v150 = await volumeManager.applyVolume(player, 150);
      return interaction.reply({
        content: `${emojis.volumeNormal} ${volumeManager.describe(v150)}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_filter_bass": {
      if (!checkDJ(false)) return;
      await player.filterManager.setEQ([
        { band: 0, gain: 0.25 },
        { band: 1, gain: 0.20 },
        { band: 2, gain: 0.15 },
        { band: 3, gain: 0.10 },
      ]);
      return interaction.reply({
        content: `${emojis.filters.bass} **Bass Boost** preset applied.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_filter_nightcore": {
      if (!checkDJ(false)) return;
      await player.filterManager.toggleNightcore();
      return interaction.reply({
        content: `${emojis.filters.nightcore} **Nightcore** preset applied.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_filter_8d": {
      if (!checkDJ(false)) return;
      await player.filterManager.toggleRotation();
      return interaction.reply({
        content: `${emojis.filters.spatial8D} **8D Surround** preset applied.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }
    case "pctrl_filter_clear": {
      if (!checkDJ(false)) return;
      await player.filterManager.resetFilters();
      return interaction.reply({
        content: `${emojis.filters.reset} Equalizer & audio filters reset to flat default.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
    }

    default:
      // Pagination buttons on /queue are consumed by that command's own
      // collector. Everything else here is a stale control from an old message.
      if (typeof customId === "string" && customId.startsWith("queue_")) return;
      return interaction.reply({
        content: `${emojis.warn} This control has expired. Run the command again or open the player with \`/nowplaying\`.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], users: [] },
      });
  }
}

/**
 * Handle filter select menu interaction
 */
async function handleFilterSelect(interaction, client) {
  const { values, guildId } = interaction;
  const player = client.lavalink.getPlayer(guildId);
  if (!player) {
    return interaction.reply({
      content: `${emojis.cross} No active audio player found in this server.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }

  // Filters change the audio path for everyone in the channel, so they are a
  // protected control: same voice channel + DJ permissions when DJ mode is on.
  if (!interaction.member?.voice?.channelId) {
    return interaction.reply({
      content: `${emojis.warn} You must be connected to a voice channel to change audio filters.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }
  if (player.voiceChannelId && interaction.member.voice.channelId !== player.voiceChannelId) {
    return interaction.reply({
      content: `${emojis.warn} You must be in the same voice channel (<#${player.voiceChannelId}>) to change audio filters.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }
  const filterDjCheck = djManager.canManagePlayer(interaction.member, player, false);
  if (!filterDjCheck.allowed) {
    return interaction.reply({
      content: filterDjCheck.reason,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    });
  }

  const selected = values[0];
  let filterName = "None (Flat / Direct Passthrough)";

  switch (selected) {
    case "reset":
      await player.filterManager.resetFilters();
      player.set("activeFilter", null);
      filterName = "None (Flat / Direct Passthrough)";
      break;
    case "8d":
      await player.filterManager.resetFilters();
      await player.filterManager.toggleRotation();
      player.set("activeFilter", "8D Spatial Audio");
      filterName = "8D Spatial Audio";
      break;
    case "nightcore":
      await player.filterManager.resetFilters();
      await player.filterManager.toggleNightcore();
      player.set("activeFilter", "Nightcore");
      filterName = "Nightcore";
      break;
    case "vaporwave":
      await player.filterManager.resetFilters();
      await player.filterManager.toggleVaporwave();
      player.set("activeFilter", "Vaporwave");
      filterName = "Vaporwave";
      break;
    case "bass":
      await player.filterManager.resetFilters();
      await player.filterManager.setEQ([{ band: 0, gain: 0.25 }, { band: 1, gain: 0.20 }, { band: 2, gain: 0.15 }]);
      player.set("activeFilter", "Bass Boost");
      filterName = "Bass Boost";
      break;
    default:
      await player.filterManager.resetFilters();
      player.set("activeFilter", null);
      break;
  }

  if (interaction.customId === "ctrl_select_filter") {
    return await interaction.update(buildControlDrawerPayload(player));
  }

  return interaction.reply({
    content: `${emojis.check} Audio filter set to **${filterName}**.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [], users: [] },
  });
}

module.exports = {
  buildNowPlayingEmbed,
  buildNowPlayingComponents,
  buildControlDrawerPayload,
  sendOrUpdatePlayerDashboard,
  updatePlayerInteraction,
  handlePlayerButton,
  handleFilterSelect,
  startRealtimeProgressLoop,
  stopRealtimeProgressLoop,
  keepDashboardAtBottom,
};
