const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { actionText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Discord Gateway and Lavalink WebSocket latencies"),

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

    return interaction.editReply(
      actionText(
        emojis.ping,
        `Latency: **${discordRoundtrip}ms** (REST) • **${wsPing}ms** (Gateway)`,
        `Lavalink Node: **${nodePing}**${nodeCpu ? ` • CPU **${nodeCpu}**` : ""}\nAudio: ${audioLine}`
      )
    );
  },
};
