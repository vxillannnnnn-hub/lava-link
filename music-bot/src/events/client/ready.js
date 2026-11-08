const { Events } = require("discord.js");
const logger = require("../../utils/logger");
const stateManager = require("../../utils/stateManager");
const multiBotCoordinator = require("../../utils/multiBotCoordinator");
const presenceManager = require("../../utils/presenceManager");
const { start247HealthCheck } = require("../../utils/reconnect247");
const emojis = require("../../utils/emojis");

module.exports = {
  name: Events.ClientReady || "clientReady",
  once: true,
  async execute(client) {
    const shardInfo = client.shard
      ? `[Shard #${client.shard.ids[0]}/${client.shard.count}] `
      : "";

    logger.success(`${shardInfo}Logged in as ${client.user.tag} (ID: ${client.user.id}) [Bot Index: ${client.botIndex || 0}]`);
    logger.info(
      `${shardInfo}Serving ${client.guilds.cache.size} local guild(s) and ${client.users.cache.size} cached user(s).`
    );

    // Register this bot's user ID into multi-bot coordinator
    multiBotCoordinator.registerBotIds([client.user.id]);
    multiBotCoordinator.registerClient(client);

    // Dynamic Discord Application Emoji Fetch & Cache (Per-Bot Context)
    if (client.application?.emojis) {
      try {
        const fetchedEmojis = await client.application.emojis.fetch();
        client.emojisMap = {};
        for (const emoji of fetchedEmojis.values()) {
          client.emojisMap[emoji.name.toLowerCase()] = emoji.toString();
        }
        emojis.registerBotEmojis(client.user.id, client.emojisMap);
        logger.success(`${shardInfo}Cached ${fetchedEmojis.size} Discord Application Emojis for ${client.user.tag}`);
      } catch (err) {
        logger.debug(`${shardInfo}Application emojis live fetch notice: ${err.message}`);
      }
    }

    // Initialize Lavalink Manager with Bot Client credentials
    await client.lavalink.init({
      id: client.user.id,
      username: client.user.username,
    });

    // Arm graceful state persistence (auto-saves queue state & checkpoints database)
    stateManager.initGracefulPersistence(client);

    // Initialize real-time Dynamic Streaming Presence Engine (ActivityType.Streaming)
    presenceManager.initPresence(client);

    // Arm self-healing 60-second health check to keep 24/7 channels connected permanently
    start247HealthCheck(client);

    logger.success(`${shardInfo}Audio Engine is armed and connected to Lavalink.`);
    logger.info(`${shardInfo}Dynamic Streaming Presence engine armed (ActivityType.Streaming - purple badge)`);
  },
};
