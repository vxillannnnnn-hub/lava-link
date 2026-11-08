/**
 * Advanced Prefix & Space Parser (Jockie Architecture)
 * - Tolerates flexible spacing: ".play", ". play", ".   play"
 * - Supports bot mention prefixes: "@Bot play", "@Botplay"
 * - Preserves arguments with internal spaces (e.g. multi-word song titles)
 * - Comprehensive command alias resolution
 */

const ALIAS_MAP = new Map([
  // Music Core
  ["p", "play"],
  ["s", "skip"],
  ["next", "skip"],
  ["q", "queue"],
  ["np", "nowplaying"],
  ["now", "nowplaying"],
  ["stop", "stop"],
  ["leave", "stop"],
  ["dc", "stop"],
  ["disconnect", "stop"],
  ["pause", "pause"],
  ["resume", "resume"],
  ["unpause", "resume"],
  ["vol", "volume"],
  ["v", "volume"],
  ["loop", "loop"],
  ["repeat", "loop"],
  ["seek", "seek"],
  ["clear", "clear"],
  ["cls", "clear"],
  ["shuffle", "shuffle"],
  ["shuff", "shuffle"],
  ["remove", "remove"],
  ["rm", "remove"],
  ["move", "move"],
  ["mv", "move"],
  ["swap", "swap"],
  ["lyrics", "lyrics"],
  ["ly", "lyrics"],
  ["grab", "grab"],
  ["save", "grab"],
  ["join", "join"],
  ["summon", "join"],
  ["connect", "join"],
  ["247", "247"],
  ["stay", "247"],
  ["autoplay", "autoplay"],
  ["ap", "autoplay"],
  ["replay", "replay"],
  ["prev", "previous"],
  ["previous", "previous"],
  ["voteskip", "voteskip"],
  ["vs", "voteskip"],
  ["filter", "filter"],
  ["eq", "filter"],
  ["filters", "filter"],
  // Management & Info
  ["prefix", "prefix"],
  ["setprefix", "prefix"],
  ["dj", "dj"],
  ["ping", "ping"],
  ["stats", "stats"],
  ["info", "stats"],
  ["help", "help"],
  ["h", "help"],
  ["playlist", "playlist"],
  ["pl", "playlist"],
  ["settings", "settings"],
  ["config", "settings"],
  ["guildsettings", "settings"],
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse an incoming message for prefix, command name, and space-tolerant arguments
 * @param {import("discord.js").Message} message 
 * @param {string} guildPrefix 
 * @param {import("discord.js").User} clientUser 
 */
function parseMessage(message, guildPrefix = ".", clientUser) {
  if (!message || !message.content) return null;

  const content = message.content.trim();
  if (!content) return null;

  const cleanGuildPrefix = (guildPrefix || ".").trim();
  const escapedPrefix = escapeRegex(cleanGuildPrefix);
  const clientId = clientUser?.id || "";

  // ---------------------------------------------------------------------------
  // 1. Explicit Numbered Prefix Multi-Bot Targeting (Jockie Architecture)
  // e.g. "1.play song", "2.play song", "1.247", "2.247", "1!play", "2!play"
  // ---------------------------------------------------------------------------
  const idxPrefixMatch = content.match(/^([1-9])([.!?~-])\s*(.*)$/);
  if (idxPrefixMatch) {
    const targetBotIndex = parseInt(idxPrefixMatch[1], 10);
    const rem = idxPrefixMatch[3].trim();
    if (rem) {
      const tokens = rem.split(/\s+/);
      const rawCommand = tokens[0].toLowerCase();
      const canonicalCommand = ALIAS_MAP.get(rawCommand) || rawCommand;
      const args = tokens.slice(1);
      const rawArgs = rem.slice(tokens[0].length).trim();
      return {
        commandName: canonicalCommand,
        rawCommand,
        args,
        rawArgs,
        matchedPrefix: `${idxPrefixMatch[1]}${idxPrefixMatch[2]}`,
        isMention: false,
        targetBotIndex,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Prefix-Followed-By-Number Targeting: ".1 play", ".2 play", ".1 247", ".2 247"
  // ---------------------------------------------------------------------------
  const prefixIdxMatch = content.match(/^([.!?~-])([1-9])\s+(.*)$/);
  if (prefixIdxMatch) {
    const targetBotIndex = parseInt(prefixIdxMatch[2], 10);
    const rem = prefixIdxMatch[3].trim();
    if (rem) {
      const tokens = rem.split(/\s+/);
      const rawCommand = tokens[0].toLowerCase();
      const canonicalCommand = ALIAS_MAP.get(rawCommand) || rawCommand;
      const args = tokens.slice(1);
      const rawArgs = rem.slice(tokens[0].length).trim();
      return {
        commandName: canonicalCommand,
        rawCommand,
        args,
        rawArgs,
        matchedPrefix: `${prefixIdxMatch[1]}${prefixIdxMatch[2]} `,
        isMention: false,
        targetBotIndex,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Shorthand "1 play", "2 play", "1 247", "2 247"
  // ---------------------------------------------------------------------------
  const numCmdMatch = content.match(/^([1-9])\s+([a-zA-Z0-9]+)\s*(.*)$/);
  if (numCmdMatch) {
    const targetBotIndex = parseInt(numCmdMatch[1], 10);
    const rawCommand = numCmdMatch[2].toLowerCase();
    const canonicalCommand = ALIAS_MAP.get(rawCommand) || rawCommand;
    // Only match if word is an actual command/alias to avoid intercepting regular user chat numbers
    if (ALIAS_MAP.has(rawCommand) || ["play", "stop", "skip", "pause", "resume", "queue", "247", "join", "volume", "loop", "shuffle"].includes(canonicalCommand)) {
      const rem = numCmdMatch[3] ? numCmdMatch[3].trim() : "";
      const args = rem ? rem.split(/\s+/) : [];
      return {
        commandName: canonicalCommand,
        rawCommand,
        args,
        rawArgs: rem,
        matchedPrefix: `${numCmdMatch[1]} `,
        isMention: false,
        targetBotIndex,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Standard Prefix & Mention Matching
  // ---------------------------------------------------------------------------
  const prefixes = [escapedPrefix];
  if (cleanGuildPrefix !== ".") {
    prefixes.push("\\.");
  }
  const prefixGroup = prefixes.join("|");

  const prefixPattern = new RegExp(`^(<@!?${clientId}>|${prefixGroup})\\s*`, "i");
  const match = content.match(prefixPattern);

  if (!match) return null;

  const matchedPrefixStr = match[0];
  const matchedToken = match[1];
  const isMention = matchedToken.startsWith("<@");

  // Remainder after prefix and any trailing spaces
  const remainder = content.slice(matchedPrefixStr.length).trim();
  if (!remainder) return null;

  // Split remainder into command word and arguments
  const tokens = remainder.split(/\s+/);
  const rawCommand = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const rawArgs = remainder.slice(tokens[0].length).trim();

  // Resolve alias or return canonical command name
  const canonicalCommand = ALIAS_MAP.get(rawCommand) || rawCommand;

  return {
    commandName: canonicalCommand,
    rawCommand,
    args,
    rawArgs,
    matchedPrefix: matchedPrefixStr,
    isMention,
  };
}

module.exports = {
  parseMessage,
  escapeRegex,
  ALIAS_MAP,
};
