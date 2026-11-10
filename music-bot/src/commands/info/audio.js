const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const config = require("../../config");
const emojis = require("../../utils/emojis");
const audioQuality = require("../../utils/audioQuality");
const frameMonitor = require("../../utils/frameMonitor");
const voiceBitrateManager = require("../../utils/voiceBitrateManager");
const { truncate, formatDuration } = require("../../utils/formatters");

// Codec-path knowledge lives in audioQuality so this command and the frame
// monitor can never disagree about what counts as a transcode.
const hasActiveFilters = audioQuality.hasActiveFilters;

/**
 * Describe whether the current track is forwarded bit-exact or re-encoded.
 * @param {import("lavalink-client").Player} player
 * @param {object|null} track
 * @returns {{ label: string, detail: string }}
 */
function describeCodecPath(player, track) {
  if (!track) {
    return { label: "Idle (no track)", detail: "Nothing is being encoded right now." };
  }

  const volume = Number(player?.volume ?? 100);

  if (track.info?.isStream) {
    return {
      label: "Re-encode",
      detail: "Livestreams never yield Opus frames, so the node decodes and re-encodes at opusEncodingQuality.",
    };
  }
  if (hasActiveFilters(player)) {
    return { label: "Re-encode", detail: "An active DSP filter forces PCM decode → Opus encode on the node." };
  }
  if (volume !== 100) {
    return {
      label: "Re-encode",
      detail: `Volume is ${volume}% — any gain other than unity breaks bit-exact Opus passthrough.`,
    };
  }
  if (audioQuality.isMetadataOnlyTrack(track)) {
    return {
      label: "Mirror (transcode likely)",
      detail: `${track.info.sourceName} is metadata-only, so audio comes from a mirror stream that usually needs re-encoding.`,
    };
  }

  const source = String(track.info?.sourceName || "").toLowerCase();
  if (audioQuality.isOpusNativeTrack(track)) {
    return {
      label: "Direct Opus passthrough",
      detail: "Bit-exact Opus frames forwarded to Discord — no decode, no re-encode, no extra latency.",
    };
  }

  return { label: "Unknown path", detail: `Unrecognised source "${source || "unknown"}".` };
}

/**
 * Human readable Lavalink frame health. `deficit` is the number of 20ms audio
 * frames the node failed to send - i.e. audible dropouts.
 */
function describeFrameHealth(frames) {
  if (!frames || (!frames.sent && !frames.deficit && !frames.nulled)) {
    return "Idle (no frames sent yet)";
  }
  const sent = frames.sent || 0;
  const nulled = frames.nulled || 0;
  const deficit = frames.deficit || 0;
  const healthy = deficit <= Math.max(10, sent * 0.01);
  return `${sent} sent • ${nulled} padded • ${deficit} dropped → ${healthy ? "Healthy" : "FRAME DROPS"}`;
}

module.exports = {
  describeCodecPath,
  describeFrameHealth,
  data: new SlashCommandBuilder()
    .setName("audio")
    .setDescription("Diagnose the live audio path: source, codec, bitrate and Lavalink frame drops"),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const player = client.lavalink?.getPlayer(interaction.guildId) || null;
    const node = player?.node || client.lavalink?.nodeManager?.nodes?.values()?.next()?.value || null;
    const track = player?.queue?.current || null;
    const codec = describeCodecPath(player, track);

    // Live, guild-scoped judgement: dropped frames vs node CPU, our transcode
    // count and the volume this player is running at.
    const live = player ? await frameMonitor.guildVerdict(player, client).catch(() => null) : null;

    const voiceChannel = player?.voiceChannelId
      ? client.channels.cache.get(player.voiceChannelId) ||
        (await client.channels.fetch(player.voiceChannelId).catch(() => null))
      : null;

    const channelBitrate = voiceChannel?.bitrate ? `${Math.round(voiceChannel.bitrate / 1000)} kbps` : "N/A";
    const guildMaxBitrate = voiceChannel?.guild?.maximumBitrate
      ? `${Math.round(voiceChannel.guild.maximumBitrate / 1000)} kbps`
      : "N/A";

    const requestedVolume = player?.get?.("requestedVolume");
    const appliedVolume = player?.volume ?? 100;
    const volumeLine =
      Number.isFinite(Number(requestedVolume)) && Number(requestedVolume) !== appliedVolume
        ? `**${appliedVolume}%** applied (asked for ${requestedVolume}%, capped at unity gain)`
        : `**${appliedVolume}%** (${appliedVolume === 100 ? "unity / passthrough" : "attenuated"})`;

    const selfCheck = client.audioSelfCheck;
    const plugins = (selfCheck?.plugins || node?.info?.plugins?.map((p) => `${p.name}@${p.version}`) || []).slice(0, 8);

    const severityEmoji =
      live?.severity === "healthy" ? emojis.check : live?.severity === "critical" ? emojis.cross : emojis.warn;

    const verdictField = {
      name: `${severityEmoji} Live Verdict`,
      value: live
        ? truncate(
            [
              `\u2022 ${live.verdict}`,
              `\u2022 **Frames:** \`${live.droppedFrames}\` dropped / \`${live.sentFrames}\` sent \u2022 \`${live.dropRatePercent.toFixed(1)}%\` over \`${live.windowSeconds}s\``,
              `\u2022 **Node CPU:** \`${live.nodeCpu === null ? "unknown" : `${(live.nodeCpu * 100).toFixed(0)}%`}\` \u2022 **Our players:** \`${live.ourPlayingPlayers}\` (\`${live.ourTranscodingPlayers}\` transcoding)`,
              `\u2022 **Volume:** \`${live.volume}%\` \u2022 **Path:** \`${live.passthrough ? "opus passthrough" : "decode \u2192 re-encode"}\``,
              live.fix
                ? `\u2022 **Fix:** ${live.fix}`
                : "\u2022 **Fix:** none needed \u2014 this guild is already on the lossless path.",
            ].join("\n"),
            1020
          )
        : "No active player in this server. Play something with `/play` for a live measurement.",
      inline: false,
    };

    const embed = new EmbedBuilder()
      .setColor(config.colors.surface || 0x2b2d31)
      .setTitle(`${emojis.equalizer} Audio Path Diagnostics`)
      .setDescription(
        track
          ? `[${truncate(track.info.title, 50)}](${track.info.uri || "https://discord.com"}) — \`${truncate(
              track.info.author || "Unknown",
              30
            )}\``
          : "No active player in this server. Play something with `/play` for a live measurement."
      )
      .addFields(
        verdictField,
        {
          name: "Codec Path",
          value: `• **Mode:** \`${codec.label}\`\n• ${codec.detail}\n• **Volume:** ${volumeLine}`,
          inline: false,
        },
        {
          name: "Source",
          value: track
            ? `• **Platform:** \`${track.info.sourceName || "unknown"}\`${
                audioQuality.isMetadataOnlyTrack(track) ? " (metadata-only → mirror audio)" : " (Opus capable)"
              }\n• **Duration:** \`${track.info.isStream ? "LIVE" : formatDuration(track.info.duration)}\`\n• **Identifier:** \`${track.info.identifier || "n/a"}\``
            : "• **Platform:** `idle`\n• **Duration:** `—`",
          inline: false,
        },
        {
          name: "Voice Delivery",
          value:
            `• **Channel:** ${player?.voiceChannelId ? `<#${player.voiceChannelId}>` : "`not connected`"}\n` +
            `• **Channel bitrate:** \`${channelBitrate}\` (guild max \`${guildMaxBitrate}\`)\n` +
            `• **Auto-tune:** ${voiceBitrateManager.describe(interaction.guildId, voiceChannel)}\n` +
            `• **Listening:** \`${voiceChannel ? Math.max(0, voiceChannel.members.filter((m) => !m.user.bot).size) : 0} human listener(s)\``,
          inline: false,
        },
        {
          name: "Lavalink Node",
          value:
            `• **Version:** \`${selfCheck?.version || node?.info?.version?.semver || "unknown"}\`\n` +
            `• **Audio frames:** ${describeFrameHealth(player?.node?.stats?.frameStats || node?.stats?.frameStats)}\n` +
            `• **CPU (Lavalink):** \`${
              node?.stats?.cpu ? `${((node.stats.cpu.lavalinkLoad || 0) * 100).toFixed(1)}%` : "N/A"
            }\`\n` +
            `• **Plugins:** \`${plugins.length ? truncate(plugins.join(", "), 140) : "unknown"}\``,
          inline: false,
        }
      );

    if (selfCheck?.warnings?.length) {
      embed.addFields({
        name: "Degrading Configuration",
        value: selfCheck.warnings.map((w) => `• ${truncate(w, 220)}`).join("\n"),
        inline: false,
      });
    }

    embed.setFooter({ text: "Frame drops = audible stutter. Fix the node, not the bot process." });

    return interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [], users: [] },
    });
  },
};
