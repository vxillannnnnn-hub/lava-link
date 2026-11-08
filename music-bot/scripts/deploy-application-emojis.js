/**
 * Deploy Clean THIN Monochrome Application Emojis (Discord Global Emojis)
 * 
 * Unlike Guild Emojis (which are restricted to a single server and invisible to non-Nitro users),
 * Discord Application Emojis belong directly to the Bot Application:
 * - Render globally across ALL Discord servers where the bot is installed.
 * - Visible to EVERY Discord user (Zero Nitro requirement).
 * - Usable in Markdown text, Embed descriptions, and Component Buttons.
 * 
 * Synchronizes razor-sharp 128x128 white outline PNGs on transparent backgrounds
 * (Lucide / Feather stroke aesthetic, stroke-width: 1.35)
 * to Primary Bot Application and all Auxiliary Bot Applications.
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function wrapSvg(inner, viewBox = "0 0 24 24") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="${viewBox}" fill="none">
    ${inner}
  </svg>`;
}

const THIN_MONOCHROME_ICONS = {
  // Player Transport Controls (Thin Outlines, stroke-width: 1.35)
  play: wrapSvg(`<polygon points="6 4 19 12 6 20 6 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`),
  pause: wrapSvg(`
    <line x1="9" y1="5" x2="9" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <line x1="15" y1="5" x2="15" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  playpause: wrapSvg(`
    <polygon points="4 5 12 12 4 19 4 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="16" y1="5" x2="16" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <line x1="20" y1="5" x2="20" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  skip: wrapSvg(`
    <polygon points="5 5 15 12 5 19 5 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="19" y1="5" x2="19" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  previous: wrapSvg(`
    <line x1="5" y1="5" x2="5" y2="19" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <polygon points="19 19 9 12 19 5 19 19" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  controls: wrapSvg(`
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
  stop: wrapSvg(`<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`),
  loop: wrapSvg(`
    <path d="m17 2 4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m7 22-4-4 4-4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  loop_one: wrapSvg(`
    <path d="m17 2 4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 11V9a4 4 0 0 1 4-4h14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m7 22-4-4 4-4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M21 13v2a4 4 0 0 1-4 4H3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 10.5l1-1v5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  shuffle: wrapSvg(`
    <path d="m16 3 5 0 0 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="4" y1="20" x2="21" y2="3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m21 16 0 5-5 0" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="15" y1="15" x2="21" y2="21" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="4" y1="4" x2="9" y2="9" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  autoplay: wrapSvg(`
    <path d="M12 12c-2-2.5-4-4-6.5-4a4.5 4.5 0 0 0 0 9c2.5 0 4.5-1.5 6.5-4m0 0c2 2.5 4 4 6.5 4a4.5 4.5 0 0 0 0-9c-2.5 0-4.5 1.5-6.5 4" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  heart: wrapSvg(`
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  queue: wrapSvg(`
    <path d="M21 15V6" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <line x1="12" y1="12" x2="3" y2="12" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <line x1="16" y1="6" x2="3" y2="6" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <line x1="12" y1="18" x2="3" y2="18" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),

  // Audio & Volume (Thin Outlines, stroke-width: 1.35)
  volume: wrapSvg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  volumelow: wrapSvg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  volumemute: wrapSvg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="22" y1="9" x2="16" y2="15" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <line x1="16" y1="9" x2="22" y2="15" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),

  // Status, Navigation & Badges (Thin Outlines, stroke-width: 1.35)
  sparkles: wrapSvg(`
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linejoin="round"/>
    <path d="M5 3v3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M19 18v3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M3.5 4.5h3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M17.5 19.5h3" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  music: wrapSvg(`
    <path d="M9 18V5l12-2v13" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="6" cy="18" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <circle cx="18" cy="16" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
  `),
  disc: wrapSvg(`
    <circle cx="12" cy="12" r="10" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <circle cx="12" cy="12" r="3" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
  `),
  radio: wrapSvg(`
    <circle cx="12" cy="12" r="2" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.83a10 10 0 0 1 0 14.15m-14.14 0a10 10 0 0 1 0-14.15" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  dj: wrapSvg(`
    <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  fire: wrapSvg(`
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  check: wrapSvg(`
    <polyline points="20 6 9 17 4 12" fill="none" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  cross: wrapSvg(`
    <line x1="18" y1="6" x2="6" y2="18" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="6" y1="6" x2="18" y2="18" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round"/>
  `),

  // Streaming Platforms (Thin Outline Monochrome White Branding)
  spotify: wrapSvg(`
    <circle cx="12" cy="12" r="10" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <path d="M7 9.5c3.2-.8 7.2-.6 10 1.1" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M7.8 12.2c2.6-.7 5.8-.5 8.2.9" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
    <path d="M8.6 14.9c2-.5 4.5-.4 6.4.7" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round"/>
  `),
  youtube: wrapSvg(`
    <rect x="2" y="4" width="20" height="16" rx="4.5" fill="none" stroke="#FFFFFF" stroke-width="1.35"/>
    <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),
  soundcloud: wrapSvg(`
    <path d="M18 10a4 4 0 0 1 4 4 4 4 0 0 1-4 4H7a5 5 0 0 1-1-9.9 5.5 5.5 0 0 1 10.9-1.1A4 4 0 0 1 18 10z" fill="none" stroke="#FFFFFF" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  `),

  // Sleek Thin Audio Slider Progress Bar Segments (Height: 3.5px)
  bar_lf: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
  bar_mf: wrapSvg(`<rect x="0" y="10" width="24" height="4" fill="#FFFFFF" />`),
  bar_rf: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
  bar_le: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" rx="1.5" fill="#4E5058" />`),
  bar_me: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" fill="#4E5058" />`),
  bar_re: wrapSvg(`<rect x="0" y="10.5" width="24" height="3" rx="1.5" fill="#4E5058" />`),
  bar_single_f: wrapSvg(`<rect x="0" y="10" width="24" height="4" rx="2" fill="#FFFFFF" />`),
};

async function convertSvgToPngBase64(svgString) {
  const buf = await sharp(Buffer.from(svgString))
    .resize(128, 128)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function getApplicationInfo(token) {
  const res = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch application: HTTP ${res.status}`);
  return res.json();
}

async function syncApplicationEmojis(token, botLabel = "Bot") {
  const app = await getApplicationInfo(token);
  const appId = app.id;
  console.log(`\n------------------------------------------------------`);
  console.log(`📡 [${botLabel}] Syncing Application Emojis for Application: "${app.name}" (${appId})`);
  console.log(`------------------------------------------------------`);

  // 1. Fetch current application emojis
  const listRes = await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!listRes.ok) throw new Error(`HTTP ${listRes.status} fetching emojis for ${appId}`);
  const existingData = await listRes.json();
  const existingList = existingData.items || existingData;
  console.log(`Found ${existingList.length} current application emojis.`);

  const existingMap = new Map();
  for (const e of existingList) {
    existingMap.set(e.name.toLowerCase(), e);
  }

  const emojiMap = {};

  for (const [key, svg] of Object.entries(THIN_MONOCHROME_ICONS)) {
    const emojiName = key.toLowerCase();
    const oldEmoji = existingMap.get(emojiName);

    if (oldEmoji) {
      console.log(`  🗑 Deleting old application emoji: ${emojiName} (${oldEmoji.id})...`);
      try {
        await fetch(`https://discord.com/api/v10/applications/${appId}/emojis/${oldEmoji.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bot ${token}` },
        });
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        console.warn(`    ⚠️ Failed to delete ${emojiName}:`, err.message);
      }
    }

    console.log(`  ⚡ Uploading thin "${emojiName}"...`);
    try {
      let b64;
      const localPng = path.join(__dirname, "..", "..", "assets", "emojis", `${emojiName}.png`);
      if (fs.existsSync(localPng)) {
        const buf = fs.readFileSync(localPng);
        b64 = `data:image/png;base64,${buf.toString("base64")}`;
      } else {
        b64 = await convertSvgToPngBase64(svg);
      }
      const createRes = await fetch(`https://discord.com/api/v10/applications/${appId}/emojis`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: emojiName,
          image: b64,
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        console.warn(`    ⚠️ Failed to create ${emojiName}: HTTP ${createRes.status}`, JSON.stringify(errJson));
        continue;
      }

      const created = await createRes.json();
      const tag = `<:${created.name}:${created.id}>`;
      console.log(`    ✅ Uploaded thin application emoji: ${emojiName} -> ${tag}`);
      emojiMap[key] = tag;
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`    ❌ Error uploading ${emojiName}:`, err.message);
    }
  }

  return { appId, appName: app.name, emojiMap };
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 DEPLOYING THIN MONOCHROME APPLICATION EMOJIS (ALL SERVERS)`);
  console.log(`======================================================`);

  const primaryToken = process.env.DISCORD_TOKEN;
  if (!primaryToken) {
    console.error("❌ DISCORD_TOKEN is missing!");
    process.exit(1);
  }

  // 1. Sync Primary Bot Application
  const primaryResult = await syncApplicationEmojis(primaryToken, "Primary (Pulse)");

  // 2. Sync Auxiliary Bots if present
  const fleetResults = [primaryResult];
  for (let i = 2; i <= 4; i++) {
    const auxToken = process.env[`DISCORD_TOKEN_${i}`];
    if (auxToken) {
      try {
        const auxResult = await syncApplicationEmojis(auxToken, `Clone ${i - 1} (Pulse ${i - 1})`);
        fleetResults.push(auxResult);
      } catch (e) {
        console.warn(`⚠️ Could not sync aux bot ${i}:`, e.message);
      }
    }
  }

  // 3. Write applicationEmojis.json
  const jsonPath = path.join(__dirname, "..", "src", "utils", "applicationEmojis.json");
  const fleetData = {
    primary: primaryResult.emojiMap,
    fleet: fleetResults.reduce((acc, r) => {
      acc[r.appId] = r.emojiMap;
      return acc;
    }, {}),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(fleetData, null, 2), "utf-8");
  console.log(`\n🎉 Successfully saved application emojis to:\n   ${jsonPath}`);

  // 4. Update customEmojis.json with primary application emojis
  const customJsonPath = path.join(__dirname, "..", "src", "utils", "customEmojis.json");
  fs.writeFileSync(customJsonPath, JSON.stringify(primaryResult.emojiMap, null, 2), "utf-8");

  // 5. Update src/utils/emojis.js
  updateEmojisSourceFile(primaryResult.emojiMap);

  console.log(`\n✨ COMPLETE! Emojis are now 100% GLOBAL Application Emojis visible in all servers! ✨\n`);
}

function updateEmojisSourceFile(emojiMap) {
  const emojisFilePath = path.join(__dirname, "..", "src", "utils", "emojis.js");
  if (!fs.existsSync(emojisFilePath)) return;

  let content = fs.readFileSync(emojisFilePath, "utf-8");

  // Replace each key in emojis.js with the new application tag
  for (const [key, tag] of Object.entries(emojiMap)) {
    // Match either <:p_key:id> or <:key:id>
    const regex = new RegExp(`(<:(p_)?${key}:\\d+>)`, "gi");
    content = content.replace(regex, tag);
  }

  fs.writeFileSync(emojisFilePath, content, "utf-8");
  console.log(`🎉 Successfully updated ${emojisFilePath} with new global application emoji IDs!`);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
