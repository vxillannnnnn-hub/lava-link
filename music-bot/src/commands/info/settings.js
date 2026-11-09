const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { errorText, successText } = require("../../utils/responses");
const emojis = require("../../utils/emojis");
const config = require("../../config");
const db = require("../../database/db");
const multiBotCoordinator = require("../../utils/multiBotCoordinator");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("View or configure server settings and multi-bot session policies")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View the complete server music configuration and multi-bot fleet status")
    )
    .addSubcommand((sub) =>
      sub
        .setName("multi-ownership")
        .setDescription("Configure whether a single user can run multiple bots in different voice channels")
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("enable: allow multi-room control | disable: enforce anti-hogging (default)")
            .setRequired(true)
            .addChoices(
              { name: "Enable (Allow multi-room control per user)", value: "enable" },
              { name: "Disable (Enforce anti-hogging: 1 room per user)", value: "disable" }
            )
        )
    ),

  aliases: ["config", "guildsettings"],

  async execute(interaction, client) {
    const guildId = interaction.guildId;
    if (!guildId) return;

    let subcommand = null;
    try {
      subcommand = interaction.options.getSubcommand(false);
    } catch (_) {}

    // -------------------------------------------------------------------------
    // Subcommand: multi-ownership (Toggle Anti-Hogging Session Protection)
    // -------------------------------------------------------------------------
    if (subcommand === "multi-ownership") {
      const member = interaction.member;
      const hasAdmin =
        member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        member?.permissions?.has(PermissionFlagsBits.ManageGuild);

      if (!hasAdmin) {
        return interaction.reply(
          errorText("You need the `Manage Server` or `Administrator` permission to change server settings.")
        );
      }

      const rawMode = interaction.options.getString("mode");
      const mode = (rawMode || "").toLowerCase().trim();

      if (["enable", "true", "on", "1"].includes(mode)) {
        db.setMultiBotOwnership(guildId, true);
        return interaction.reply(
          successText(
            "Multi-Bot Session Ownership is now **Enabled**.",
            "Users can now control multiple bot instances across different voice channels simultaneously."
          )
        );
      } else if (["disable", "false", "off", "0"].includes(mode)) {
        db.setMultiBotOwnership(guildId, false);
        return interaction.reply(
          successText(
            "Multi-Bot Session Ownership is now **Disabled** (Anti-Hogging Active).",
            "A single user can only have one active voice session at a time, preventing multi-room slot hogging."
          )
        );
      } else {
        return interaction.reply(
          errorText("Invalid mode. Use `enable` or `disable`.", "Example: `/settings multi-ownership mode:enable` or `.settings multi-ownership enable`")
        );
      }
    }

    // -------------------------------------------------------------------------
    // Subcommand: view (or default display)
    // -------------------------------------------------------------------------
    const currentPrefix = db.getGuildPrefix(guildId) || config.prefix.default;
    const multiOwnership = db.getMultiBotOwnership(guildId);
    const guildRow = db.getGuildSettings(guildId);

    // Fleet presence in this guild
    const botsInGuild = (multiBotCoordinator.clients || []).filter(
      (c) => c.user?.id && c.guilds?.cache?.has(guildId)
    );
    botsInGuild.sort((a, b) => (a.botIndex ?? 0) - (b.botIndex ?? 0));

    // 24/7 settings for this guild
    const all247 = db.getAll247BotsForGuild(guildId);
    const active247List = all247.length > 0
      ? all247.map((r) => {
          const matchedBot = botsInGuild.find((b) => b.user.id === r.bot_user_id);
          const name = matchedBot ? matchedBot.user.username : (r.bot_user_id === "default" ? "Primary Bot" : `Bot ${r.bot_user_id}`);
          return `• **${name}:** <#${r.voice_channel_id}>`;
        }).join("\n")
      : "• *None active*";

    // DJ role status
    const djEnabled = Boolean(guildRow?.dj_enabled);
    const djRoleText = guildRow?.dj_role_id
      ? `<@&${guildRow.dj_role_id}> (${djEnabled ? "Enforced" : "Configured, but DJ mode disabled"})`
      : "• *None (Everyone has DJ permissions)*";

    // Dedicated song request channel
    const requestChannelText = guildRow?.request_channel_id
      ? `<#${guildRow.request_channel_id}>`
      : "• *None configured (`/setup-channel` to create)*";

    // Fleet bot roster
    const fleetRosterText = botsInGuild.length > 0
      ? botsInGuild.map((b) => {
          const indexNum = (b.botIndex ?? 0) + 1;
          const player = b.lavalink?.getPlayer(guildId);
          let status = `${emojis.offline} Idle`;
          if (player?.voiceChannelId) {
            status = player.playing ? `${emojis.online} Streaming in <#${player.voiceChannelId}>` : `${emojis.online} Connected in <#${player.voiceChannelId}>`;
          }
          return `• **#${indexNum} ${b.user.username}:** ${status}`;
        }).join("\n")
      : "• *1 bot active*";

    const embed = new EmbedBuilder()
      .setColor(config.colors.surface || 0x2b2d31)
      .setTitle(`${emojis.gear} Guild Audio Configuration`)
      .setDescription(
        `Current server policies, bot prefix, and multi-bot cluster arbitration status for **${interaction.guild?.name || "this server"}**.\n`
      )
      .addFields(
        {
          name: `${emojis.stage} Command Routing & Prefix`,
          value:
            `• **Server Prefix:** \`${currentPrefix}\`\n` +
            `• **Flexible Spacing:** Supported (e.g. \`${currentPrefix}play\` or \`${currentPrefix} play\`)\n` +
            `• **Slot Targeting:** Supported (e.g. \`1.play\`, \`2.play\`, \`@Bot play\`)`,
          inline: false,
        },
        {
          name: `${emojis.users} Multi-Bot Session Policy (Anti-Hogging)`,
          value: multiOwnership
            ? `• **Mode:** \`Enabled\` ${emojis.check}\n-# Users can stream and control bots across multiple voice channels simultaneously.`
            : `• **Mode:** \`Disabled\` (Anti-Hogging Active) ${emojis.cross}\n-# Each user is restricted to 1 active voice channel session to keep bot slots open for others.\n-# Toggle using \`/settings multi-ownership mode:enable\`.`,
          inline: false,
        },
        {
          name: `${emojis.radio} 24/7 Voice Channel Stay Mode`,
          value: active247List,
          inline: false,
        },
        {
          name: `${emojis.dj} DJ System Protection`,
          value: djRoleText,
          inline: false,
        },
        {
          name: `${emojis.channel} Dedicated Song-Request Channel`,
          value: requestChannelText,
          inline: false,
        },
        {
          name: `${emojis.stats} Bot Fleet Roster (${botsInGuild.length} Slot${botsInGuild.length === 1 ? "" : "s"})`,
          value: fleetRosterText,
          inline: false,
        }
      )
      .setFooter({
        text: "Pulse Multi-Bot Fleet • Jockie Arbitration Engine",
      })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [], users: [] },
    });
  },
};
