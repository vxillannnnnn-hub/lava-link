/**
 * Enterprise SQLite & JSON Dual-Persistence Database Layer (Powered by better-sqlite3)
 * High-performance, synchronous WAL-mode persistence backed by auto-syncing JSON text mirrors:
 * - Guild configurations (Dedicated song-request channels, DJ role settings, prefix routing)
 * - User cloud playlists & saved favorites
 * - Auto-recovers from Git text snapshots across any GitHub Actions restart or cancellation
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

const dataDir = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  logger.info("[Database] Created data directory:", dataDir);
}

const dbPath = path.join(dataDir, "bot.db");
const GUILD_SETTINGS_FILE = path.join(dataDir, "guild_settings.json");
const USER_PLAYLISTS_FILE = path.join(dataDir, "user_playlists.json");
const USER_FAVORITES_FILE = path.join(dataDir, "user_favorites.json");
const BOT_247_FILE = path.join(dataDir, "bot_247_settings.json");

logger.info("[Database] Initializing SQLite database at:", dbPath);

let db;
try {
  db = new Database(dbPath);
  logger.info("[Database] SQLite database connection established");
} catch (err) {
  logger.error("[Database] ❌ FATAL: Failed to initialize better-sqlite3:", err?.message || err);
  logger.error("[Database] This usually means the native module was not compiled correctly.");
  logger.error("[Database] Try: npm rebuild better-sqlite3 --build-from-source");
  throw err;
}

// Enable WAL mode and synchronous normal for ultra-fast disk writes
try {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  logger.info("[Database] WAL mode enabled, synchronous mode set to NORMAL");
} catch (err) {
  logger.error("[Database] Failed to set pragmas:", err?.message);
  throw err;
}

// Initialize Schema
logger.info("[Database] Initializing database schema...");
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      prefix TEXT DEFAULT '.',
      request_channel_id TEXT,
      request_message_id TEXT,
      dj_role_id TEXT,
      dj_enabled INTEGER DEFAULT 0,
      auto_pause_enabled INTEGER DEFAULT 1,
      stage_auto_speaker INTEGER DEFAULT 1,
      multi_ownership INTEGER DEFAULT 0,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      uri TEXT NOT NULL,
      duration INTEGER,
      artwork_url TEXT,
      source_name TEXT,
      added_at INTEGER NOT NULL,
      FOREIGN KEY(playlist_id) REFERENCES user_playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
      user_id TEXT NOT NULL,
      uri TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      duration INTEGER,
      artwork_url TEXT,
      source_name TEXT,
      saved_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, uri)
    );
  `);
  logger.info("[Database] Schema initialized successfully");
} catch (err) {
  logger.error("[Database] Failed to initialize schema:", err?.message);
  throw err;
}

// Safe migration for existing databases: ensure prefix and 24/7 columns exist
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN prefix TEXT DEFAULT '.'");
} catch (_) {}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN mode_247 INTEGER DEFAULT 0");
} catch (_) {}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN voice_247_channel_id TEXT");
} catch (_) {}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN text_247_channel_id TEXT");
} catch (_) {}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN bot_247_user_id TEXT");
} catch (_) {}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN multi_ownership INTEGER DEFAULT 0");
} catch (_) {}

// Multi-Bot 24/7 Fleet Table: enables each bot in a guild to maintain its own 24/7 channel independently
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_247_settings (
      guild_id TEXT NOT NULL,
      bot_user_id TEXT NOT NULL,
      voice_channel_id TEXT NOT NULL,
      text_channel_id TEXT,
      updated_at INTEGER,
      PRIMARY KEY (guild_id, bot_user_id)
    );
  `);
  // Migrate any existing single-bot 24/7 rows from guild_settings
  db.exec(`
    INSERT OR IGNORE INTO bot_247_settings (guild_id, bot_user_id, voice_channel_id, text_channel_id, updated_at)
    SELECT guild_id, coalesce(bot_247_user_id, 'default'), voice_247_channel_id, text_247_channel_id, updated_at
    FROM guild_settings
    WHERE mode_247 = 1 AND voice_247_channel_id IS NOT NULL;
  `);
} catch (err) {
  logger.warn("[Database] bot_247_settings migration note:", err.message);
}

// In-memory prefix cache for sub-microsecond command routing
const prefixCache = new Map();

// Prepared Statements
const stmts = {
  getAllGuilds: db.prepare("SELECT * FROM guild_settings"),
  getGuild: db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?"),
  getPrefix: db.prepare("SELECT prefix FROM guild_settings WHERE guild_id = ?"),
  upsertGuild: db.prepare(`
    INSERT INTO guild_settings (
      guild_id, prefix, request_channel_id, request_message_id,
      dj_role_id, dj_enabled, auto_pause_enabled, stage_auto_speaker,
      mode_247, voice_247_channel_id, text_247_channel_id, bot_247_user_id, multi_ownership, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      prefix = coalesce(excluded.prefix, guild_settings.prefix),
      request_channel_id = coalesce(excluded.request_channel_id, guild_settings.request_channel_id),
      request_message_id = coalesce(excluded.request_message_id, guild_settings.request_message_id),
      dj_role_id = coalesce(excluded.dj_role_id, guild_settings.dj_role_id),
      dj_enabled = excluded.dj_enabled,
      auto_pause_enabled = excluded.auto_pause_enabled,
      stage_auto_speaker = excluded.stage_auto_speaker,
      mode_247 = excluded.mode_247,
      voice_247_channel_id = excluded.voice_247_channel_id,
      text_247_channel_id = excluded.text_247_channel_id,
      bot_247_user_id = coalesce(excluded.bot_247_user_id, guild_settings.bot_247_user_id),
      multi_ownership = excluded.multi_ownership,
      updated_at = excluded.updated_at
  `),
  setPrefix: db.prepare(`
    INSERT INTO guild_settings (guild_id, prefix, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      prefix = excluded.prefix,
      updated_at = excluded.updated_at
  `),
  upsertRequestChannel: db.prepare(`
    INSERT INTO guild_settings (guild_id, request_channel_id, request_message_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      request_channel_id = excluded.request_channel_id,
      request_message_id = excluded.request_message_id,
      updated_at = excluded.updated_at
  `),
  clearRequestChannel: db.prepare(`
    UPDATE guild_settings
    SET request_channel_id = NULL, request_message_id = NULL
    WHERE guild_id = ?
  `),
  upsertDjSettings: db.prepare(`
    INSERT INTO guild_settings (guild_id, dj_role_id, dj_enabled, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      dj_role_id = excluded.dj_role_id,
      dj_enabled = excluded.dj_enabled,
      updated_at = excluded.updated_at
  `),
  upsertMultiOwnership: db.prepare(`
    INSERT INTO guild_settings (guild_id, multi_ownership, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      multi_ownership = excluded.multi_ownership,
      updated_at = excluded.updated_at
  `),
  getMultiOwnership: db.prepare(`
    SELECT multi_ownership FROM guild_settings WHERE guild_id = ?
  `),
  set247: db.prepare(`
    INSERT INTO guild_settings (guild_id, mode_247, voice_247_channel_id, text_247_channel_id, bot_247_user_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      mode_247 = excluded.mode_247,
      voice_247_channel_id = excluded.voice_247_channel_id,
      text_247_channel_id = excluded.text_247_channel_id,
      bot_247_user_id = excluded.bot_247_user_id,
      updated_at = excluded.updated_at
  `),
  get247: db.prepare(`
    SELECT mode_247, voice_247_channel_id, text_247_channel_id, bot_247_user_id FROM guild_settings WHERE guild_id = ?
  `),
  getAll247Guilds: db.prepare(`
    SELECT guild_id, voice_247_channel_id, text_247_channel_id, bot_247_user_id FROM guild_settings
    WHERE mode_247 = 1 AND voice_247_channel_id IS NOT NULL
  `),
  set247Bot: db.prepare(`
    INSERT INTO bot_247_settings (guild_id, bot_user_id, voice_channel_id, text_channel_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, bot_user_id) DO UPDATE SET
      voice_channel_id = excluded.voice_channel_id,
      text_channel_id = excluded.text_channel_id,
      updated_at = excluded.updated_at
  `),
  delete247Bot: db.prepare(`
    DELETE FROM bot_247_settings WHERE guild_id = ? AND (bot_user_id = ? OR bot_user_id = 'default')
  `),
  delete247AllForGuild: db.prepare(`
    DELETE FROM bot_247_settings WHERE guild_id = ?
  `),
  get247Bot: db.prepare(`
    SELECT guild_id, bot_user_id, voice_channel_id, text_channel_id FROM bot_247_settings
    WHERE guild_id = ? AND bot_user_id = ?
  `),
  get247AnyForGuild: db.prepare(`
    SELECT guild_id, bot_user_id, voice_channel_id, text_channel_id FROM bot_247_settings
    WHERE guild_id = ? LIMIT 1
  `),
  getAll247BotsForGuild: db.prepare(`
    SELECT guild_id, bot_user_id, voice_channel_id, text_channel_id FROM bot_247_settings
    WHERE guild_id = ?
  `),
  getAll247Bots: db.prepare(`
    SELECT guild_id, bot_user_id, voice_channel_id, text_channel_id FROM bot_247_settings
    WHERE voice_channel_id IS NOT NULL
  `),
  count247ForGuild: db.prepare(`
    SELECT count(*) as count FROM bot_247_settings WHERE guild_id = ?
  `),
  getAllPlaylistsWithTracks: db.prepare(`
    SELECT p.id as playlist_id, p.user_id, p.name, p.created_at,
           t.id as track_id, t.title, t.author, t.uri, t.duration, t.artwork_url, t.source_name, t.added_at
    FROM user_playlists p
    LEFT JOIN playlist_tracks t ON p.id = t.playlist_id
    ORDER BY p.user_id, p.id, t.id
  `),
  createPlaylist: db.prepare("INSERT INTO user_playlists (user_id, name, created_at) VALUES (?, ?, ?)"),
  getUserPlaylists: db.prepare(`
    SELECT p.*, COUNT(t.id) as track_count
    FROM user_playlists p
    LEFT JOIN playlist_tracks t ON p.id = t.playlist_id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `),
  getPlaylistByName: db.prepare("SELECT * FROM user_playlists WHERE user_id = ? AND LOWER(name) = LOWER(?)"),
  deletePlaylist: db.prepare("DELETE FROM user_playlists WHERE id = ?"),
  addTrackToPlaylist: db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, title, author, uri, duration, artwork_url, source_name, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getPlaylistTracks: db.prepare("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC"),
  removeTrackFromPlaylist: db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND id = ?"),
  getAllFavorites: db.prepare("SELECT * FROM user_favorites ORDER BY user_id, saved_at DESC"),
  addFavorite: db.prepare(`
    INSERT INTO user_favorites (user_id, uri, title, author, duration, artwork_url, source_name, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, uri) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      duration = excluded.duration,
      saved_at = excluded.saved_at
  `),
  getFavorites: db.prepare("SELECT * FROM user_favorites WHERE user_id = ? ORDER BY saved_at DESC LIMIT 100"),
  removeFavorite: db.prepare("DELETE FROM user_favorites WHERE user_id = ? AND uri = ?"),
};

/**
 * Atomic file writer: writes to a temporary file then renames, preventing truncated reads.
 */
function atomicWriteJson(filePath, data) {
  try {
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

// Global dirty flag hookable by StateManager for git pushes
let onStateChangeHook = null;

function notifyChange() {
  if (typeof onStateChangeHook === "function") {
    try {
      onStateChangeHook();
    } catch (_) {}
  }
}

/**
 * Checkpoint WAL to main database file (transfers all writes from bot.db-wal to bot.db)
 */
function checkpoint() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    return true;
  } catch (err) {
    logger.error("[Database] Failed to checkpoint WAL:", err.message);
    return false;
  }
}

/**
 * Export current SQLite data to clean JSON text mirror files.
 * This guarantees Git can diff and track all settings without binary merge conflicts.
 */
function exportJson() {
  try {
    // 1. Export Guild Settings
    const guilds = stmts.getAllGuilds.all();
    const guildMap = {};
    for (const g of guilds) {
      guildMap[g.guild_id] = {
        prefix: g.prefix || ".",
        request_channel_id: g.request_channel_id || null,
        request_message_id: g.request_message_id || null,
        dj_role_id: g.dj_role_id || null,
        dj_enabled: Boolean(g.dj_enabled),
        auto_pause_enabled: g.auto_pause_enabled !== 0,
        stage_auto_speaker: g.stage_auto_speaker !== 0,
        mode_247: Boolean(g.mode_247),
        voice_247_channel_id: g.voice_247_channel_id || null,
        text_247_channel_id: g.text_247_channel_id || null,
        bot_247_user_id: g.bot_247_user_id || null,
        multi_ownership: Boolean(g.multi_ownership),
        updated_at: g.updated_at || Date.now(),
      };
    }
    atomicWriteJson(GUILD_SETTINGS_FILE, guildMap);

    // 2. Export User Playlists with Tracks
    const rawPlaylists = stmts.getAllPlaylistsWithTracks.all();
    const playlistMap = new Map();
    for (const row of rawPlaylists) {
      if (!playlistMap.has(row.playlist_id)) {
        playlistMap.set(row.playlist_id, {
          user_id: row.user_id,
          name: row.name,
          created_at: row.created_at,
          tracks: [],
        });
      }
      if (row.track_id) {
        playlistMap.get(row.playlist_id).tracks.push({
          title: row.title,
          author: row.author,
          uri: row.uri,
          duration: row.duration,
          artwork_url: row.artwork_url,
          source_name: row.source_name,
          added_at: row.added_at,
        });
      }
    }
    atomicWriteJson(USER_PLAYLISTS_FILE, Array.from(playlistMap.values()));

    // 3. Export User Favorites
    const favorites = stmts.getAllFavorites.all();
    atomicWriteJson(USER_FAVORITES_FILE, favorites);

    // 4. Export 24/7 Multi-Bot Fleet Settings
    const all247 = stmts.getAll247Bots.all();
    atomicWriteJson(BOT_247_FILE, all247);

    return true;
  } catch (err) {
    logger.error("[Database] Failed to export JSON mirror:", err.message);
    return false;
  }
}

/**
 * Two-way Self-Healing Synchronization on Startup:
 * Reads existing JSON mirror files and auto-populates SQLite if fresh or missing records.
 * Then immediately checkpoints WAL to disk and updates JSON.
 */
function syncDualStorage() {
  logger.info("[Database] 🔄 Checking dual JSON/SQLite storage synchronization...");
  let importedCount = 0;

  // 1. Synchronize Guild Settings
  if (fs.existsSync(GUILD_SETTINGS_FILE)) {
    try {
      const raw = fs.readFileSync(GUILD_SETTINGS_FILE, "utf8");
      const jsonGuilds = JSON.parse(raw);
      if (jsonGuilds && typeof jsonGuilds === "object") {
        for (const [guildId, data] of Object.entries(jsonGuilds)) {
          const existing = stmts.getGuild.get(guildId);
          // If not in SQLite or JSON has newer/equal updated_at, upsert into SQLite
          if (!existing || (data.updated_at || 0) >= (existing.updated_at || 0)) {
            stmts.upsertGuild.run(
              guildId,
              data.prefix || ".",
              data.request_channel_id || null,
              data.request_message_id || null,
              data.dj_role_id || null,
              data.dj_enabled ? 1 : 0,
              data.auto_pause_enabled === false ? 0 : 1,
              data.stage_auto_speaker === false ? 0 : 1,
              data.mode_247 ? 1 : 0,
              data.voice_247_channel_id || null,
              data.text_247_channel_id || null,
              data.bot_247_user_id || null,
              data.multi_ownership ? 1 : 0,
              data.updated_at || Date.now()
            );
            prefixCache.set(guildId, data.prefix || ".");
            importedCount++;
          }
        }
      }
    } catch (err) {
      logger.warn("[Database] Could not import guild_settings.json:", err.message);
    }
  }

  // 2. Synchronize User Playlists
  if (fs.existsSync(USER_PLAYLISTS_FILE)) {
    try {
      const raw = fs.readFileSync(USER_PLAYLISTS_FILE, "utf8");
      const jsonPlaylists = JSON.parse(raw);
      if (Array.isArray(jsonPlaylists)) {
        for (const pl of jsonPlaylists) {
          if (!pl.user_id || !pl.name) continue;
          let existing = stmts.getPlaylistByName.get(pl.user_id, pl.name);
          let playlistId = existing?.id;
          if (!existing) {
            const res = stmts.createPlaylist.run(pl.user_id, pl.name, pl.created_at || Date.now());
            playlistId = res.lastInsertRowid;
          }
          if (Array.isArray(pl.tracks) && playlistId) {
            const existingTracks = stmts.getPlaylistTracks.all(playlistId);
            const existingUris = new Set(existingTracks.map((t) => t.uri));
            for (const t of pl.tracks) {
              if (!existingUris.has(t.uri)) {
                stmts.addTrackToPlaylist.run(
                  playlistId,
                  t.title || "Unknown Title",
                  t.author || "",
                  t.uri || "",
                  t.duration || 0,
                  t.artwork_url || "",
                  t.source_name || "audio",
                  t.added_at || Date.now()
                );
                existingUris.add(t.uri);
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn("[Database] Could not import user_playlists.json:", err.message);
    }
  }

  // 3. Synchronize User Favorites
  if (fs.existsSync(USER_FAVORITES_FILE)) {
    try {
      const raw = fs.readFileSync(USER_FAVORITES_FILE, "utf8");
      const jsonFavorites = JSON.parse(raw);
      if (Array.isArray(jsonFavorites)) {
        for (const fav of jsonFavorites) {
          if (fav.user_id && fav.uri && fav.title) {
            stmts.addFavorite.run(
              fav.user_id,
              fav.uri,
              fav.title,
              fav.author || "",
              fav.duration || 0,
              fav.artwork_url || "",
              fav.source_name || "audio",
              fav.saved_at || Date.now()
            );
          }
        }
      }
    } catch (err) {
      logger.warn("[Database] Could not import user_favorites.json:", err.message);
    }
  }

  // 4. Synchronize 24/7 Multi-Bot Fleet Settings
  if (fs.existsSync(BOT_247_FILE)) {
    try {
      const raw = fs.readFileSync(BOT_247_FILE, "utf8");
      const json247 = JSON.parse(raw);
      if (Array.isArray(json247)) {
        for (const item of json247) {
          if (item.guild_id && item.voice_channel_id) {
            stmts.set247Bot.run(
              item.guild_id,
              item.bot_user_id || "default",
              item.voice_channel_id,
              item.text_channel_id || null,
              item.updated_at || Date.now()
            );
          }
        }
      }
    } catch (err) {
      logger.warn("[Database] Could not import bot_247_settings.json:", err.message);
    }
  }

  // Immediate WAL Checkpoint and Export JSON to guarantee sync
  checkpoint();
  exportJson();

  logger.info(`[Database] ✅ Storage sync complete. Active guild records: ${stmts.getAllGuilds.all().length} (${importedCount} imported/refreshed)`);
}

// Run synchronization immediately upon module load
syncDualStorage();

module.exports = {
  db,

  // Guild Configuration
  getGuildPrefix(guildId) {
    if (!guildId) return ".";
    if (prefixCache.has(guildId)) return prefixCache.get(guildId);
    const row = stmts.getPrefix.get(guildId);
    const p = row?.prefix || ".";
    prefixCache.set(guildId, p);
    return p;
  },

  setGuildPrefix(guildId, newPrefix) {
    if (!guildId) return;
    const cleanPrefix = (newPrefix || ".").trim();
    prefixCache.set(guildId, cleanPrefix);
    const res = stmts.setPrefix.run(guildId, cleanPrefix, Date.now());
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  getMultiBotOwnership(guildId) {
    if (!guildId) return false;
    const row = stmts.getMultiOwnership.get(guildId);
    return Boolean(row?.multi_ownership);
  },

  setMultiBotOwnership(guildId, enabled) {
    if (!guildId) return;
    const val = enabled ? 1 : 0;
    const res = stmts.upsertMultiOwnership.run(guildId, val, Date.now());
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  getGuildSettings(guildId) {
    return stmts.getGuild.get(guildId) || null;
  },

  setRequestChannel(guildId, channelId, messageId) {
    const res = stmts.upsertRequestChannel.run(guildId, channelId, messageId, Date.now());
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  clearRequestChannel(guildId) {
    const res = stmts.clearRequestChannel.run(guildId);
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  setDjSettings(guildId, roleId, enabled) {
    const res = stmts.upsertDjSettings.run(guildId, roleId, enabled ? 1 : 0, Date.now());
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  set247(guildId, enabled, voiceChannelId = null, textChannelId = null, botUserId = null) {
    try {
      const effectiveBotId = botUserId || "default";
      let res;
      if (enabled) {
        res = stmts.set247Bot.run(
          guildId,
          effectiveBotId,
          voiceChannelId,
          textChannelId,
          Date.now()
        );
        // Also keep guild_settings synchronized for backward compatibility
        stmts.set247.run(
          guildId,
          1,
          voiceChannelId,
          textChannelId,
          effectiveBotId,
          Date.now()
        );
      } else {
        if (botUserId) {
          res = stmts.delete247Bot.run(guildId, botUserId);
        } else {
          res = stmts.delete247AllForGuild.run(guildId);
        }
        const remaining = stmts.count247ForGuild.get(guildId);
        if (!remaining || remaining.count === 0) {
          stmts.set247.run(guildId, 0, null, null, null, Date.now());
        }
      }
      checkpoint();
      exportJson();
      notifyChange();
      return res;
    } catch (err) {
      logger.error(`[Database] Failed to save 24/7 settings for guild ${guildId}:`, err.message);
      return false;
    }
  },

  get247(guildId, botUserId = null) {
    try {
      if (botUserId) {
        let row = stmts.get247Bot.get(guildId, botUserId);
        if (!row) {
          // Check for legacy migrated 'default' entry
          row = stmts.get247Bot.get(guildId, "default");
        }
        if (row) {
          return {
            enabled: true,
            voiceChannelId: row.voice_channel_id || null,
            textChannelId: row.text_channel_id || null,
            botUserId: row.bot_user_id || botUserId,
          };
        }
        return { enabled: false, voiceChannelId: null, textChannelId: null, botUserId: null };
      }

      // If no specific bot requested, check any active 24/7 record for this guild
      const row = stmts.get247AnyForGuild.get(guildId);
      if (row) {
        return {
          enabled: true,
          voiceChannelId: row.voice_channel_id || null,
          textChannelId: row.text_channel_id || null,
          botUserId: row.bot_user_id || null,
        };
      }

      // Fallback to legacy guild_settings row
      const legacy = stmts.get247.get(guildId);
      return {
        enabled: Boolean(legacy?.mode_247),
        voiceChannelId: legacy?.voice_247_channel_id || null,
        textChannelId: legacy?.text_247_channel_id || null,
        botUserId: legacy?.bot_247_user_id || null,
      };
    } catch (err) {
      logger.error(`[Database] Failed to get 24/7 settings for guild ${guildId}:`, err.message);
      return { enabled: false, voiceChannelId: null, textChannelId: null, botUserId: null };
    }
  },

  getAll247Guilds() {
    try {
      const bots = stmts.getAll247Bots.all();
      if (bots && bots.length > 0) {
        return bots.map((b) => ({
          guild_id: b.guild_id,
          voice_247_channel_id: b.voice_channel_id,
          text_247_channel_id: b.text_channel_id,
          bot_247_user_id: b.bot_user_id,
        }));
      }
      return stmts.getAll247Guilds.all();
    } catch (err) {
      logger.error("[Database] Failed to fetch 24/7 guilds:", err.message);
      return [];
    }
  },

  /**
   * All active 24/7 records for a single guild (one row per bot).
   */
  getAll247BotsForGuild(guildId) {
    try {
      return stmts.getAll247Bots.all().filter((row) => row.guild_id === guildId);
    } catch (err) {
      logger.error(`[Database] Failed to get 24/7 bots for guild ${guildId}:`, err.message);
      return [];
    }
  },

  // Playlists
  createPlaylist(userId, name) {
    try {
      const res = stmts.createPlaylist.run(userId, name.trim(), Date.now());
      checkpoint();
      exportJson();
      notifyChange();
      return { id: res.lastInsertRowid, name: name.trim() };
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return null;
      }
      throw err;
    }
  },

  getUserPlaylists(userId) {
    return stmts.getUserPlaylists.all(userId);
  },

  getPlaylist(userId, name) {
    return stmts.getPlaylistByName.get(userId, name.trim()) || null;
  },

  deletePlaylist(playlistId) {
    const res = stmts.deletePlaylist.run(playlistId);
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  addTrackToPlaylist(playlistId, track) {
    const res = stmts.addTrackToPlaylist.run(
      playlistId,
      track.info.title,
      track.info.author || "",
      track.info.uri || "",
      track.info.duration || 0,
      track.info.artworkUrl || "",
      track.info.sourceName || "audio",
      Date.now()
    );
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  getPlaylistTracks(playlistId) {
    return stmts.getPlaylistTracks.all(playlistId);
  },

  removeTrackFromPlaylist(playlistId, id) {
    const res = stmts.removeTrackFromPlaylist.run(playlistId, id);
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  // Favorites
  addFavorite(userId, track) {
    const res = stmts.addFavorite.run(
      userId,
      track.info.uri || track.info.identifier,
      track.info.title,
      track.info.author || "",
      track.info.duration || 0,
      track.info.artworkUrl || "",
      track.info.sourceName || "audio",
      Date.now()
    );
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  getFavorites(userId) {
    return stmts.getFavorites.all(userId);
  },

  removeFavorite(userId, uri) {
    const res = stmts.removeFavorite.run(userId, uri);
    checkpoint();
    exportJson();
    notifyChange();
    return res;
  },

  /**
   * Checkpoint WAL to main database file (transfers all writes from bot.db-wal to bot.db)
   */
  checkpoint,

  /**
   * Export SQLite to JSON mirror files
   */
  exportJson,

  /**
   * Two-way sync
   */
  syncDualStorage,

  /**
   * Register a hook for state mutations (used by periodic Git sync engine)
   */
  setOnStateChangeHook(fn) {
    onStateChangeHook = fn;
  },

  /**
   * Direct access to underlying Database instance
   */
  raw: db,
};
