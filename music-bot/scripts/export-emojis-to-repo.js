/**
 * Export Clean Monochrome Emojis directly to Repository Folder (assets/emojis)
 * Generates both high-res SVGs and transparent 128x128 PNGs for all icons.
 * Also generates index.json and README.md with direct GitHub raw URL fallbacks.
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const REPO_ASSETS_DIR = path.join(__dirname, "..", "..", "assets", "emojis");
if (!fs.existsSync(REPO_ASSETS_DIR)) {
  fs.mkdirSync(REPO_ASSETS_DIR, { recursive: true });
}

function wrapSvg(inner, viewBox = "0 0 24 24") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="${viewBox}" fill="none">
    ${inner}
  </svg>`;
}

const EMOJI_DEFINITIONS = {
  // Player Controls
  play: {
    svg: wrapSvg(`<polygon points="6 4 19 12 6 20 6 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`),
    unicode: "▶",
  },
  pause: {
    svg: wrapSvg(`
      <line x1="9" y1="5" x2="9" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="15" y1="5" x2="15" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "⏸",
  },
  playpause: {
    svg: wrapSvg(`
      <polygon points="4 5 12 12 4 19 4 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="16" y1="5" x2="16" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="20" y1="5" x2="20" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "⏯",
  },
  skip: {
    svg: wrapSvg(`
      <polygon points="5 5 15 12 5 19 5 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="19" y1="5" x2="19" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "⏭",
  },
  previous: {
    svg: wrapSvg(`
      <line x1="5" y1="5" x2="5" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <polygon points="19 19 9 12 19 5 19 19" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "⏮",
  },
  stop: {
    svg: wrapSvg(`<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`),
    unicode: "⏹",
  },
  loop: {
    svg: wrapSvg(`
      <path d="m17 2 4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m7 22-4-4 4-4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "↻",
  },
  loop_one: {
    svg: wrapSvg(`
      <path d="m17 2 4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m7 22-4-4 4-4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M11 10.5l1-1v5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "↺",
  },
  shuffle: {
    svg: wrapSvg(`
      <path d="m16 3 5 0 0 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="4" y1="20" x2="21" y2="3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m21 16 0 5-5 0" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="15" y1="15" x2="21" y2="21" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="4" y1="4" x2="9" y2="9" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "⤨",
  },
  autoplay: {
    svg: wrapSvg(`
      <path d="M12 12c-2-2.5-4-4-6.5-4a4.5 4.5 0 0 0 0 9c2.5 0 4.5-1.5 6.5-4m0 0c2 2.5 4 4 6.5 4a4.5 4.5 0 0 0 0-9c-2.5 0-4.5 1.5-6.5 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "∞",
  },
  heart: {
    svg: wrapSvg(`
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "♡",
  },
  queue: {
    svg: wrapSvg(`
      <path d="M21 15V6" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <line x1="12" y1="12" x2="3" y2="12" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="16" y1="6" x2="3" y2="6" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="12" y1="18" x2="3" y2="18" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "☰",
  },

  // Audio & Volume
  volume: {
    svg: wrapSvg(`
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "🔊",
  },
  volumelow: {
    svg: wrapSvg(`
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "🔉",
  },
  volumemute: {
    svg: wrapSvg(`
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="22" y1="9" x2="16" y2="15" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="16" y1="9" x2="22" y2="15" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "🔇",
  },
  equalizer: {
    svg: wrapSvg(`
      <line x1="4" y1="21" x2="4" y2="14" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="4" y1="10" x2="4" y2="3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="12" y1="21" x2="12" y2="12" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="12" y1="8" x2="12" y2="3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="20" y1="21" x2="20" y2="16" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="20" y1="12" x2="20" y2="3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="1" y1="14" x2="7" y2="14" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="9" y1="8" x2="15" y2="8" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <line x1="17" y1="16" x2="23" y2="16" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "🎚",
  },

  // Utilities & Badges
  sparkles: {
    svg: wrapSvg(`
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linejoin="round"/>
      <path d="M5 3v3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M19 18v3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M3.5 4.5h3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M17.5 19.5h3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "✦",
  },
  music: {
    svg: wrapSvg(`
      <path d="M9 18V5l12-2v13" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="6" cy="18" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <circle cx="18" cy="16" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    `),
    unicode: "♫",
  },
  disc: {
    svg: wrapSvg(`
      <circle cx="12" cy="12" r="10" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <circle cx="12" cy="12" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    `),
    unicode: "◎",
  },
  radio: {
    svg: wrapSvg(`
      <circle cx="12" cy="12" r="2" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.83a10 10 0 0 1 0 14.15m-14.14 0a10 10 0 0 1 0-14.15" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "◉",
  },
  dj: {
    svg: wrapSvg(`
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "◈",
  },
  fire: {
    svg: wrapSvg(`
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "▲",
  },
  check: {
    svg: wrapSvg(`
      <polyline points="20 6 9 17 4 12" fill="none" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "✓",
  },
  cross: {
    svg: wrapSvg(`
      <line x1="18" y1="6" x2="6" y2="18" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="6" y1="6" x2="18" y2="18" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>
    `),
    unicode: "✕",
  },
  search: {
    svg: wrapSvg(`
      <circle cx="11" cy="11" r="8" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "🔍",
  },
  settings: {
    svg: wrapSvg(`
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    `),
    unicode: "⚙",
  },

  // Streaming Platforms
  spotify: {
    svg: wrapSvg(`
      <circle cx="12" cy="12" r="10" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <path d="M7 9.5c3.2-.8 7.2-.6 10 1.1" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M7.8 12.2c2.6-.7 5.8-.5 8.2.9" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
      <path d="M8.6 14.9c2-.5 4.5-.4 6.4.7" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    `),
    unicode: "♫",
  },
  youtube: {
    svg: wrapSvg(`
      <rect x="2" y="4" width="20" height="16" rx="4.5" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
      <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "▶",
  },
  soundcloud: {
    svg: wrapSvg(`
      <path d="M18 10a4 4 0 0 1 4 4 4 4 0 0 1-4 4H7a5 5 0 0 1-1-9.9 5.5 5.5 0 0 1 10.9-1.1A4 4 0 0 1 18 10z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    `),
    unicode: "☁",
  },

  // Progress Bar Segments
  bar_lf: {
    svg: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
    unicode: "━",
  },
  bar_mf: {
    svg: wrapSvg(`<rect x="0" y="10" width="24" height="4" fill="#FFFFFF" />`),
    unicode: "━",
  },
  bar_rf: {
    svg: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
    unicode: "━",
  },
  bar_le: {
    svg: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" rx="1.5" fill="#4E5058" />`),
    unicode: "─",
  },
  bar_me: {
    svg: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" fill="#4E5058" />`),
    unicode: "─",
  },
  bar_re: {
    svg: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" rx="1.5" fill="#4E5058" />`),
    unicode: "─",
  },
  bar_single_f: {
    svg: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
    unicode: "━",
  },
};

// Existing Discord application emoji IDs mapping (Primary bot ID 1568193148222443591)
const APP_EMOJI_IDS = {
  play: "1568636872971001916",
  pause: "1568636879945859094",
  playpause: "1568636887374106634",
  previous: "1568636898631614595",
  skip: "1568636894567203016",
  stop: "1568636906634346611",
  loop: "1568636915270426737",
  loop_one: "1568636919498416188",
  shuffle: "1568636923684323419",
  autoplay: "1568636927987421194",
  heart: "1568636935508066304",
  queue: "1568636942785056779",
  volume: "1568636950146056282",
  volumelow: "1568636954646421666",
  volumemute: "1568636958744379606",
  sparkles: "1568636966386278594",
  music: "1568636978508075189",
  disc: "1568636991225077770",
  radio: "1568636998330089592",
  dj: "1568637006114983986",
  fire: "1568637013916262430",
  check: "1568637021130465461",
  cross: "1568637028852170958",
  spotify: "1568637036620030132",
  youtube: "1568637043930828914",
  soundcloud: "1568637051497091082",
  bar_lf: "1568637059088916520",
  bar_mf: "1568637066105851994",
  bar_rf: "1568637073177579743",
  bar_le: "1568637080601497623",
  bar_me: "1568637088096583750",
  bar_re: "1568637095558258709",
  bar_single_f: "1568637103095554099",
};

async function exportAll() {
  console.log("🎨 Starting export of monochrome emojis to assets/emojis/...");
  const manifest = {};
  const GITHUB_BASE_URL = "https://raw.githubusercontent.com/apunabhibhilegendhai/lavalink-server/main/assets/emojis";

  for (const [name, def] of Object.entries(EMOJI_DEFINITIONS)) {
    const svgPath = path.join(REPO_ASSETS_DIR, `${name}.svg`);
    const pngPath = path.join(REPO_ASSETS_DIR, `${name}.png`);

    // 1. Write SVG
    fs.writeFileSync(svgPath, def.svg.trim(), "utf8");

    // 2. Render 128x128 crisp PNG
    await sharp(Buffer.from(def.svg))
      .resize(128, 128)
      .png({ compressionLevel: 9 })
      .toFile(pngPath);

    const emojiId = APP_EMOJI_IDS[name] || null;
    const discordTag = emojiId ? `<:${name}:${emojiId}>` : def.unicode;

    manifest[name] = {
      name,
      svgFile: `${name}.svg`,
      pngFile: `${name}.png`,
      cdnUrl: `${GITHUB_BASE_URL}/${name}.png`,
      unicode: def.unicode,
      emojiId,
      discordTag,
    };

    console.log(`  ✓ Exported ${name}.svg & ${name}.png`);
  }

  // 3. Write index.json
  const indexPath = path.join(REPO_ASSETS_DIR, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n📄 Generated manifest at assets/emojis/index.json (${Object.keys(manifest).length} icons)`);

  // 4. Write README.md with table preview
  let readme = `# Clean Monochrome Vector Emojis (Thin 1.35px White Glyphs)\n\n`;
  readme += `Standardized, high-contrast, razor-sharp 128x128 monochrome assets on transparent backgrounds.\n\n`;
  readme += `Used across Discord Application Emojis, embeds, dashboard buttons, and player interfaces.\n\n`;
  readme += `### Emoji Directory & CDN Fallback Table\n\n`;
  readme += `| Preview | Name | SVG File | PNG CDN Fallback | Unicode Fallback | Discord Tag |\n`;
  readme += `| :---: | :--- | :--- | :--- | :---: | :--- |\n`;

  for (const item of Object.values(manifest)) {
    readme += `| ![](${item.cdnUrl}) | \`${item.name}\` | [\`${item.svgFile}\`](./${item.svgFile}) | [PNG Link](${item.cdnUrl}) | \`${item.unicode}\` | \`${item.discordTag}\` |\n`;
  }

  const readmePath = path.join(REPO_ASSETS_DIR, "README.md");
  fs.writeFileSync(readmePath, readme, "utf8");
  console.log(`📄 Generated preview documentation at assets/emojis/README.md`);
  console.log(`\n🎉 Successfully exported all ${Object.keys(manifest).length} emojis!`);
}

exportAll().catch((err) => {
  console.error("❌ Export failed:", err);
  process.exit(1);
});
