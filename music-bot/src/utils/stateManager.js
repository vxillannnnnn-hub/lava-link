const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("./logger");
const db = require("../database/db");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STATE_FILE = path.join(DATA_DIR, "active_sessions.json");

/**
 * Enterprise State & Backup Manager
 * - Synchronous WAL database checkpointing
 * - Dual-layer JSON text persistence & mirror synchronization
 * - Captures in-memory active players and queues to active_sessions.json
 * - Periodic & exit git commits to ensure zero data loss in CI/CD environments
 * - Restores voice connections and playback positions across GitHub Actions runner restarts
 */
class StateManager {
  constructor() {
    this.intervalId = null;
    this.gitSyncIntervalId = null;
    this.isRestoring = false;
    this.isDirty = false;
    this.isGitSyncing = false;

    // Connect hook to db.js so any database write marks state as dirty
    if (typeof db.setOnStateChangeHook === "function") {
      db.setOnStateChangeHook(() => this.markDirty());
    }
  }

  markDirty() {
    this.isDirty = true;
  }

  /**
   * Save current active player sessions and queues to disk & ensure WAL is checkpointed
   * @param {import("discord.js").Client | import("discord.js").Client[]} [clientOrClients] 
   */
  saveState(clientOrClients) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Checkpoint SQLite WAL first so bot.db is completely up-to-date
      db.checkpoint();
      db.exportJson();

      const multiBotCoordinator = require("./multiBotCoordinator");
      const clientList = Array.isArray(clientOrClients)
        ? clientOrClients
        : (clientOrClients ? [clientOrClients] : (multiBotCoordinator.clients || []));

      const sessions = [];

      for (const client of clientList) {
        if (!client?.lavalink?.players) continue;

        for (const [guildId, player] of client.lavalink.players.entries()) {
          if (!player || !player.voiceChannelId) continue;

          const is247 = Boolean(player.get("247"));

          // Only save sessions that have an active track, upcoming queue, OR are in 24/7 mode
          if (!player.queue?.current && (!player.queue?.tracks || player.queue.tracks.length === 0) && !is247) continue;

          const currentTrack = player.queue?.current ? {
            encoded: player.queue.current.encoded,
            info: player.queue.current.info,
            requester: player.queue.current.requester,
          } : null;

          const queueTracks = (player.queue?.tracks || []).map((t) => ({
            encoded: t.encoded,
            info: t.info,
            requester: t.requester,
          }));

          sessions.push({
            guildId,
            botUserId: client.user?.id || null,
            voiceChannelId: player.voiceChannelId,
            textChannelId: player.textChannelId,
            position: player.position || 0,
            paused: Boolean(player.paused),
            volume: player.volume || 100,
            repeatMode: player.repeatMode || "off",
            autoplay: Boolean(player.get("autoplay")),
            is247,
            currentTrack,
            queue: queueTracks,
          });
        }
      }

      const payload = {
        savedAt: Date.now(),
        count: sessions.length,
        sessions,
      };

      fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2), "utf8");

      if (sessions.length > 0) {
        logger.info(`[StateManager] Saved ${sessions.length} active voice session(s) across fleet to disk.`);
      }

      return sessions.length;
    } catch (err) {
      logger.error("[StateManager] Failed to save state:", err.message);
      return 0;
    }
  }

  /**
   * Safe synchronous Git auto-sync used on exit / periodic runner sync
   */
  syncToGitSync() {
    if (process.env.GITHUB_ACTIONS !== "true") return;
    try {
      logger.info("[StateManager] 🚀 Syncing persistent database state to repository...");
      db.checkpoint();
      db.exportJson();

      const repoRoot = path.resolve(__dirname, "..", "..");
      const branch = process.env.GITHUB_REF_NAME || "main";
      const gitCmd = [
        'git config user.name "github-actions[bot]"',
        'git config user.email "github-actions[bot]@users.noreply.github.com"',
        'git add -f music-bot/data/guild_settings.json music-bot/data/user_playlists.json music-bot/data/user_favorites.json music-bot/data/active_sessions.json music-bot/data/bot.db 2>/dev/null || true',
        'if ! git diff --staged --quiet; then git commit -m "chore(data): auto-sync bot database & active sessions [skip ci]" && git fetch origin ' + branch + ' && (git rebase -X ours origin/' + branch + ' || (git rebase --abort && git pull --rebase origin ' + branch + ')) && git push origin ' + branch + '; fi'
      ].join(" && ");

      execSync(gitCmd, { cwd: repoRoot, stdio: "pipe", timeout: 45000, shell: "/bin/bash" });
      logger.success("[StateManager] ✅ Persistent database state successfully synced to Git repository.");
      this.isDirty = false;
    } catch (err) {
      logger.warn("[StateManager] Git sync notice:", err?.message || err);
    }
  }

  /**
   * Restore active player sessions after a runner handoff/restart
   * @param {import("discord.js").Client} client 
   */
  async restoreState(client) {
    if (this.isRestoring) return;
    this.isRestoring = true;

    try {
      if (!fs.existsSync(STATE_FILE)) {
        this.isRestoring = false;
        return;
      }

      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const data = JSON.parse(raw);

      if (!data || !Array.isArray(data.sessions) || data.sessions.length === 0) {
        this.isRestoring = false;
        return;
      }

      // If the snapshot is older than 20 minutes, treat it as expired
      const ageMs = Date.now() - (data.savedAt || 0);
      if (ageMs > 20 * 60 * 1000) {
        logger.info(`[StateManager] Snapshot is stale (${Math.round(ageMs / 60000)}m old). Skipping restoration.`);
        fs.unlinkSync(STATE_FILE);
        this.isRestoring = false;
        return;
      }

      logger.info(`[StateManager] Found ${data.sessions.length} session(s) to restore (snapshot age: ${Math.round(ageMs / 1000)}s)...`);

      let restoredCount = 0;

      for (const session of data.sessions) {
        try {
          // If this session belonged to a specific bot in the fleet, let only that bot restore it
          if (session.botUserId && client.user?.id && session.botUserId !== client.user.id) {
            continue;
          }

          const guild = client.guilds.cache.get(session.guildId) || await client.guilds.fetch(session.guildId).catch(() => null);
          if (!guild) continue;

          const voiceChannel = guild.channels.cache.get(session.voiceChannelId) || await guild.channels.fetch(session.voiceChannelId).catch(() => null);
          if (!voiceChannel) continue;

          // Check if voice channel still has active human listeners (skip only if not 24/7)
          const humanListeners = guild.voiceStates.cache.filter(
            (vs) => vs.channelId === session.voiceChannelId && vs.id !== client.user.id
          ).size;

          if (humanListeners === 0 && !session.autoplay && !session.is247) {
            logger.debug(`[StateManager] Voice channel in ${guild.name} is empty. Skipping restore.`);
            continue;
          }

          // Create the player instance
          let player = client.lavalink.getPlayer(session.guildId);
          if (!player) {
            player = client.lavalink.createPlayer({
              guildId: session.guildId,
              voiceChannelId: session.voiceChannelId,
              textChannelId: session.textChannelId,
              selfDeaf: true,
              volume: session.volume || 100,
            });
          }

          player.set("autoplay", session.autoplay);
          player.set("247", Boolean(session.is247));
          if (session.repeatMode && player.setRepeatMode) {
            player.setRepeatMode(session.repeatMode);
          }

          // Populate remaining queue
          if (session.queue && session.queue.length > 0) {
            for (const t of session.queue) {
              try {
                const built = client.lavalink.utils?.buildTrack
                  ? client.lavalink.utils.buildTrack(t, t.requester)
                  : t;
                player.queue.add(built);
              } catch (_) {
                player.queue.add(t);
              }
            }
          }

          // Re-connect to voice channel
          await player.connect();

          // Resume the track that was playing
          if (session.currentTrack) {
            const builtCurrent = client.lavalink.utils?.buildTrack
              ? client.lavalink.utils.buildTrack(session.currentTrack, session.currentTrack.requester)
              : session.currentTrack;

            await player.play({
              clientTrack: builtCurrent,
              track: { encoded: session.currentTrack.encoded },
              position: Math.max(0, (session.position || 0) + (ageMs > 0 && !session.paused ? ageMs : 0)),
              paused: session.paused || false,
            });

            logger.info(
              `[StateManager] Restored playback in "${guild.name}" for "${session.currentTrack.info?.title}" at ${Math.round((session.position || 0) / 1000)}s.`
            );
            restoredCount++;
          } else if (session.is247) {
            const voiceStatusManager = require("./voiceStatusManager");
            voiceStatusManager.setIdleVoiceStatus(client, session.voiceChannelId, session.guildId);
            restoredCount++;
          }
        } catch (sessionErr) {
          logger.warn(`[StateManager] Failed to restore session for guild ${session.guildId}:`, sessionErr.message);
        }
      }

      logger.info(`[StateManager] Successfully restored ${restoredCount}/${data.sessions.length} voice session(s)!`);

      // Clean up snapshot once restored to prevent re-triggering
      try {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      } catch (_) {}
    } catch (err) {
      logger.error("[StateManager] Error during state restoration:", err.message);
    } finally {
      this.isRestoring = false;
    }
  }

  /**
   * Initialize auto-saving every 60 seconds, periodic git backup, and graceful shutdown handlers
   * @param {import("discord.js").Client} client 
   */
  initGracefulPersistence(client) {
    if (this.intervalId) return;

    // 1. Recurring 60-second snapshot across all fleet bots
    this.intervalId = setInterval(() => {
      this.saveState();
    }, 60000);

    // 2. Periodic 3-minute Git sync if dirty in GitHub Actions
    if (process.env.GITHUB_ACTIONS === "true") {
      this.gitSyncIntervalId = setInterval(() => {
        if (this.isDirty && !this.isGitSyncing) {
          this.isGitSyncing = true;
          try {
            this.syncToGitSync();
          } finally {
            this.isGitSyncing = false;
          }
        }
      }, 180000);
      this.gitSyncIntervalId.unref();
    }

    // 3. Process exit handlers (SIGTERM / SIGINT)
    const onExit = (signal) => {
      logger.info(`[StateManager] Received ${signal}. Executing final database checkpoint, state snapshot & sync...`);
      this.saveState();
      this.syncToGitSync();
      process.exit(0);
    };

    process.once("SIGINT", () => onExit("SIGINT"));
    process.once("SIGTERM", () => onExit("SIGTERM"));
  }
}

module.exports = new StateManager();
