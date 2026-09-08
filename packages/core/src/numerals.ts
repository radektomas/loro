/**
 * Digits to Spanish words — "100" → "cien", "1936" → "mil novecientos
 * treinta y seis".
 *
 * WHY. YouTube's captions write numbers as digits, so 578 tokens in the
 * embed catalog (1.2%) were "20", "100", "1936" — a learner sees a digit
 * where the speaker said a word, cannot save it as vocabulary, and, worse,
 * the level planner could blank "1936" and grade "mil novecientos treinta y
 * seis" as wrong because the expected answer was the digit string. Radek,
 * 2026-09-07: "change the numbers instead of 100 to cien, like real words".
 *
 * WHAT IT COVERS. Cardinals to 999,999,999; years (read as cardinals in
 * Spanish); "%" → "por ciento"; "$" / "€" → "dólares" / "euros" after the
 * number; thousands separators ("1.500", "1,500"); simple decimals
 * ("2,5" → "dos coma cinco"). Everything else — times, ranges, ids, mixed
 * tokens — returns null and stays as it was: the caller keeps the digits,
 * which is imperfect but not new.
 *
 * GENDER AND APOCOPE. "1" and every "…1" below a hundred depend on the
 * noun that follows: "un día", "una casa", "veintiún años", "veintiuna
 * personas", and plain "uno" / "veintiuno" when nothing follows. The
 * converter takes the next token and decides by its ending — "-a", "-as",
 * "-ción", "-sión", "-dad", "-tad", "-tud", "-umbre" read feminine — and
 * when there is no next token it uses the bare form. That is a heuristic
 * and it is stated as one; the dozen tokens it can get wrong ("el día",
 * "la mano") are a smaller error than 578 digits.
 *
 * "cien" alone, "ciento" before a remainder; "mil", never "un mil";
 * "un millón" / "dos millones", and "millones de" is the caller's
 * problem, not this function's (the "de" is a real word in the caption).
 */

const UNITS = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const TENS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

export type Gender = 'm' | 'f' | 'none';

/** Endings that read feminine for the apocope decision. Heuristic, see header. */
const FEMININE_ENDINGS = /(a|as|ción|sión|ciones|siones|dad|dades|tad|tades|tud|tudes|umbre|umbres)$/i;
/** Words a numeral is never "before" in the gendered sense. */
const NOT_A_NOUN = /^(y|o|de|del|a|al|en|con|por|para|que|es|son|era|fue|hay|más|menos|mil|millón|millones|por|ciento|dólares|euros|%)$/i;

/** Common masculine nouns that end in -a, so the ending rule is not fooled
    by the ones a caption is most likely to put after a number. */
const MASCULINE_A = new Set([
  'día', 'días', 'mapa', 'mapas', 'problema', 'problemas', 'programa', 'programas',
  'sistema', 'sistemas', 'tema', 'temas', 'idioma', 'idiomas', 'clima', 'planeta',
  'planetas', 'sofá', 'sofás', 'papá', 'poeta', 'poetas', 'drama', 'dramas',
]);

/** What the token after a numeral says about its gender. */
export function genderOf(nextToken: string | null | undefined): Gender {
  if (!nextToken) return 'none';
  const t = nextToken.toLowerCase().replace(/^[^a-záéíóúüñ]+|[^a-záéíóúüñ]+$/g, '');
  if (!t || /\d/.test(nextToken) || NOT_A_NOUN.test(t)) return 'none';
  if (MASCULINE_A.has(t)) return 'm';
  return FEMININE_ENDINGS.test(t) ? 'f' : 'm';
}

/** 1–99, with "uno" resolved by gender. */
function underHundred(n: number, gender: Gender, hasMore: boolean): string {
  const one = (bare: string, m: string, f: string) =>
    gender === 'f' ? f : gender === 'm' || hasMore ? m : bare;
  if (n === 1) return one('uno', 'un', 'una');
  if (n === 21) return one('veintiuno', 'veintiún', 'veintiuna');
  if (n < 30) return UNITS[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return TENS[tens];
  if (unit === 1) return `${TENS[tens]} y ${one('uno', 'un', 'una')}`;
  return `${TENS[tens]} y ${UNITS[unit]}`;
}

/** 1–999. */
function underThousand(n: number, gender: Gender, hasMore: boolean): string {
  if (n === 100) return 'cien';
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let head = HUNDREDS[h];
  if (gender === 'f' && h >= 2) head = head.replace(/os$/, 'as');
  if (rest === 0) return head;
  const tail = underHundred(rest, gender, hasMore);
  return head ? `${head} ${tail}` : tail;
}

/**
 * A non-negative integer as Spanish words. `gender` resolves "uno";
 * `hasMore` says a noun follows even if its gender is unknown (apocope).
 */
export function cardinal(n: number, gender: Gender = 'none'): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) return null;
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) {
    parts.push(
      millions === 1 ? 'un millón' : `${underThousand(millions, 'm', true)} millones`
    );
  }
  if (thousands > 0) {
    // "mil", "dos mil", "veintiún mil" — mil is invariable and never "un mil".
    parts.push(thousands === 1 ? 'mil' : `${underThousand(thousands, 'none', true)} mil`);
  }
  if (rest > 0) parts.push(underThousand(rest, gender, false));
  return parts.join(' ');
}

/** A single caption token, or null when it is not a number this handles. */
const TOKEN = /^([$€])?([1-9]\d{0,2}(?:[.,]\d{3})+|0|[1-9]\d*)(?:([.,])(\d{1,2}))?(%)?([.,;:!?…]*)$/;

/**
 * Convert one caption token. Returns the words (which may end with the
 * token's own trailing punctuation) or null to leave it alone.
 */
export function numeralToWords(token: string, nextToken?: string | null): string | null {
  const m = TOKEN.exec(token.trim());
  if (!m) return null;
  const [, currency, intRaw, decSep, decRaw, percent, punct] = m;
  // "1.500" / "1,500" are thousands groups; a lone "2,5" is a decimal.
  const grouped = /[.,]\d{3}/.test(intRaw) && !decSep;
  if (/[.,]\d{3}/.test(intRaw) && decSep) return null; // "1.500,50" — leave it
  const int = Number(grouped ? intRaw.replace(/[.,]/g, '') : intRaw);
  if (!Number.isFinite(int)) return null;
  // A currency or percent is its own noun; otherwise the next token decides.
  const gender: Gender = currency || percent ? 'm' : genderOf(nextToken);
  let words = cardinal(int, gender);
  if (words === null) return null;
  if (decRaw !== undefined) {
    const dec = cardinal(Number(decRaw), 'none');
    if (dec === null) return null;
    words = `${words} coma ${dec}`;
  }
  if (percent) words = `${words} por ciento`;
  if (currency === '$') words = `${words} ${int === 1 && !decRaw ? 'dólar' : 'dólares'}`;
  if (currency === '€') words = `${words} ${int === 1 && !decRaw ? 'euro' : 'euros'}`;
  return `${words}${punct ?? ''}`;
}

/**
 * The difficulty band of a number word, for the blue blanks (levels.ts
 * bandOf). Radek, 2026-09-07: "the higher numbers in the higher levels,
 * the lower numbers to the easier levels". Roughly the order a learner
 * meets them:
 *
 *   1  cero … diez, un / una               the first week
 *   2  once … veintinueve, the tens, cien, mil   counting, ages, prices, years
 *   3  the hundreds, veintiún / veintiuna   years read out, apocope forms
 *   4  millón, coma, por ciento, currency   news and numbers talk
 *
 * Null for words that are not number words ("y", "por" alone).
 */
export function numberWordBand(word: string): number | null {
  const w = word.toLowerCase();
  if (w === 'cero' || w === 'un' || w === 'una') return 1;
  if (w === 'veintiún' || w === 'veintiuna') return 3;
  if (w === 'cien' || w === 'mil') return 2;
  if (w === 'millón' || w === 'millones' || w === 'coma' || w === 'ciento') return 4;
  if (w === 'dólar' || w === 'dólares' || w === 'euro' || w === 'euros') return 4;
  const u = UNITS.indexOf(w);
  if (u > 0) return u <= 10 ? 1 : 2;
  if (TENS.indexOf(w) > 0) return 2;
  if (HUNDREDS.indexOf(w.replace(/as$/, 'os')) > 0) return 3;
  return null;
}

/**
 * Replace every convertible digit token in a timed word list with its
 * words, sharing the token's time span across them by letter count. The
 * next token decides gender (see genderOf). Words that are not numerals
 * pass through untouched, so this is safe to run twice.
 */
export function expandNumeralTokens<T extends { text: string; start: number; end: number }>(
  words: readonly T[]
): T[] {
  const out: T[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const spelled = /\d/.test(word.text) ? numeralToWords(word.text, words[i + 1]?.text) : null;
    if (spelled === null) {
      out.push(word);
      continue;
    }
    const parts = spelled.split(' ');
    const letters = parts.reduce((n, p) => n + p.length, 0);
    const span = word.end - word.start;
    let at = word.start;
    for (let k = 0; k < parts.length; k++) {
      const share = parts[k].length / letters;
      const end = k === parts.length - 1 ? word.end : Math.round((at + span * share) * 1000) / 1000;
      out.push({ ...word, text: parts[k], start: Math.round(at * 1000) / 1000, end });
      at = end;
    }
  }
  return out;
}

/**
 * The value a single number word stands for — the gloss a converted word
 * gets in the dictionary ("treinta" → "30"), so a blank prompts with the
 * digits and the learner types the word. Null for words that are not
 * numbers ("y", "por", "coma", "dólares" — those are glossed as words).
 */
export function numberWordValue(word: string): number | null {
  const w = word.toLowerCase();
  if (w === 'cero') return 0;
  if (w === 'un' || w === 'una') return 1;
  if (w === 'veintiún' || w === 'veintiuna') return 21;
  if (w === 'cien' || w === 'ciento') return 100;
  if (w === 'mil') return 1000;
  if (w === 'millón' || w === 'millones') return 1_000_000;
  const u = UNITS.indexOf(w);
  if (u > 0) return u;
  const t = TENS.indexOf(w);
  if (t > 0) return t * 10;
  const h = HUNDREDS.indexOf(w.replace(/as$/, 'os'));
  if (h > 0) return h * 100;
  return null;
}
