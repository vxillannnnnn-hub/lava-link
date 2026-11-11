/**
 * Audible equalizer presets
 * ---------------------------------------------------------------------------
 * Lavalink's equalizer is 15 bands (25 Hz … 16 kHz) and Lavaplayer clamps every
 * band gain to **[-0.25, +1.0] dB**. Anything above +1.0 is silently clamped by
 * the node, so a reply that promises "+9 dB heavy sub-bass" was simply lying:
 * the node would apply at most +1.0.
 *
 * The old presets were weaker than that ceiling by an order of magnitude -
 * 0.10-0.25 dB here, and lavalink-client's own `EQList.BassboostHigh` peaks at
 * 0.15 dB - which is about 1-3% louder at 25 Hz. Inaudible, while still forcing
 * the node to decode and re-encode instead of forwarding Opus.
 *
 * These presets spend the whole legal range as a low shelf, so the lift is
 * actually perceptible, and `describeBassPreset()` derives its wording from the
 * numbers below so a user-facing reply can never drift from what was applied.
 *
 * Honest scope: plugin-free Lavalink cannot do more than this. A sub-heavy
 * "bass boost" needs a DSP plugin (LavaDSPX / lavalink-filter) on the node; the
 * equalizer alone tops out at +1.0 dB per band.
 */

const EQ_GAIN_MIN = -0.25;
const EQ_GAIN_MAX = 1.0;
const BAND_COUNT = 15;

// Lavalink's fixed band layout, in Hz/kHz, used only for readable descriptions.
const BAND_FREQUENCIES = [
  "25 Hz",
  "40 Hz",
  "63 Hz",
  "100 Hz",
  "160 Hz",
  "250 Hz",
  "400 Hz",
  "630 Hz",
  "1 kHz",
  "1.6 kHz",
  "2.5 kHz",
  "4 kHz",
  "6.3 kHz",
  "10 kHz",
  "16 kHz",
];

/**
 * Clamp a gain into the range the node actually accepts. Clamping here (rather
 * than letting Lavalink do it) keeps the description truthful.
 * @param {number} gain dB
 * @returns {number}
 */
function clampGain(gain) {
  const numeric = Number(gain);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, numeric));
}

/**
 * Build a full 15-band array from a sparse `{ band: gain }` map. A complete
 * array makes the result deterministic: unlisted bands are explicitly 0 rather
 * than "whatever the previous preset left there".
 * @param {Record<number, number>} gains
 * @returns {Array<{ band: number, gain: number }>}
 */
function buildBands(gains = {}) {
  const out = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    out.push({ band, gain: clampGain(gains[band] ?? 0) });
  }
  return out;
}

const BASS_PRESETS = {
  bass_low: {
    label: "Bass Boost (Low)",
    bands: buildBands({ 0: 0.6, 1: 0.45, 2: 0.3 }),
  },
  bass_med: {
    label: "Bass Boost (Medium)",
    bands: buildBands({ 0: 1.0, 1: 0.9, 2: 0.75, 3: 0.5, 4: 0.3 }),
  },
  bass_high: {
    label: "Bass Boost (High)",
    bands: buildBands({ 0: 1.0, 1: 1.0, 2: 0.95, 3: 0.85, 4: 0.6, 5: 0.4, 6: 0.2 }),
  },
};

const BASS_PRESET_KEYS = Object.keys(BASS_PRESETS);

/**
 * Human-readable summary of what a preset actually applies, computed from the
 * bands themselves.
 * @param {keyof typeof BASS_PRESETS} key
 * @returns {string}
 */
function describeBassPreset(key) {
  const preset = BASS_PRESETS[key];
  if (!preset) return "";

  const boosted = preset.bands.filter((band) => band.gain > 0);
  if (!boosted.length) return "Flat equalizer (no boost applied).";

  const peak = Math.max(...boosted.map((band) => band.gain));
  const first = boosted[0];
  const last = boosted[boosted.length - 1];
  const shelf =
    peak === last.gain
      ? `+${peak.toFixed(2)} dB across ${BAND_FREQUENCIES[first.band]}–${BAND_FREQUENCIES[last.band]}`
      : `+${peak.toFixed(2)} dB shelf from ${BAND_FREQUENCIES[first.band]} tapering to +${last.gain.toFixed(
          2
        )} dB at ${BAND_FREQUENCIES[last.band]}`;

  return (
    `${shelf}. Lavalink caps each band at +${EQ_GAIN_MAX.toFixed(1)} dB, so this is a gentle shelf, ` +
    "not a subwoofer — a stronger boost needs a DSP plugin on the node."
  );
}

module.exports = {
  EQ_GAIN_MIN,
  EQ_GAIN_MAX,
  BAND_COUNT,
  BAND_FREQUENCIES,
  clampGain,
  buildBands,
  BASS_PRESETS,
  BASS_PRESET_KEYS,
  describeBassPreset,
};
