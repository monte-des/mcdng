// Text processing for keyword analysis: tokens, English stopwords and the Porter stemmer.
// Self-contained: nothing here reads the project, so the module can be tested on its own.

const STOPWORDS = new Set(`
a about above according across after afterwards again against all almost along already also although always am among
an and another any anyone anything are around as at be became because become becomes been before being below beside
besides between beyond both but by can cannot could did do does doing done down due during each eg either else et etc
even ever every few for former from further had has have having he hence her here hers herself him himself his how
however i ie if in indeed into is it its itself just last latter least less like made many may me might more moreover
most mostly much must my myself namely neither never nevertheless no nor not now of off often on once one only onto or
other others otherwise our ours ourselves out over own per perhaps rather same several she should since so some such
than that the their theirs them themselves then thence there thereby therefore these they this those though through
throughout thus to together too toward towards under unless until up upon us very via was we well were what whatever
when whence whenever where whereas whether which while who whom whose why will with within without would yet you your
yours yourself yourselves al
`.trim().split(/\s+/));

// The Porter stemming algorithm (M.F. Porter, 1980), as in the author's reference implementation.
const stemWord = (() => {
  const step2 = {
    ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al', entli: 'ent',
    eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful',
    ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log',
  };
  const step3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };
  const c = '[^aeiou]';
  const v = '[aeiouy]';
  const C = `${c}[^aeiouy]*`;
  const V = `${v}[aeiou]*`;
  const mGt0 = new RegExp(`^(${C})?${V}${C}`);
  const mEq1 = new RegExp(`^(${C})?${V}${C}(${V})?$`);
  const mGt1 = new RegExp(`^(${C})?${V}${C}${V}${C}`);
  const hasVowel = new RegExp(`^(${C})?${v}`);
  const cvc = new RegExp(`^${C}${v}[^aeiouwxy]$`);

  return word => {
    if (word.length < 3) return word;
    let w = word;
    const initialY = w[0] === 'y';
    if (initialY) w = `Y${w.slice(1)}`;

    // Step 1a: plurals
    let m;
    if ((m = /^(.+?)(ss|i)es$/.exec(w))) w = m[1] + m[2];
    else if ((m = /^(.+?)([^s])s$/.exec(w))) w = m[1] + m[2];

    // Step 1b: -eed, -ed, -ing
    if ((m = /^(.+?)eed$/.exec(w))) {
      if (mGt0.test(m[1])) w = w.slice(0, -1);
    } else if ((m = /^(.+?)(ed|ing)$/.exec(w)) && hasVowel.test(m[1])) {
      w = m[1];
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      else if (cvc.test(w)) w += 'e';
    }

    // Step 1c: y to i
    if ((m = /^(.+?)y$/.exec(w)) && hasVowel.test(m[1])) w = `${m[1]}i`;

    // Steps 2 and 3: double and single suffixes
    if ((m = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/.exec(w)) && mGt0.test(m[1])) {
      w = m[1] + step2[m[2]];
    }
    if ((m = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/.exec(w)) && mGt0.test(m[1])) {
      w = m[1] + step3[m[2]];
    }

    // Step 4: remaining suffixes
    if ((m = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/.exec(w))) {
      if (mGt1.test(m[1])) w = m[1];
    } else if ((m = /^(.+?)(s|t)(ion)$/.exec(w)) && mGt1.test(m[1] + m[2])) {
      w = m[1] + m[2];
    }

    // Step 5: final -e and -ll
    if ((m = /^(.+?)e$/.exec(w)) && (mGt1.test(m[1]) || (mEq1.test(m[1]) && !cvc.test(m[1])))) w = m[1];
    if (/ll$/.test(w) && mGt1.test(w)) w = w.slice(0, -1);

    return initialY ? `y${w.slice(1)}` : w;
  };
})();

// A hyphenated word keeps its parts together: "self-efficacy" stems to "self-efficaci".
function stem(word) {
  return word.includes('-') ? word.split('-').map(stemWord).join('-') : stemWord(word);
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
// Punctuation between two words ends a phrase: "training, large classes" is not one phrase.
const PHRASE_BREAK = /[.,;:!?()[\]{}"“”«»\n]|\s[-–—]\s/;

// Splits text into word tokens: { surface, stem, start, end, stop, brk }. `stop` marks stopwords and words
// whose stem is in `excluded`; `brk` marks a phrase boundary before the token. Numbers and single letters
// are dropped and also end a phrase.
function tokenize(text, excluded = new Set()) {
  const tokens = [];
  let last = 0;
  let brk = true;
  for (const match of text.matchAll(WORD)) {
    if (PHRASE_BREAK.test(text.slice(last, match.index))) brk = true;
    last = match.index + match[0].length;
    const surface = match[0].normalize('NFKC').toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
    if (surface.length < 2 || /\d/.test(surface)) {
      brk = true;
      continue;
    }
    const s = stem(surface);
    tokens.push({ surface, stem: s, start: match.index, end: last, stop: STOPWORDS.has(surface) || excluded.has(s), brk });
    brk = false;
  }
  return tokens;
}

// The key of a word or phrase as typed by the user: the stems of its content words, joined by spaces.
function termKey(text) {
  return tokenize(text).filter(t => !t.stop).map(t => t.stem).join(' ');
}
