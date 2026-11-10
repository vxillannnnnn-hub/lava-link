const logger = require("./logger");
const config = require("../config");
const voiceBitrateManager = require("./voiceBitrateManager");

/**
 * Audio Optimizer & Fidelity Tuner
 * - Delegates voice channel bitrate to the adaptive governor (raise, verify,
 *   reconcile drift, back off when the link is dropping frames)
 * - Pre-loads next queued track in background for true 0ms gapless transitions
 */
class AudioOptimizer {
  /**
   * Bring the voice channel to the best bitrate it can actually sustain.
   * Kept as the stable entry point used by join/trackStart/voiceStateUpdate;
   * the governor owns the tier ceiling, drift repair and adaptive steps.
   * @param {import("discord.js").VoiceChannel|import("discord.js").StageChannel} voiceChannel
   * @param {import("discord.js").Client} client
   */
  async maximizeVoiceBitrate(voiceChannel, client) {
    if (!config.player.autoMaximizeBitrate) return null;
    return voiceBitrateManager.ensure(voiceChannel, client, {
      reason: "AudioOptimizer: voice channel tuned for the best sustainable fidelity",
    });
  }

  /**
   * Preload the next track in the queue in background so the transition when current track ends is 0ms
   * @param {import("lavalink-client").Player} player 
   */
  async preloadNextQueueTrack(player) {
    if (!config.player.gaplessPreload) return;
    if (!player || !player.queue || player.queue.tracks.length === 0) return;

    const nextTrack = player.queue.tracks[0];
    if (!nextTrack || nextTrack._preloaded) return;

    try {
      // Only mark after the node check: marking first left the track flagged as
      // warmed even when nothing was pre-fetched.
      const node = player.node;
      if (!node || !node.connected) return;

      // Mark as preloading to avoid duplicate calls
      nextTrack._preloaded = true;

      logger.debug(
        `[AudioOptimizer] Pre-warming next track in queue: "${nextTrack.info?.title}" for guild ${player.guildId}`
      );

      // Verify node has track pre-cached or warm up search if needed
      if (!nextTrack.encoded && nextTrack.info?.uri) {
        const res = await player.search(
          { query: nextTrack.info.uri },
          player.queue.current?.requester || null
        ).catch(() => null);

        if (res?.tracks && res.tracks.length > 0 && res.tracks[0].encoded) {
          nextTrack.encoded = res.tracks[0].encoded;
        }
      }
    } catch (err) {
      logger.debug(`[AudioOptimizer] Preload error (non-fatal): ${err.message}`);
    }
  }
}

module.exports = new AudioOptimizer();
