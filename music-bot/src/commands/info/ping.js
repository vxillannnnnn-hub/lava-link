const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { actionText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const frameMonitor = require("../../utils/frameMonitor");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check gateway/Lavalink latency and measure live audio jitter"),

  async execute(interaction, client) {
    const sent = await interaction.reply({
      content: `${emojis.ping} Checking network latency...`,
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
    const discordRoundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = client.ws.ping;

    const node = client.lavalink.nodeManager.nodes.values().next().value;
    let nodePing = "Connected";
    let nodeCpu = null;

    if (node && node.connected) {
      const start = Date.now();
      try {
        await node.fetchVersion();
        nodePing = `${Date.now() - start}ms`;
      } catch {
        nodePing = "Connected";
      }
      if (node.stats?.cpu) {
        nodeCpu = `${((node.stats.cpu.lavalinkLoad || 0) * 100).toFixed(1)}%`;
      }
    }

    // Real audio health. Lavalink reports every 20ms Opus frame it sent, padded
    // (nulled) or missed (deficit). A non-zero deficit is exactly what listeners
    // hear as crackling/stutter - a low gateway ping does not rule it out.
    const player = client.lavalink.getPlayer(interaction.guildId);
    const frames = player?.node?.stats?.frameStats || node?.stats?.frameStats;
    let audioLine = "Idle (no frames sent yet)";

    if (frames && (frames.sent || frames.deficit || frames.nulled)) {
      const sent = frames.sent || 0;
      const nulled = frames.nulled || 0;
      const deficit = frames.deficit || 0;
      const healthy = deficit <= Math.max(10, sent * 0.01);
      audioLine = `${sent} frames sent • ${nulled} padded • ${deficit} dropped → ${healthy ? "Healthy" : "FRAME DROPS (node under load / poor node-to-Discord route)"}`;
    }

    // Live jitter: the lines above are lifetime counters, which cannot show a
    // periodic stall. This takes two fresh readings 2s apart and reports the
    // per-second rates a listener would actually hear.
    let jitterLine = "Jitter: `node not connected`";
    if (node?.connected) {
      try {
        const jitter = await frameMonitor.sampleLiveJitter(node, { windowMs: 2000 });
        if (!jitter.available) {
          jitterLine = `Jitter: unavailable (${jitter.reason})`;
        } else if (jitter.playing > 0) {
          jitterLine =
            `Jitter (${(jitter.windowMs / 1000).toFixed(1)}s): sent **${jitter.sentPerSecond.toFixed(1)}/s**` +
            ` • dropped **${jitter.droppedPerSecond.toFixed(1)}/s**` +
            ` • nulled **${jitter.nulledPerSecond.toFixed(1)}/s**` +
            ` → ${jitter.verdict}`;
        } else {
          jitterLine = `Jitter: ${jitter.verdict}`;
        }
      } catch (err) {
        jitterLine = `Jitter: unavailable (${err?.message || err})`;
      }
    }

    return interaction.editReply(
      actionText(
        emojis.ping,
        `Latency: **${discordRoundtrip}ms** (REST) • **${wsPing}ms** (Gateway)`,
        `Lavalink Node: **${nodePing}**${nodeCpu ? ` • CPU **${nodeCpu}**` : ""}\nAudio: ${audioLine}\n${jitterLine}`
      )
    );
  },
};
