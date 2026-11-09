/**
 * DJ Role & Fair-Queue Permission Manager
 * Enforces server DJ role permissions while maintaining user fairness
 */

const { PermissionsBitField } = require("discord.js");
const db = require("../database/db");
const emojis = require("./emojis");

class DJManager {
  /**
   * Human listeners in a voice channel, resolved from live voice states.
   * `channel.members` only contains cached members, which is wrong on large
   * servers (and after a restart) and would wrongly let someone bypass DJ mode.
   */
  countHumans(guild, channelId, excludeId = null) {
    if (!guild || !channelId) return 0;

    const knownBots = new Set();
    try {
      for (const id of require("./multiBotCoordinator").allBotIds || []) knownBots.add(id);
    } catch (_) {}

    let humans = 0;
    for (const voiceState of guild.voiceStates.cache.values()) {
      if (voiceState.channelId !== channelId || voiceState.id === excludeId) continue;
      const isBot =
        voiceState.member?.user?.bot ||
        guild.members.cache.get(voiceState.id)?.user?.bot ||
        knownBots.has(voiceState.id);
      if (!isBot) humans++;
    }
    return humans;
  }

  /**
   * Check if a member has permission to modify audio state
   * @param {import("discord.js").GuildMember} member 
   * @param {import("lavalink-client").Player} player 
   * @param {boolean} isSkipAction 
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canManagePlayer(member, player, isSkipAction = false) {
    if (!member || !member.guild) {
      return { allowed: false, reason: "Invalid member context." };
    }

    // 1. Server Administrators & Managers always have bypass
    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      member.permissions.has(PermissionsBitField.Flags.ManageChannels)
    ) {
      return { allowed: true };
    }

    const settings = db.getGuildSettings(member.guild.id);
    const djEnabled = Boolean(settings?.dj_enabled && settings?.dj_role_id);

    // If DJ mode is not active, everyone in voice channel can control playback
    if (!djEnabled) {
      return { allowed: true };
    }

    // 2. Member has the designated DJ Role
    if (settings.dj_role_id && member.roles.cache.has(settings.dj_role_id)) {
      return { allowed: true };
    }

    // 3. Alone in the voice channel with the bot (live voice-state count)
    const voiceChannel = member.voice?.channel;
    if (voiceChannel && this.countHumans(member.guild, voiceChannel.id, member.id) === 0) {
      return { allowed: true };
    }

    // 4. Requester can always skip their own track
    if (isSkipAction && player?.queue?.current?.requester?.id === member.id) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `${emojis.warn} This server requires the <@&${settings.dj_role_id}> role or DJ permissions to use this control. You can also use \`/voteskip\` to vote!`,
    };
  }

  /**
   * Calculate required skip votes in a voice channel
   */
  getRequiredVotes(voiceChannel) {
    if (!voiceChannel) return 1;
    const humanCount = this.countHumans(
      voiceChannel.guild,
      voiceChannel.id,
      null
    );
    return Math.max(1, Math.ceil(humanCount / 2));
  }
}

module.exports = new DJManager();
