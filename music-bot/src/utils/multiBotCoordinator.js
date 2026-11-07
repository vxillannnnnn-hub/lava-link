const { errorText, warnText } = require("./responses");
const logger = require("./logger");

/**
 * Jockie Multi-Bot Coordinator
 * Coordinates multiple bot instances (Pulse, Pulse 1, Pulse 2, etc.) running concurrently
 * in Discord servers without duplicate responses, channel collisions, or race conditions.
 * 
 * Bulletproof Arbitration Rules:
 * 1. Guild-Aware: Candidates are filtered to ONLY bots present in the message's guild.
 *    If only 1 bot is in the server, that bot handles 100% of commands.
 * 2. Explicit Mention Targeting: If a user specifies @Pulse 1 play, only Pulse 1 handles it.
 * 3. Session Affinity: If a bot is already playing in the user's VC, only that bot handles commands.
 * 4. Idle Bot Allocation: In multi-bot servers, commands allocate to the first available idle bot.
 * 5. Reliable Voice State Lookup: Resolves via guild.voiceStates.cache directly (survives uncached members).
 */
class MultiBotCoordinator {
  constructor() {
    this.clients = [];
    const envIds = process.env.ALL_BOT_IDS
      ? process.env.ALL_BOT_IDS.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (process.env.CLIENT_ID && !envIds.includes(process.env.CLIENT_ID.trim())) {
      envIds.push(process.env.CLIENT_ID.trim());
    }
    this.allBotIds = envIds;
  }

  /**
   * Register a live BotClient instance in memory
   * @param {import("discord.js").Client} client 
   */
  registerClient(client) {
    if (!client) return;
    if (!this.clients.some((c) => c === client || (c.user?.id && c.user.id === client.user?.id))) {
      this.clients.push(client);
    }
    if (client.user?.id && !this.allBotIds.includes(client.user.id)) {
      this.allBotIds.push(client.user.id);
    }
  }

  /**
   * Register known bot IDs into the coordinator pool
   * @param {Array<string>} botIds 
   */
  registerBotIds(botIds) {
    if (Array.isArray(botIds)) {
      this.allBotIds = [...new Set([...this.allBotIds, ...botIds.filter(Boolean)])];
    }
  }

  /**
   * Determine whether THIS bot instance should process this incoming prefix command
   * @param {import("discord.js").Client} client 
   * @param {import("discord.js").Message} message 
   * @param {number} botIndex (0 = Primary, 1 = Clone 1, 2 = Clone 2, etc.)
   * @param {object} parsed { commandName, rawArgs, isMention }
   * @returns {boolean} Whether this bot instance should execute the command
   */
  shouldHandle(client, message, botIndex = 0, parsed) {
    const guild = message.guild;
    if (!guild) return false;

    // Ensure our own client is registered
    this.registerClient(client);

    // -------------------------------------------------------------------------
    // Rule 1: Determine which fleet bots are ACTUALLY present in this guild
    // -------------------------------------------------------------------------
    let botsInGuild = this.clients.filter((c) => c.user?.id && c.guilds.cache.has(guild.id));

    // Fallback if standalone client or only current client is tracked
    if (botsInGuild.length === 0) {
      botsInGuild = [client];
    }

    // Sort in consistent order by botIndex or user ID
    botsInGuild.sort((a, b) => (a.botIndex ?? 0) - (b.botIndex ?? 0));

    const currentBotId = client.user.id;

    // SINGLE BOT IN THIS GUILD: Immediately claim 100% of commands!
    if (botsInGuild.length === 1) {
      return currentBotId === botsInGuild[0].user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 2: Explicit Bot Mention Targeting (@Pulse 1 play)
    // -------------------------------------------------------------------------
    if (parsed.isMention) {
      if (message.mentions.users.has(currentBotId)) {
        return true;
      }
      // If user mentioned another bot in our fleet, stay silent
      if (botsInGuild.some((b) => b.user.id !== currentBotId && message.mentions.users.has(b.user.id))) {
        return false;
      }
    }

    // -------------------------------------------------------------------------
    // Rule 3: Non-Voice Informational & Management Commands
    // -------------------------------------------------------------------------
    const nonVoiceCommands = [
      "help", "ping", "stats", "prefix", "dj", "setup-channel",
      "playlist", "nowplaying", "queue", "lyrics", "grab"
    ];
    if (nonVoiceCommands.includes(parsed.commandName)) {
      // The lowest-indexed bot present in this guild handles non-voice commands
      return currentBotId === botsInGuild[0].user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 4: Resolve User Voice Channel (Survives Uncached Members)
    // -------------------------------------------------------------------------
    const voiceState = guild.voiceStates.cache.get(message.author.id);
    const userVoiceChannelId = message.member?.voice?.channelId || voiceState?.channelId;

    if (!userVoiceChannelId) {
      // User is not in any voice channel: lowest-indexed bot notifies user once
      if (currentBotId === botsInGuild[0].user.id) {
        message.reply(errorText("You need to be in a voice channel to play music!")).catch(() => {});
      }
      return false;
    }

    // -------------------------------------------------------------------------
    // Rule 5: Active Voice Channel Affinity (Session Owner)
    // -------------------------------------------------------------------------
    // If any bot in this guild is already connected to user's VC, ONLY that bot responds!
    const botInUserChannel = botsInGuild.find((b) => {
      const vs = guild.voiceStates.cache.get(b.user.id);
      return vs && vs.channelId === userVoiceChannelId;
    });

    if (botInUserChannel) {
      return currentBotId === botInUserChannel.user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 6: Idle Bot Allocation (Next Available Instance in this Guild)
    // -------------------------------------------------------------------------
    const firstIdleBot = botsInGuild.find((b) => {
      const vs = guild.voiceStates.cache.get(b.user.id);
      return !vs || !vs.channelId;
    });

    if (firstIdleBot) {
      return currentBotId === firstIdleBot.user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 7: All Bot Slots in this Server are Busy
    // -------------------------------------------------------------------------
    if (currentBotId === botsInGuild[0].user.id) {
      message.reply(
        warnText(
          `All **${botsInGuild.length}** music bot slots in this server are currently active in other voice channels!`
        )
      ).catch(() => {});
    }

    return false;
  }
}

module.exports = new MultiBotCoordinator();
