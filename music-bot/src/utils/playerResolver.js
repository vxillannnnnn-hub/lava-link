/**
 * Fleet-aware player resolver
 *
 * The bot fleet (Pulse, Pulse 1, Pulse 2, ...) runs several Discord clients in
 * the same Node process and shares one Lavalink node. Each client keeps its own
 * `lavalink.players` map, so a slash command received by a clone that is not the
 * one currently streaming would otherwise report an empty queue even though
 * music is audibly playing from a sibling bot.
 *
 * This helper picks the most relevant player across the whole fleet, preferring:
 *   1. a player connected to the voice channel the user is currently in
 *   2. a player that is actually playing / paused / has a current track
 *   3. the client that received the interaction on ties
 */

function playerActivityScore(player) {
  if (!player) return 0;
  let score = 0;
  if (player.queue?.current) score += 5;
  if (player.playing) score += 3;
  if (player.paused) score += 1;
  if (Array.isArray(player.queue?.tracks) && player.queue.tracks.length > 0) score += 1;
  return score;
}

function isActivePlayer(player) {
  return playerActivityScore(player) > 0;
}

/**
 * @param {import("discord.js").Client} client client that received the interaction
 * @param {string} guildId
 * @param {{ userId?: string, voiceChannelId?: string | null }} [context]
 * @returns {{ player: any, client: import("discord.js").Client } | null}
 */
function resolveFleetPlayer(client, guildId, context = {}) {
  if (!client || !guildId) return null;

  const clients = new Set([client]);
  try {
    // All fleet clients live in the same process, so this is a cheap in-memory scan.
    const multiBotCoordinator = require("./multiBotCoordinator");
    for (const fleetClient of multiBotCoordinator.clients || []) {
      clients.add(fleetClient);
    }
  } catch (_) {
    // Standalone deployment: only the current client exists.
  }

  const { voiceChannelId } = context;
  let best = null;

  for (const fleetClient of clients) {
    const player = fleetClient?.lavalink?.getPlayer?.(guildId);
    if (!player) continue;

    let score = playerActivityScore(player);
    if (voiceChannelId && player.voiceChannelId === voiceChannelId) score += 100;
    if (fleetClient === client) score += 1;

    if (!best || score > best.score) {
      best = { player, client: fleetClient, score };
    }
  }

  // Nothing playing anywhere: only report the interaction client's own player.
  if (!best || !isActivePlayer(best.player)) {
    const ownPlayer = client.lavalink?.getPlayer?.(guildId);
    return ownPlayer ? { player: ownPlayer, client } : null;
  }

  return { player: best.player, client: best.client };
}

/**
 * Convenience wrapper returning just the player.
 */
function getFleetPlayer(client, guildId, context = {}) {
  return resolveFleetPlayer(client, guildId, context)?.player || null;
}

module.exports = {
  resolveFleetPlayer,
  getFleetPlayer,
  isActivePlayer,
  playerActivityScore,
};
