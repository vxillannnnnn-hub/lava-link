const { handleSongRequestMessage } = require("../../utils/requestChannelManager");
const { parseMessage } = require("../../utils/prefixParser");
const multiBotCoordinator = require("../../utils/multiBotCoordinator");
const CommandContext = require("../../structures/CommandContext");
const { warnText, errorText } = require("../../utils/responses");
const { runWithClient } = require("../../utils/emojis");
const db = require("../../database/db");
const logger = require("../../utils/logger");

module.exports = {
  name: "messageCreate",
  async execute(message, client) {
    return runWithClient(client, async () => {
    if (!message || message.author?.bot || !message.guild) return;

    // Pin active player now playing embed to bottom of channel if users send messages
    const activePlayer = client.lavalink?.getPlayer(message.guild.id);
    if (activePlayer && activePlayer.queue?.current && activePlayer.textChannelId === message.channel.id) {
      const { keepDashboardAtBottom } = require("../../utils/playerController");
      keepDashboardAtBottom(activePlayer, client, message.channel);
    }

    // 1. Dedicated Song-Request Channel routing (e.g. #song-requests)
    const isRequest = await handleSongRequestMessage(message, client);
    if (isRequest) return;

    // 2. Fetch server prefix (backed by in-memory cache)
    const guildPrefix = db.getGuildPrefix(message.guild.id) || ".";

    // 3. Space-tolerant prefix parsing (.play, . play, .   play, @Bot play, aliases)
    const parsed = parseMessage(message, guildPrefix, client.user);
    if (!parsed) return;

    // 4. Ensure guild member is cached or resolved for permission & voice checks
    if (!message.member && message.guild) {
      try {
        message.member = await message.guild.members.fetch(message.author.id);
      } catch (_) {}
    }

    // 5. Look up matching application command (resolves command name or alias)
    const canonicalName = client.aliases.get(parsed.commandName) || parsed.commandName;
    const command = client.commands.get(canonicalName);
    if (!command) return;

    // 6. Jockie Multi-Bot Coordinator arbitration (guild-aware & session affinity)
    const shouldHandle = multiBotCoordinator.shouldHandle(
      client,
      message,
      client.botIndex || 0,
      { ...parsed, commandName: canonicalName }
    );
    if (!shouldHandle) return;

    // 7. Enforce voice channel safety for music commands (excludes non-voice informational commands, 247, and join)
    const exemptMusicCommands = ["nowplaying", "queue", "lyrics", "grab", "setup-channel", "dj", "playlist", "247", "join"];
    if (command.category === "music" && !exemptMusicCommands.includes(command.data.name)) {
      const voiceState = message.guild.voiceStates.cache.get(message.author.id);
      const userVoiceChannelId = message.member?.voice?.channelId || voiceState?.channelId;

      if (!userVoiceChannelId) {
        return message.reply(
          warnText("You must be connected to a voice channel to use music commands.")
        ).catch(() => message.channel.send(warnText("You must be connected to a voice channel to use music commands.")).catch(() => {}));
      }

      const player = client.lavalink.getPlayer(message.guild.id);
      if (player && player.voiceChannelId && userVoiceChannelId !== player.voiceChannelId) {
        return message.reply(
          warnText(`You must be in the same voice channel (<#${player.voiceChannelId}>) as the bot to use music controls.`)
        ).catch(() => message.channel.send(warnText(`You must be in the same voice channel (<#${player.voiceChannelId}>) as the bot to use music controls.`)).catch(() => {}));
      }
    }

    // 8. Instantiate unified CommandContext adapter
    const ctx = new CommandContext({
      message,
      client,
      commandName: canonicalName,
      args: parsed.args,
      prefix: guildPrefix,
    });

    // 9. Execute command safely with dual reply fallback
    try {
      await command.execute(ctx, client);
    } catch (err) {
      logger.error(`Error executing prefix command "${canonicalName}":`, err);
      try {
        await ctx.reply(errorText(`Error executing command: \`${err.message}\``));
      } catch (_) {}
    }
    });
  },
};
