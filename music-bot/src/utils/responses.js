/**
 * Modern Hybrid Response Engine (Eara Architecture)
 * 
 * Replaces bloated, giant embed boxes with high-density Discord Markdown text,
 * native subtext (-# ), contextual action buttons (Components V1), and Discord
 * Components V2 containers.
 * 
 * Guarantees ZERO notification mention pings across all messages.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const emojis = require("./emojis");

/**
 * Every text payload suppresses Discord's automatic link unfurling. Our copy
 * frequently embeds track URLs and masked links, and those unfurl into large
 * preview cards that make the channel look noisy. SuppressEmbeds only blocks
 * auto-generated previews; buttons, components and explicit embeds sent by
 * other builders are unaffected.
 */
const SUPPRESS = MessageFlags.SuppressEmbeds;

function textFlags(options = {}) {
  return options.ephemeral ? SUPPRESS | MessageFlags.Ephemeral : SUPPRESS;
}

module.exports = {
  /**
   * Operational Action Text with optional native subtext
   * Example: ⏭️ Skipped Renegade by Aaryan Shah\n-# Up next: Track 2
   */
  actionText(emoji, headline, subtext = null, options = {}) {
    let out = `${emoji} ${headline}`;
    if (subtext) out += `\n-# ${subtext}`;
    const payload = {
      content: out,
      allowedMentions: { parse: [], users: [] },
      flags: textFlags(options),
    };
    return payload;
  },

  /**
   * Operational Action Text paired with an interactive quick button
   * Example: ⏸️ Audio stream paused.\n-# Click to resume -> [▶️ Resume]
   */
  actionWithButton(emoji, headline, subtext, buttonConfig, options = {}) {
    let out = emoji ? `${emoji} ${headline}` : headline;
    if (subtext) out += `\n-# ${subtext}`;

    const button = new ButtonBuilder();
    if (buttonConfig.url) {
      button.setStyle(ButtonStyle.Link).setURL(buttonConfig.url);
    } else {
      button.setCustomId(buttonConfig.customId || "btn_default")
        .setStyle(buttonConfig.style || ButtonStyle.Secondary);
    }

    if (buttonConfig.label) button.setLabel(buttonConfig.label);
    if (buttonConfig.emoji) button.setEmoji(buttonConfig.emoji);
    if (buttonConfig.disabled) button.setDisabled(true);

    const row = new ActionRowBuilder().addComponents(button);

    const payload = {
      content: out,
      components: [row],
      allowedMentions: { parse: [], users: [] },
      flags: textFlags(options),
    };
    return payload;
  },

  /**
   * Operational Action Text with multiple interactive buttons
   */
  actionWithButtons(emoji, headline, subtext, buttonConfigs = [], options = {}) {
    let out = emoji ? `${emoji} ${headline}` : headline;
    if (subtext) out += `\n-# ${subtext}`;

    const buttons = buttonConfigs.map((cfg) => {
      const btn = new ButtonBuilder();
      if (cfg.url) {
        btn.setStyle(ButtonStyle.Link).setURL(cfg.url);
      } else {
        btn.setCustomId(cfg.customId || "btn_default")
          .setStyle(cfg.style || ButtonStyle.Secondary);
      }
      if (cfg.label) btn.setLabel(cfg.label);
      if (cfg.emoji) btn.setEmoji(cfg.emoji);
      if (cfg.disabled) btn.setDisabled(true);
      return btn;
    });

    const row = new ActionRowBuilder().addComponents(buttons);

    const payload = {
      content: out,
      components: [row],
      allowedMentions: { parse: [], users: [] },
      flags: textFlags(options),
    };
    return payload;
  },

  /**
   * Clean Error Text (No giant red embed box)
   */
  errorText(message, subtext = null) {
    let out = `${emojis.cross} ${message}`;
    if (subtext) out += `\n-# ${subtext}`;
    return {
      content: out,
      flags: SUPPRESS | MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    };
  },

  /**
   * Clean Warning Text
   */
  warnText(message, subtext = null) {
    let out = `${emojis.warn} ${message}`;
    if (subtext) out += `\n-# ${subtext}`;
    return {
      content: out,
      flags: SUPPRESS | MessageFlags.Ephemeral,
      allowedMentions: { parse: [], users: [] },
    };
  },

  /**
   * Clean Success Text
   */
  successText(message, subtext = null, options = {}) {
    let out = `${emojis.check} ${message}`;
    if (subtext) out += `\n-# ${subtext}`;
    const payload = {
      content: out,
      allowedMentions: { parse: [], users: [] },
      flags: textFlags(options),
    };
    return payload;
  },

  /**
   * Clean Info Text
   */
  infoText(message, subtext = null, options = {}) {
    let out = `${emojis.info} ${message}`;
    if (subtext) out += `\n-# ${subtext}`;
    const payload = {
      content: out,
      allowedMentions: { parse: [], users: [] },
      flags: textFlags(options),
    };
    return payload;
  },
};

