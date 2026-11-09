/**
 * Dedicated Song-Request Channel Manager (Hydra / Jockie / Uzox Style)
 * Keeps a permanent interactive Eara-style dashboard in a designated channel.
 * Users simply type song names or paste links directly without slash commands!
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");
const db = require("../database/db");
const config = require("../config");
const { getDashboardPayload, buildNowPlayingComponents } = require("./playerController");
const { ComponentsV2Container } = require("./componentsV2");
const { truncate } = require("./formatters");
const audioQuality = require("./audioQuality");
const { queueCapacity } = require("./playerActions");
const emojis = require("./emojis");
const logger = require("./logger");

/**
 * Build placeholder dashboard when nothing is playing
 */
function buildPlaceholderPayload(client = null) {
  const runner = client ? (fn) => emojis.runWithClient(client, fn) : (fn) => fn();
  return runner(() => {
    const container = new ComponentsV2Container(0x2b2d31);
    container.addSection(
      `### ${emojis.music} No Song Currently Playing\n` +
      "Join a voice channel and **send a song name or paste a link** below to play!\n\n" +
      "-# Supports Spotify, YouTube, SoundCloud, JioSaavn & Direct Streams"
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("btn_prev").setEmoji(emojis.previous).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("btn_pause_resume").setEmoji(emojis.play).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("btn_skip").setEmoji(emojis.skip).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("btn_open_player").setEmoji(emojis.openPlayer).setLabel("Controls").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    if (config.player.useComponentsV2) {
      return {
        flags: 32768,
        components: [container, row],
        allowed_mentions: { parse: [], users: [] },
        allowedMentions: { parse: [], users: [] },
      };
    }

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle(`${emojis.music} No Song Currently Playing`)
      .setDescription(
        "Join a voice channel and **send a song name or link** below to start streaming audio!\n\n" +
        "-# Supports Spotify, YouTube, SoundCloud, JioSaavn & Web Streams"
      );

    return {
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [], users: [] },
    };
  });
}

/**
 * Update the permanent song request channel dashboard in-place
 */
async function updateRequestChannelDashboard(client, guildId, player = null) {
  return emojis.runWithClient(client, async () => {
    const settings = db.getGuildSettings(guildId);
    if (!settings?.request_channel_id || !settings?.request_message_id) return false;

    const channel = client.channels.cache.get(settings.request_channel_id);
    if (!channel) return false;

    try {
      const msg = await channel.messages.fetch(settings.request_message_id).catch(() => null);
      if (!msg || !msg.editable) return false;

      if (player && player.queue.current) {
        const payload = getDashboardPayload(player);
        await msg.edit(payload);
      } else {
        const placeholder = buildPlaceholderPayload(client);
        await msg.edit(placeholder);
      }
      return true;
    } catch (err) {
      logger.debug(`Could not update request channel message for guild ${guildId}:`, err.message);
      return false;
    }
  });
}

/**
 * Handle incoming plain text song requests in the dedicated channel
 */
async function handleSongRequestMessage(message, client) {
  return emojis.runWithClient(client, async () => {
    if (message.author.bot || !message.guild) return false;

    const settings = db.getGuildSettings(message.guild.id);
    if (!settings?.request_channel_id || message.channel.id !== settings.request_channel_id) {
      return false;
    }

    // Multi-Bot Fleet Arbitration: Ensure only ONE assigned bot handles the request
    const multiBotCoordinator = require("./multiBotCoordinator");
    const shouldHandle = multiBotCoordinator.shouldHandle(
      client,
      message,
      client.botIndex || 0,
      { commandName: "play", args: [message.content], isMention: false }
    );

    if (!shouldHandle) {
      return true;
    }

    // Delete user's message immediately to keep the channel 100% clean
    message.delete().catch(() => {});

    const query = message.content.trim();
    if (!query) return true;

    // Resolve voice from live voice states: message.member can be null when the
    // member cache is cold (large server / no GuildMembers intent).
    const member =
      message.member ||
      (await message.guild.members.fetch(message.author.id).catch(() => null));
    const voiceState = message.guild.voiceStates.cache.get(message.author.id);
    const voiceChannel =
      member?.voice?.channel ||
      (voiceState?.channelId
        ? message.guild.channels.cache.get(voiceState.channelId)
        : null);

    if (!voiceChannel) {
      const reply = await message.channel.send({
        content: `${emojis.warn} ${message.author}, you must be connected to a voice channel to request songs!`,
      }).catch(() => null);
      if (reply) setTimeout(() => reply.delete().catch(() => {}), 6000);
      return true;
    }

    const voicePerms = voiceChannel.permissionsFor(message.guild.members.me);
    if (!voicePerms?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      const reply = await message.channel.send({
        content: `${emojis.cross} ${message.author}, I lack permission to **Connect** or **Speak** in <#${voiceChannel.id}>!`,
      }).catch(() => null);
      if (reply) setTimeout(() => reply.delete().catch(() => {}), 6000);
      return true;
    }

    let player = client.lavalink.getPlayer(message.guild.id);
    if (!player) {
      player = client.lavalink.createPlayer({
        guildId: message.guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId: message.channel.id,
        selfDeaf: true,
        volume: config.player.defaultVolume,
      });
      player.set("autoplay", config.player.defaultAutoplay ?? false);
    } else if (player.get("autoplay") === undefined) {
      player.set("autoplay", config.player.defaultAutoplay ?? false);
    }

    if (!player.connected) {
      await player.connect();
    }

    try {
      const res = await player.search({ query }, member.user);

      if (!res || !res.tracks || res.tracks.length === 0) {
        const reply = await message.channel.send({
          content: `${emojis.cross} ${message.author}, no audio results found for \`${truncate(query, 50)}\`.`,
        }).catch(() => null);
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 6000);
        return true;
      }

      const capacity = queueCapacity(player);
      if (capacity <= 0) {
        const reply = await message.channel.send({
          content: `${emojis.warn} ${message.author}, the queue is full (${config.player.maxQueueSize} tracks). Wait for it to drain or use \`/clear\`.`,
        }).catch(() => null);
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 6000);
        return true;
      }

      if (res.loadType === "playlist") {
        const playlistTracks = await audioQuality.ensureFullQualityTracks(player, res.tracks, member.user);
        const queued = playlistTracks.slice(0, capacity);
        player.queue.add(queued);
        const cappedNote = playlistTracks.length > queued.length ? ` Queue cap reached at ${config.player.maxQueueSize}.` : "";
        const reply = await message.channel.send({
          content: `${emojis.check} Queued playlist **${truncate(res.playlist?.title || "Playlist", 40)}** (${queued.length} tracks).${cappedNote}`,
        }).catch(() => null);
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 4000);
      } else {
        const track = await audioQuality.ensureFullQualityTrack(player, res.tracks[0], member.user);
        player.queue.add(track);
        const reply = await message.channel.send({
          content: `${emojis.check} Added **${truncate(track.info.title, 45)}** to the queue.`,
        }).catch(() => null);
        if (reply) setTimeout(() => reply.delete().catch(() => {}), 4000);
      }

      if (!player.playing && !player.paused) {
        const voiceStatusManager = require("./voiceStatusManager");
        const nextTrack = player.queue.tracks[0];
        if (nextTrack) voiceStatusManager.onTrackStart(client, player, nextTrack);
        await player.play();
      } else {
        await updateRequestChannelDashboard(client, message.guild.id, player);
      }
    } catch (err) {
      logger.error("Failed to process song request message:", err.message);
    }

    return true;
  });
}

module.exports = {
  buildPlaceholderPayload,
  updateRequestChannelDashboard,
  handleSongRequestMessage,
};
