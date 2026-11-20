// Handles a successful biometric authentication: reads the detected emotion
// data and queries the verse database for a matching scripture verse.
//
// Assumes a Postgres-style client where db.query(sql, params) resolves to { rows }.
// Table: verses(id, reference, text, translation, emotion_tag)

const EMOTIONS = new Set(["unsettled", "heated", "heavy", "settled", "bright"]);
const MIN_CONFIDENCE = 0.4;   // below this, fall back to a neutral verse
const FALLBACK = "settled";

/**
 * @param {{ verified: boolean, userId: string }} authResult  Result of the biometric check
 * @param {{ state: string, confidence: number, reasons?: string[] }} emotion  Detected emotion data
 * @param {{ query: (sql: string, params: any[]) => Promise<{ rows: any[] }> }} db
 * @param {{ recentVerseIds?: number[] }} [opts]  Verse ids shown recently, to avoid repeats
 * @returns {Promise<{ verse: object, matchedState: string, usedFallback: boolean }>}
 */
async function onBiometricAuthSuccess(authResult, emotion, db, opts = {}) {
  // 1. Only proceed when authentication actually succeeded.
  if (!authResult || authResult.verified !== true) {
    throw new Error("Biometric authentication not verified");
  }

  // 2. Validate the emotion data and fall back safely if it is missing or weak.
  const state = String(emotion?.state ?? "").toLowerCase();
  const confident = Number(emotion?.confidence) >= MIN_CONFIDENCE;
  const usedFallback = !EMOTIONS.has(state) || !confident;
  const tag = usedFallback ? FALLBACK : state;

  // 3. Query with bound parameters only (never string-concatenate the tag).
  const recent = opts.recentVerseIds ?? [];
  const sql = `
    SELECT id, reference, text, translation
    FROM verses
    WHERE emotion_tag = $1
      AND id <> ALL($2::int[])
    ORDER BY random()
    LIMIT 1`;

  let { rows } = await db.query(sql, [tag, recent]);

  // 4. If every verse for this state was shown recently, allow repeats.
  if (rows.length === 0) {
    ({ rows } = await db.query(sql, [tag, []]));
  }
  if (rows.length === 0) {
    throw new Error(`No verses found for emotion tag "${tag}"`);
  }

  return { verse: rows[0], matchedState: tag, usedFallback };
}

module.exports = { onBiometricAuthSuccess };

/* Example usage:

const { onBiometricAuthSuccess } = require("./onBiometricAuthSuccess");

const { verse, matchedState } = await onBiometricAuthSuccess(
  { verified: true, userId: "u_123" },
  { state: "unsettled", confidence: 0.72 },
  pool,                               // e.g. a pg Pool
  { recentVerseIds: [4, 9] }
);
renderVerse(`${verse.text} (${verse.reference}, ${verse.translation})`);
*/
