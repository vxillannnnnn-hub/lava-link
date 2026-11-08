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
   * Check whether a user already has an active playback session in another voice channel
   * when multi-bot ownership is disabled (anti-hogging protection).
   * @param {import("discord.js").Guild} guild
   * @param {string} userId
   * @param {string} targetVoiceChannelId
   * @returns {{ bot: import("discord.js").Client, channelId: string } | null}
   */
  checkUserSessionConflict(guild, userId, targetVoiceChannelId) {
    if (!guild || !userId) return null;
    const db = require("../database/db");
    const isMultiAllowed = db.getMultiBotOwnership(guild.id);
    if (isMultiAllowed) return null;

    let botsInGuild = this.clients.filter((c) => c.user?.id && c.guilds.cache.has(guild.id));
    if (botsInGuild.length <= 1) return null;

    for (const bot of botsInGuild) {
      const player = bot.lavalink?.getPlayer(guild.id);
      if (!player || !player.voiceChannelId) continue;
      if (player.voiceChannelId === targetVoiceChannelId) continue;

      const isActive = player.playing || player.paused || Boolean(player.queue?.current);
      if (!isActive) continue;

      const isOwner =
        player.get("ownerId") === userId ||
        player.queue?.current?.requester?.id === userId ||
        (Array.isArray(player.queue?.tracks) && player.queue.tracks.some((t) => t.requester?.id === userId));

      if (isOwner) {
        return { bot, channelId: player.voiceChannelId };
      }
    }

    return null;
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
    // Rule 2: Explicit Bot Targeting (Mentions e.g. "@Pulse 1 play" or Index e.g. "2.play")
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

    if (typeof parsed.targetBotIndex === "number") {
      const targetIndex = parsed.targetBotIndex - 1; // 1 = Primary (index 0), 2 = Clone 1 (index 1), etc.
      const targetBot = botsInGuild.find((b) => (b.botIndex ?? 0) === targetIndex);
      if (targetBot) {
        return currentBotId === targetBot.user.id;
      }
      // If user targeted a bot slot that isn't in this guild, lowest-index bot notifies user
      if (currentBotId === botsInGuild[0].user.id) {
        message.reply(warnText(`Bot slot **#${parsed.targetBotIndex}** is not present in this server.`)).catch(() => {});
      }
      return false;
    }

    // -------------------------------------------------------------------------
    // Rule 3: Session Player Info Commands (nowplaying, queue, lyrics, grab)
    // Always routes to the bot connected to the user's current voice channel!
    // -------------------------------------------------------------------------
    const sessionInfoCommands = ["nowplaying", "queue", "lyrics", "grab"];
    if (sessionInfoCommands.includes(parsed.commandName)) {
      const voiceState = guild.voiceStates.cache.get(message.author.id);
      const userVoiceChannelId = message.member?.voice?.channelId || voiceState?.channelId;

      if (userVoiceChannelId) {
        const botInUserChannel = botsInGuild.find((b) => {
          const vs = guild.voiceStates.cache.get(b.user.id);
          return vs && vs.channelId === userVoiceChannelId;
        });
        if (botInUserChannel) {
          return currentBotId === botInUserChannel.user.id;
        }
      }

      // If user is not in a VC or no bot in user's VC, route to the first active streaming bot
      const activeBot = botsInGuild.find((b) => {
        const p = b.lavalink?.getPlayer(guild.id);
        return p && (p.playing || p.queue?.current);
      });
      if (activeBot) {
        return currentBotId === activeBot.user.id;
      }

      // Fallback: lowest-indexed bot
      return currentBotId === botsInGuild[0].user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 4: Non-Voice Informational & Guild Management Commands
    // -------------------------------------------------------------------------
    const nonVoiceCommands = [
      "help", "ping", "stats", "prefix", "dj", "setup-channel", "playlist", "settings", "config"
    ];
    if (nonVoiceCommands.includes(parsed.commandName)) {
      // The lowest-indexed bot present in this guild handles non-voice commands
      return currentBotId === botsInGuild[0].user.id;
    }

    // -------------------------------------------------------------------------
    // Rule 5: Resolve User Voice Channel (Survives Uncached Members)
    // -------------------------------------------------------------------------
    const voiceState = guild.voiceStates.cache.get(message.author.id);
    const userVoiceChannelId = message.member?.voice?.channelId || voiceState?.channelId;

    if (!userVoiceChannelId) {
      // User is not in any voice channel: lowest-indexed bot notifies user once
      if (currentBotId === botsInGuild[0].user.id) {
        message.reply(errorText("You need to be in a voice channel to use music commands!")).catch(() => {});
      }
      return false;
    }

    // -------------------------------------------------------------------------
    // Rule 6: Active Voice Channel Affinity (Session Owner)
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
    // Rule 7: Multi-Bot Session Ownership Guard (Anti-Hogging Protection)
    // -------------------------------------------------------------------------
    const playCommands = ["play", "join", "search"];
    if (playCommands.includes(parsed.commandName)) {
      const conflict = this.checkUserSessionConflict(guild, message.author.id, userVoiceChannelId);
      if (conflict) {
        if (currentBotId === botsInGuild[0].user.id) {
          const botName = conflict.bot.user?.username || "Pulse";
          message.reply(
            warnText(
              `You already have an active playback session with **${botName}** in <#${conflict.channelId}>.`,
              `Finish that session or ask an administrator to enable multi-room playback using \`/settings multi-ownership enable\`.`
            )
          ).catch(() => {});
        }
        return false;
      }
    }

    // -------------------------------------------------------------------------
    // Rule 8: Idle Bot Allocation (Next Available Instance in this Guild)
    // -------------------------------------------------------------------------
    const firstIdleBot = botsInGuild.find((b) => {
      const vs = guild.voiceStates.cache.get(b.user.id);
      if (vs && vs.channelId) return false;

      const p = b.lavalink?.getPlayer(guild.id);
      if (p && (p.voiceChannelId || p.connecting)) return false;

      // In-memory pending reservation lock (5-second window during gateway handshake)
      if (b._pendingVoiceChannelId && (Date.now() - (b._pendingVoiceTimestamp || 0)) < 5000) {
        return false;
      }

      return true;
    });

    if (firstIdleBot) {
      if (currentBotId === firstIdleBot.user.id) {
        firstIdleBot._pendingVoiceChannelId = userVoiceChannelId;
        firstIdleBot._pendingVoiceTimestamp = Date.now();
        return true;
      }
      return false;
    }

    // -------------------------------------------------------------------------
    // Rule 9: All Bot Slots in this Server are Busy
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
