// src/services/api.js
import axios from 'axios';
import { Buffer } from 'buffer';
import { publishMatchUpdate } from '../state/matchUpdateBus';

/**
 * Robust Cricbuzz wrapper (updated)
 * - deterministic stable id generation when API omits id (fixes count flicker)
 * - inflight dedupe
 * - 429 handling (honors Retry-After)
 * - normalizeName helper to avoid [object Object]
 * - defensive transformMatchData + hscard parsing
 * - **adds startTime (epoch ms) and startTimeISO** to transformed matches
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY_HERE';
const CRICBUZZ_API_BASE = 'https://cricbuzz-cricket.p.rapidapi.com';

const apiClient = axios.create({
  baseURL: CRICBUZZ_API_BASE,
  headers: {
    'x-rapidapi-key': RAPIDAPI_KEY,
    'x-rapidapi-host': 'cricbuzz-cricket.p.rapidapi.com',
    Accept: 'application/json'
  },
  timeout: 15000
});

apiClient.interceptors.response.use(
  res => res,
  async (error) => {
    if (error?.response?.status === 429) {
      try {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '0', 10);
        const waitMs = (!retryAfter || isNaN(retryAfter)) ? 2000 : retryAfter * 1000;
        await new Promise(r => setTimeout(r, waitMs));
        if (!error.config.__isRetry) {
          error.config.__isRetry = true;
          return apiClient.request(error.config);
        }
      } catch (e) { /* ignore */ }
    }
    return Promise.reject(error);
  }
);

// ---------------- inflight dedupe ----------------
const inflight = new Map();

const dedupedGet = async (endpoint, options = {}) => {
  const key = `${endpoint}::${JSON.stringify(options.params ?? {})}`;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const res = await apiClient.get(endpoint, options);
      return res;
    } catch (err) {
      // extra safety for 429: wait and retry once
      if (err?.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '0', 10);
        const waitMs = (!retryAfter || isNaN(retryAfter)) ? 2000 : retryAfter * 1000;
        await new Promise(r => setTimeout(r, waitMs));
        const retryRes = await apiClient.get(endpoint, options);
        return retryRes;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
};

// ---------------- small helpers ----------------
const safeGet = (obj, path, fallback = undefined) => {
  try {
    if (!obj || !path) return fallback;
    return path.split('.').reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
};

const coerceToArray = (val) => {
  if (!val && val !== 0) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [val];
};

const safeString = (v, fallback = '') => (v == null ? fallback : String(v));

const firstNonEmptyString = (candidates = [], fallback = '') => {
  for (const cand of candidates) {
    if (cand == null) continue;
    if (typeof cand === 'object') {
      if (Array.isArray(cand)) {
        const nested = firstNonEmptyString(cand, null);
        if (nested) return nested;
        continue;
      }
      try {
        const asString = String(cand);
        if (asString && asString.trim()) return asString.trim();
      } catch {
        continue;
      }
    } else {
      const s = String(cand).trim();
      if (s) return s;
    }
  }
  return fallback;
};

const toTrimmedString = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value).trim();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    const text = String(value).trim();
    if (!text || text.toLowerCase() === '[object object]') return '';
    return text;
  } catch {
    return '';
  }
};

const resolveTextCandidate = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveTextCandidate(item);
      if (resolved) return resolved;
    }
    return '';
  }
  if (typeof value === 'object') {
    const probeKeys = ['resultDesc', 'result', 'description', 'summary', 'text', 'message', 'value'];
    for (const key of probeKeys) {
      if (value[key] != null) {
        const resolved = resolveTextCandidate(value[key]);
        if (resolved) return resolved;
      }
    }
  }
  return toTrimmedString(value);
};

const pickPreferredString = (candidates = [], { disallow = [] } = {}) => {
  const blocked = new Set(
    (disallow || [])
      .map((item) => resolveTextCandidate(item).toLowerCase())
      .filter(Boolean)
  );

  for (const candidate of candidates) {
    const text = resolveTextCandidate(candidate);
    if (!text) continue;
    if (blocked.has(text.toLowerCase())) continue;
    return text;
  }
  return '';
};

const WINNER_TEXT_REGEX = /(won\b|win\b|tie|tied|draw|no result|abandoned|shared)/i;

const pickWinnerString = (candidates = []) => {
  for (const candidate of candidates) {
    const text = resolveTextCandidate(candidate);
    if (!text) continue;
    if (WINNER_TEXT_REGEX.test(text)) {
      return text;
    }
  }
  return '';
};

const parseInteger = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).match(/-?\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return Number.isFinite(num) ? num : null;
};

const deriveResultFromScores = ({ team1Name, team2Name, team1Score, team2Score, status }) => {
  const runs1 = parseInteger(team1Score?.runs);
  const runs2 = parseInteger(team2Score?.runs);
  if (runs1 == null || runs2 == null) return '';

  if (runs1 === runs2) {
    const normalizedStatus = (status || '').toLowerCase();
    if (normalizedStatus.includes('tie')) return 'Match tied';
    if (normalizedStatus.includes('no result')) return 'No result';
    return '';
  }

  if (runs1 > runs2) {
    const margin = runs1 - runs2;
    return `${team1Name || 'Team 1'} won by ${margin} run${margin === 1 ? '' : 's'}`;
  }

  const wicketsLost = parseInteger(team2Score?.wickets);
  if (wicketsLost != null && wicketsLost < 10) {
    const wicketsRemaining = 10 - wicketsLost;
    if (wicketsRemaining > 0) {
      return `${team2Name || 'Team 2'} won by ${wicketsRemaining} wkt${wicketsRemaining === 1 ? '' : 's'}`;
    }
  }

  const margin = runs2 - runs1;
  return `${team2Name || 'Team 2'} won by ${margin} run${margin === 1 ? '' : 's'}`;
};

const normalizeTossText = (mi, { team1Name = '', team2Name = '' } = {}) => {
  if (!mi || typeof mi !== 'object') return '';

  const tossResults = safeGet(mi, 'tossResults') ?? safeGet(mi, 'tossresults') ?? null;
  let built = '';

  if (tossResults && typeof tossResults === 'object') {
    const winnerName = normalizeName(
      safeGet(tossResults, 'tossWinnerName') ??
      safeGet(tossResults, 'winner') ??
      safeGet(tossResults, 'tossWinner') ??
      safeGet(tossResults, 'winnerName') ??
      safeGet(tossResults, 'teamName') ??
      (team1Name || team2Name)
    );

    const rawDecision = safeGet(tossResults, 'decision') ?? safeGet(tossResults, 'tossDecision') ?? '';
    const d = String(rawDecision || '').toLowerCase();
    let decision = '';
    if (d.includes('bat')) decision = 'bat';
    else if (d.includes('bowl') || d.includes('field')) decision = 'bowl';

    if (winnerName && decision) {
      built = `${winnerName} won the toss and chose to ${decision}`;
    } else if (winnerName) {
      built = `${winnerName} won the toss`;
    }
  }

  let rawToss = built
    || safeGet(mi, 'toss')
    || safeGet(mi, 'tossInfo')
    || safeGet(mi, 'toss_text')
    || '';

  if (!rawToss) {
    const statusField = safeGet(mi, 'status') ?? safeGet(mi, 'Status') ?? '';
    const statusText = resolveTextCandidate(statusField);
    const lower = statusText.toLowerCase();
    if (lower && (lower.includes('won the toss') || lower.includes('opt to') || lower.includes('elected to'))) {
      rawToss = statusText;
    }
  }

  const candidate = resolveTextCandidate(rawToss);
  if (!candidate) return '';

  let text = candidate.trim();

  // Collapse patterns like "X - X" or "X-X" into "X" to avoid duplicated toss strings from API
  const hyphenPattern = /^(.+?)\s*[-–—]\s*\1\s*$/i;
  const m = text.match(hyphenPattern);
  if (m) {
    text = m[1].trim();
  }

  return text;
};

// ---------------- deterministic id generator ----------------
// Use stable fields (team names, start time, series, venue) to create a deterministic id
const djb2 = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + c
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    // keep in 32-bit range
    hash = hash & 0xFFFFFFFF;
  }
  // return unsigned hex string
  return (hash >>> 0).toString(16);
};

const generateStableId = (raw = {}, mi = {}) => {
  try {
    // Gather stable pieces of info
    const t1 = normalizeName(safeGet(mi, 'team1.teamName') ?? safeGet(mi, 'team1.name') ?? safeGet(raw, 'team1') ?? safeGet(raw, 'teamA') ?? '');
    const t2 = normalizeName(safeGet(mi, 'team2.teamName') ?? safeGet(mi, 'team2.name') ?? safeGet(raw, 'team2') ?? safeGet(raw, 'teamB') ?? '');
    const series = safeGet(mi, 'seriesName') ?? safeGet(raw, 'seriesName') ?? '';
    const start = safeGet(mi, 'startDate') ?? safeGet(mi, 'startDateTime') ?? safeGet(raw, 'startDate') ?? safeGet(raw, 'start') ?? '';
    const venue = safeGet(mi, 'venueInfo.ground') ?? safeGet(mi, 'venue') ?? safeGet(raw, 'venue') ?? '';
    const composite = `${series}|${t1}|${t2}|${start}|${venue}`;
    return `m-${djb2(composite)}`;
  } catch {
    return `m-${Math.random().toString(36).slice(2, 9)}`;
  }
};

// ---------------- name normalizer ----------------
const normalizeName = (val) => {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);

  const tryFields = ['teamName', 'name', 'fullName', 'displayName', 'shortName', 'teamSName', 'sName', 'title'];
  for (const f of tryFields) {
    if (val[f]) return String(val[f]);
  }

  for (const key of Object.keys(val || {})) {
    const v = val[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      for (const f of tryFields) {
        if (v[f]) return String(v[f]);
      }
    }
  }

  try {
    const s = JSON.stringify(val);
    return s.length > 40 ? s.slice(0, 37) + '...' : s;
  } catch {
    return '[Team]';
  }
};

const getCountryFlag = (teamName = '') => {
  if (!teamName) return '🏏';
  const flagMap = {
    'India': '🇮🇳', 'Australia': '🇦🇺', 'England': '🏴', 'Pakistan': '🇵🇰',
    'South Africa': '🇿🇦', 'New Zealand': '🇳🇿', 'West Indies': '🇹🇹',
    'Sri Lanka': '🇱🇰', 'Bangladesh': '🇧🇩', 'Afghanistan': '🇦🇫',
    'Zimbabwe': '🇿🇼', 'Ireland': '🇮🇪', 'Netherlands': '🇳🇱',
    'USA': '🇺🇸', 'Canada': '🇨🇦'
  };
  if (flagMap[teamName]) return flagMap[teamName];
  const lower = String(teamName).toLowerCase();
  for (const country of Object.keys(flagMap)) {
    if (lower.includes(country.toLowerCase())) return flagMap[country];
  }
  return '🏏';
};

const getMatchStatus = (apiStatus) => {
  const s = (apiStatus == null ? '' : String(apiStatus)).trim().toLowerCase();
  if (!s) return 'Scheduled';
  if (s.includes('live') || s.includes('in progress') || s.includes('inprogress') || s.includes('toss')) return 'Live';
  if (s.includes('complete') || s.includes('completed') || s.includes('finished') || s.includes('result') || s.includes('won')) return 'Completed';
  if (s.includes('upcoming') || s.includes('preview') || s.includes('scheduled') || s.includes('match scheduled') || s.includes('previewing')) return 'Scheduled';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const formatScoreFromInnings = (inning) => {
  if (!inning) return { runs: '0', wickets: '0', overs: '0.0' };
  const runs = inning.runs ?? inning.score ?? inning.totalRuns ?? inning.total ?? inning.r ?? 0;
  const wickets = inning.wickets ?? inning.totalWkts ?? inning.w ?? 0;
  const overs = inning.overs ?? inning.oversPlayed ?? inning.totalOvers ?? inning.o ?? '0.0';
  return { runs: String(runs ?? 0), wickets: String(wickets ?? 0), overs: String(overs ?? '0.0') };
};

const oversToBalls = (overs) => {
  if (overs == null) return 0;
  const match = String(overs).trim().match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const ov = parseInt(match[1] || '0', 10);
  const ballsPartRaw = match[2] != null ? match[2] : '0';
  const ballsPart = parseInt(ballsPartRaw, 10);
  if (Number.isNaN(ov) || Number.isNaN(ballsPart)) return 0;
  return (ov * 6) + ballsPart;
};

const chooseOversString = (currentValue, incomingValue) => {
  const trimmedIncoming = incomingValue != null ? String(incomingValue).trim() : '';
  if (!trimmedIncoming) return currentValue;
  if (!currentValue || !String(currentValue).trim()) return trimmedIncoming;

  const currBalls = oversToBalls(currentValue);
  const nextBalls = oversToBalls(trimmedIncoming);
  if (currBalls > 0 && nextBalls > 0 && currBalls === nextBalls) {
    return String(currentValue).trim();
  }

  return trimmedIncoming;
};

// ---------------- start time normalization helper ----------------
const parseStartTimeToEpochMs = (rawVal) => {
  if (rawVal == null) return null;
  // numeric types
  if (typeof rawVal === 'number') {
    // heuristics: if > 1e12 assume ms, if between 1e9 and 1e12 assume seconds -> convert to ms
    if (rawVal > 1e12) return rawVal;
    if (rawVal > 1e9) return rawVal * 1000;
    // otherwise unlikely, return null
    return null;
  }
  // string
  const s = String(rawVal).trim();
  if (!s) return null;
  // if numeric string
  if (/^\d+$/.test(s)) {
    try {
      const n = Number(s);
      if (n > 1e12) return n;
      if (n > 1e9) return n * 1000;
      return null;
    } catch { /* fallthrough */ }
  }
  // try Date.parse for ISO or common formats
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) return parsed;
  // try to parse common formats like '2025-11-14T05:30:00Z' handled above; if not parseable -> null
  return null;
};

// ---------------- transformMatchData ----------------
const transformMatchData = (raw) => {
  try {
    if (!raw || typeof raw !== 'object') return null;

    const mi = raw.matchInfo ?? raw.match ?? raw.matchinfo ?? raw;
    const ms = raw.matchScore ?? raw.score ?? raw.matchScoreCard ?? raw;

    const team1Obj = safeGet(mi, 'team1') ?? safeGet(mi, 'teamA') ?? {};
    const team2Obj = safeGet(mi, 'team2') ?? safeGet(mi, 'teamB') ?? {};

    const team1Id = safeString(safeGet(team1Obj, 'teamId') ?? safeGet(team1Obj, 'id') ?? safeGet(team1Obj, 'teamid') ?? '') || '';
    const team2Id = safeString(safeGet(team2Obj, 'teamId') ?? safeGet(team2Obj, 'id') ?? safeGet(team2Obj, 'teamid') ?? '') || '';

    const rawTeam1 = safeGet(team1Obj, 'teamName') ?? safeGet(team1Obj, 'name') ?? team1Obj;
    const rawTeam2 = safeGet(team2Obj, 'teamName') ?? safeGet(team2Obj, 'name') ?? team2Obj;

    const team1Name = normalizeName(rawTeam1) || 'Team 1';
    const team2Name = normalizeName(rawTeam2) || 'Team 2';

    const team1Inn = safeGet(ms, 'team1Score.inngs1')
      ?? safeGet(ms, 'team1Score.innings1')
      ?? safeGet(ms, 'team1Score')
      ?? safeGet(ms, 'inning1') ?? {};
    const team2Inn = safeGet(ms, 'team2Score.inngs1')
      ?? safeGet(ms, 'team2Score.innings1')
      ?? safeGet(ms, 'team2Score')
      ?? safeGet(ms, 'inning2') ?? {};

    const t1 = formatScoreFromInnings(team1Inn);
    const t2 = formatScoreFromInnings(team2Inn);

    // venue extraction
    const venueCandidates = [
      safeGet(mi, 'venueInfo'),
      safeGet(mi, 'venueinfo'),
      safeGet(mi, 'venue'),
      safeGet(raw, 'venueinfo'),
      safeGet(raw, 'venue'),
      safeGet(mi, 'venueInfo.ground'),
      safeGet(mi, 'venueinfo.ground'),
    ];

    let venue = 'Unknown Venue';
    for (const v of venueCandidates) {
      if (!v) continue;
      if (typeof v === 'string' && v.trim()) {
        venue = v;
        break;
      }
      if (typeof v === 'object') {
        venue = v.ground || v.name || (v.city ? `${v.city}${v.country ? ', ' + v.country : ''}` : venue) || venue;
        if (venue && venue !== 'Unknown Venue') break;
      }
    }

    // stable id: prefer explicit fields, else generate deterministically
    const idFromRaw = safeString(safeGet(mi, 'matchId') ?? safeGet(mi, 'id') ?? safeGet(raw, 'id'));
    const id = idFromRaw || generateStableId(raw, mi);

    const tryStatusCandidates = [
      safeGet(mi, 'state'),
      safeGet(mi, 'matchstate'),
      safeGet(mi, 'matchState'),
      safeGet(mi, 'status'),
      safeGet(raw, 'state'),
      safeGet(raw, 'matchstate'),
      safeGet(raw, 'matchState'),
      safeGet(raw, 'status'),
      safeGet(raw, 'matchStateName'),
      safeGet(raw, 'matchstateName'),
      ''
    ];

    let statusRaw = '';
    for (const cand of tryStatusCandidates) {
      if (cand != null && String(cand).trim() !== '') {
        statusRaw = cand;
        break;
      }
    }

    if (!statusRaw) {
      statusRaw = safeGet(raw, 'matchInfo.matchState') ?? safeGet(raw, 'matchInfo.state') ?? safeGet(raw, 'matchstate') ?? '';
    }

    const status = getMatchStatus(statusRaw);

    // ---------------- start time extraction ----------------
    // Try many possible places that different APIs/rapidapi shapes may use
    const startCandidates = [
      safeGet(mi, 'startDate'),
      safeGet(mi, 'startDateTime'),
      safeGet(mi, 'start'),
      safeGet(mi, 'startTime'),
      safeGet(mi, 'startTimestamp'),
      safeGet(mi, 'startTimeEpoch'),
      safeGet(mi, 'matchStartTimestamp'),
      safeGet(mi, 'matchStartDate'),
      safeGet(raw, 'startDate'),
      safeGet(raw, 'startDateTime'),
      safeGet(raw, 'start'),
      safeGet(raw, 'date'),
      safeGet(raw, 'dateTime'),
      safeGet(raw, 'matchStart'),
      safeGet(raw, 'matchStartTimestamp'),
      safeGet(raw, 'start_time'),
      safeGet(raw, 'start_ts'),
      safeGet(raw, 'scheduledAt'),
      safeGet(raw, 'dateStr'),
      safeGet(raw, 'utcStartTime')
    ];

    let startEpochMs = null;
    let startISO = null;
    for (const cand of startCandidates) {
      if (cand == null) continue;
      const parsed = parseStartTimeToEpochMs(cand);
      if (parsed != null) {
        startEpochMs = parsed;
        startISO = new Date(parsed).toISOString();
        break;
      }
    }

    // If still null, some APIs provide nested matchInfo.start or series.start; try shallow search
    if (startEpochMs == null) {
      // attempt to look for any numeric-like fields in mi/raw
      const tryFindNumeric = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v == null) continue;
          if (typeof v === 'number') {
            const p = parseStartTimeToEpochMs(v);
            if (p) return p;
          }
          if (typeof v === 'string' && /^\d{9,13}$/.test(v)) {
            const p = parseStartTimeToEpochMs(v);
            if (p) return p;
          }
        }
        return null;
      };
      const found = tryFindNumeric(mi) || tryFindNumeric(raw);
      if (found) {
        startEpochMs = found;
        startISO = new Date(found).toISOString();
      }
    }

    // ---------------- end start time extraction ----------------

    let liveSummary = '';

    const resultPrimary = [
      safeGet(mi, 'result'),
      safeGet(mi, 'matchResult'),
      safeGet(mi, 'statusText'),
      safeGet(raw, 'matchHeader.resultDesc'),
      safeGet(raw, 'matchHeader.result'),
      safeGet(raw, 'matchScore.matchResult'),
      safeGet(raw, 'matchScore.result'),
      safeGet(raw, 'matchScore.summary'),
      safeGet(raw, 'result')
    ];
    const resultFallbackCandidates = [
      safeGet(mi, 'status'),
      safeGet(raw, 'matchHeader.status'),
      safeGet(raw, 'matchHeader.statusText'),
      safeGet(raw, 'status')
    ];
    let resultText = pickPreferredString(resultPrimary);
    const derivedWinnerText = deriveResultFromScores({
      team1Name,
      team2Name,
      team1Score: t1,
      team2Score: t2,
      status: statusRaw
    });

    if (!resultText) {
      resultText = pickPreferredString(resultFallbackCandidates);
    }
    if (!resultText && status === 'Completed') {
      resultText = derivedWinnerText;
    }

    if (status === 'Live') {
      const liveSummaryCandidates = [
        safeGet(mi, 'statusText'),
        safeGet(raw, 'matchScore.summary'),
        safeGet(raw, 'matchHeader.statusText'),
        resultText
      ];
      liveSummary = pickPreferredString(liveSummaryCandidates);
      // Avoid overloading result with dynamic live summary text
      if (!resultText) {
        resultText = liveSummary;
      }
    }

    const resultMarginText = pickWinnerString([
      safeGet(mi, 'matchResult'),
      safeGet(raw, 'matchScore.matchResult'),
      safeGet(raw, 'matchScore.result'),
      safeGet(raw, 'matchScore.summary'),
      safeGet(mi, 'statusText'),
      resultText,
      derivedWinnerText
    ]) || (status === 'Completed' ? derivedWinnerText : '');

    return {
      id,
      team1: {
        id: team1Id,
        name: team1Name,
        shortName: safeGet(team1Obj, 'teamSName') ?? (team1Name ? team1Name.slice(0,3).toUpperCase() : 'T1'),
        flag: getCountryFlag(team1Name),
        score: t1.runs,
        wickets: t1.wickets,
        overs: t1.overs,
        battingScorecard: [],
        bowlingScorecard: [],
        extras: { total: 0 }
      },
      team2: {
        id: team2Id,
        name: team2Name,
        shortName: safeGet(team2Obj, 'teamSName') ?? (team2Name ? team2Name.slice(0,3).toUpperCase() : 'T2'),
        flag: getCountryFlag(team2Name),
        score: t2.runs,
        wickets: t2.wickets,
        overs: t2.overs,
        battingScorecard: [],
        bowlingScorecard: [],
        extras: { total: 0 }
      },
      status,
      type: safeGet(mi, 'matchFormat') ?? safeGet(mi, 'matchType') ?? safeGet(raw, 'format') ?? 'Match',
      venue,
      toss: normalizeTossText(mi, { team1Name, team2Name }),
      result: resultText,
      resultMargin: resultMarginText,
      liveSummary,
      seriesName: safeGet(mi, 'seriesName') ?? safeGet(raw, 'seriesName') ?? '',
      // normalized start times:
      startTime: startEpochMs,            // epoch ms (number) or null
      startTimeISO: startISO,            // ISO string or null
      currentBatsmen: [],
      currentBowler: null,
      recentBalls: []
    };
  } catch (err) {
    console.error('transformMatchData error', err);
    return null;
  }
};

// ---------------- fallback matches ----------------
const getFallbackMatches = () => ([
  {
    id: 'fallback-1',
    team1: { name: 'India', shortName: 'IND', flag: '🇮🇳', score: '285', wickets: '6', overs: '50.0', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 } },
    team2: { name: 'Australia', shortName: 'AUS', flag: '🇦🇺', score: '245', wickets: '10', overs: '48.2', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 } },
    status: 'Completed', type: 'ODI', venue: 'Melbourne Cricket Ground', toss: 'India won the toss and chose to bat', result: 'India won by 40 runs', seriesName: 'Sample Series', currentBatsmen: [], currentBowler: null, recentBalls: [],
    // include sample startTime
    startTime: null,
    startTimeISO: null
  }
]);

// ---------------- caching for match details ----------------
const matchDetailsCache = new Map();
const MATCH_DETAILS_TTL = 20 * 1000; // 20s

// ---------------- public APIs ----------------
export const fetchMatches = async (type = 'live') => {
  try {
    let endpoint = '/matches/v1/live';
    if (type === 'recent') endpoint = '/matches/v1/recent';
    if (type === 'upcoming') endpoint = '/matches/v1/upcoming';
    const res = await dedupedGet(endpoint);
    const data = res?.data ?? res;
    const matches = [];

    // try parsing several shapes
    if (data && data.typeMatches) {
      (data.typeMatches || []).forEach(tm => {
        (tm.seriesMatches || []).forEach(series => {
          const matchesArr = series.seriesAdWrapper?.matches ?? series.matches ?? [];
          coerceToArray(matchesArr).forEach(m => {
            const t = transformMatchData(m);
            if (t) matches.push(t);
          });
        });
      });
    }

    if (matches.length === 0 && Array.isArray(data.matches)) {
      coerceToArray(data.matches).forEach(m => {
        const t = transformMatchData(m);
        if (t) matches.push(t);
      });
    }

    if (matches.length === 0) {
      const candidate = transformMatchData(data);
      if (candidate) matches.push(candidate);
    }

    return matches.length ? matches : getFallbackMatches();
  } catch (err) {
    console.error('fetchMatches error:', err?.message ?? err);
    return getFallbackMatches();
  }
};

export const fetchMatchDetails = async (matchId, options = {}) => {
  try {
    if (!matchId) throw new Error('matchId is required');

    const { force = false } = options || {};

    // cache check
    const cacheEntry = matchDetailsCache.get(matchId);
    if (!force && cacheEntry && (Date.now() - cacheEntry.ts) < MATCH_DETAILS_TTL) {
      return cacheEntry.data;
    }

    console.log(`🔄 [api] Fetching match details for ID: ${matchId}`);
    const res = await dedupedGet(`/mcenter/v1/${matchId}`);
    const raw = res?.data ?? res;

    if (__DEV__) {
      console.log('🧾 [api] mcenter raw response:', JSON.stringify(raw).slice(0, 600));
    }

    let matchData = transformMatchData(raw);
    if (!matchData) {
      console.warn('⚠️ [api] transformMatchData returned null — building fallback mapping');
      const mi = raw.matchInfo ?? raw.match ?? raw.matchinfo ?? raw;
      const team1Obj = safeGet(mi, 'team1') ?? safeGet(mi, 'teamA') ?? {};
      const team2Obj = safeGet(mi, 'team2') ?? safeGet(mi, 'teamB') ?? {};
      // try to extract start time similar to transformMatchData
      const possibleStart = safeGet(mi, 'startDate') ?? safeGet(mi, 'startDateTime') ?? safeGet(mi, 'start') ?? safeGet(raw, 'start') ?? null;
      const parsedStart = parseStartTimeToEpochMs(possibleStart);
      const startISO = parsedStart ? new Date(parsedStart).toISOString() : null;
      const fallbackPrimary = [
        safeGet(mi, 'result'),
        safeGet(mi, 'matchResult'),
        safeGet(mi, 'statusText'),
        safeGet(raw, 'matchHeader.resultDesc'),
        safeGet(raw, 'matchHeader.result'),
        safeGet(raw, 'matchScore.result'),
        safeGet(raw, 'matchScore.matchResult'),
        safeGet(raw, 'matchScore.summary'),
        safeGet(raw, 'result')
      ];
      const fallbackStatus = [
        safeGet(mi, 'status'),
        safeGet(raw, 'matchHeader.status'),
        safeGet(raw, 'matchHeader.statusText'),
        safeGet(raw, 'status')
      ];

      let resultFallback = pickPreferredString(fallbackPrimary);
      const derivedFallbackWinner = deriveResultFromScores({
        team1Name: normalizeName(safeGet(team1Obj, 'teamName') ?? safeGet(team1Obj, 'name') ?? 'Team 1'),
        team2Name: normalizeName(safeGet(team2Obj, 'teamName') ?? safeGet(team2Obj, 'name') ?? 'Team 2'),
        team1Score: { runs: safeGet(mi, 'team1Runs') ?? t1?.runs, wickets: safeGet(mi, 'team1Wkts') ?? t1?.wickets },
        team2Score: { runs: safeGet(mi, 'team2Runs') ?? t2?.runs, wickets: safeGet(mi, 'team2Wkts') ?? t2?.wickets },
        status: safeGet(mi, 'status')
      });

      if (!resultFallback) {
        resultFallback = pickPreferredString(fallbackStatus);
      }

      const normalizedFallbackStatus = getMatchStatus(safeGet(mi, 'state') ?? safeGet(mi, 'status') ?? '');

      if (!resultFallback && normalizedFallbackStatus === 'Completed') {
        resultFallback = derivedFallbackWinner;
      }

      const resultFallbackMargin = pickWinnerString([
        safeGet(mi, 'matchResult'),
        safeGet(raw, 'matchScore.matchResult'),
        safeGet(raw, 'matchScore.result'),
        safeGet(raw, 'matchScore.summary'),
        safeGet(mi, 'statusText'),
        resultFallback,
        derivedFallbackWinner
      ]) || (normalizedFallbackStatus === 'Completed' ? derivedFallbackWinner : '');

      let liveSummaryFallback = '';
      if (normalizedFallbackStatus === 'Live') {
        const liveSummaryCandidates = [
          safeGet(mi, 'statusText'),
          safeGet(raw, 'matchScore.summary'),
          safeGet(raw, 'matchHeader.statusText'),
          resultFallback
        ];
        liveSummaryFallback = pickPreferredString(liveSummaryCandidates);
        // keep resultFallback empty for live matches to avoid confusion with results
        resultFallback = '';
      }

      matchData = {
        id: safeString(safeGet(mi, 'matchId') ?? safeGet(mi, 'id') ?? matchId),
        team1: {
          name: normalizeName(safeGet(team1Obj, 'teamName') ?? safeGet(team1Obj, 'name') ?? team1Obj) || 'Team 1',
          shortName: safeGet(team1Obj, 'teamSName') ?? '',
          flag: getCountryFlag(normalizeName(safeGet(team1Obj, 'teamName') ?? safeGet(team1Obj, 'name') ?? '')),
          score: '0', wickets: '0', overs: '0.0', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 }
        },
        team2: {
          name: normalizeName(safeGet(team2Obj, 'teamName') ?? safeGet(team2Obj, 'name') ?? team2Obj) || 'Team 2',
          shortName: safeGet(team2Obj, 'teamSName') ?? '',
          flag: getCountryFlag(normalizeName(safeGet(team2Obj, 'teamName') ?? safeGet(team2Obj, 'name') ?? '')),
          score: '0', wickets: '0', overs: '0.0', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 }
        },
        status: normalizedFallbackStatus,
        type: safeGet(mi, 'matchFormat') ?? safeGet(mi, 'matchType') ?? 'Match',
        venue: safeGet(mi, 'venueInfo') ?? safeGet(mi, 'venue') ?? 'Unknown Venue',
        toss: normalizeTossText(mi, {
          team1Name: normalizeName(safeGet(team1Obj, 'teamName') ?? safeGet(team1Obj, 'name') ?? 'Team 1'),
          team2Name: normalizeName(safeGet(team2Obj, 'teamName') ?? safeGet(team2Obj, 'name') ?? 'Team 2')
        }),
        result: resultFallback,
        resultMargin: resultFallbackMargin,
        seriesName: safeGet(mi, 'seriesName') ?? '',
        liveSummary: liveSummaryFallback,
        // normalized start time (fallback)
        startTime: parsedStart ?? null,
        startTimeISO: startISO,
        currentBatsmen: [],
        currentBowler: null,
        recentBalls: []
      };
    }

    // Attach raw for debugging (temporary)
    matchData.__raw = raw;

    // ------------------- hscard parsing -------------------
    try {
      const scRes = await dedupedGet(`/mcenter/v1/${matchId}/hscard`);
      const sc = scRes?.data ?? scRes;
      if (__DEV__) {
        console.log('🧾 [api] hscard raw response:', JSON.stringify(sc).slice(0, 600));
      }

      const scoreCardArr = coerceToArray(sc?.scoreCard ?? sc?.scorecard ?? sc?.innings ?? sc);

      if (Array.isArray(scoreCardArr) && scoreCardArr.length > 0) {
        const formatOversFromBalls = (balls) => {
          if (!balls || isNaN(balls)) return '0.0';
          const ints = Math.floor(balls / 6);
          const rem = balls % 6;
          return `${ints}.${rem}`;
        };

        const matchTeam1Id = matchData.team1?.id ? String(matchData.team1.id) : '';
        const matchTeam2Id = matchData.team2?.id ? String(matchData.team2.id) : '';
        const matchTeam1Name = normalizeName(matchData.team1?.name ?? '') || '';
        const matchTeam2Name = normalizeName(matchData.team2?.name ?? '') || '';

        scoreCardArr.forEach((inning, idx) => {
          const statusInning = inning.inningsId != null ? String(inning.inningsId) : null;
          const inningTeamId = safeString(
            inning.batTeamId ?? inning.batteamid ?? inning.batteamID ?? inning.battingTeamId ?? inning.teamId ?? inning.teamid ??
            safeGet(inning, 'batTeamDetails.teamId') ?? safeGet(inning, 'batTeam.teamId') ??''
          ) || '';
          const inningTeamName = normalizeName(
            inning.batTeamName ?? inning.batteamname ?? inning.battingTeamName ??
            safeGet(inning, 'batTeamDetails.teamName') ?? safeGet(inning, 'batTeam.teamName') ?? ''
          ) || '';

          let isTeam1Inning = false;
          if (matchTeam1Id && inningTeamId) {
            isTeam1Inning = inningTeamId === matchTeam1Id;
          } else if (matchTeam2Id && inningTeamId) {
            isTeam1Inning = inningTeamId !== matchTeam2Id;
          } else if (inningTeamName) {
            if (matchTeam1Name && inningTeamName === matchTeam1Name) {
              isTeam1Inning = true;
            } else if (matchTeam2Name && inningTeamName === matchTeam2Name) {
              isTeam1Inning = false;
            } else {
              isTeam1Inning = idx === 0 || (statusInning && /1$/.test(statusInning));
            }
          } else {
            isTeam1Inning = idx === 0 || (statusInning && /1$/.test(statusInning));
          }

          const batsmenArr = coerceToArray(inning.batsman ?? inning.batting ?? inning.batsmen ?? inning.batsmenData ?? []);
          const bowlersArr = coerceToArray(inning.bowler ?? inning.bowlers ?? inning.bowling ?? inning.bowlersData ?? []);
          const extrasObj = inning.extras ?? inning.extrasInfo ?? inning.extrasSummary ?? {};

          const batsmen = batsmenArr.map(b => ({
            name: b.name ?? b.batName ?? b.playerName ?? 'Batsman',
            runs: String(b.runs ?? b.r ?? 0),
            balls: String(b.balls ?? b.b ?? 0),
            fours: String(b.fours ?? 0),
            sixes: String(b.sixes ?? 0),
            strikeRate: (b.strkrate ?? b.strikeRate ?? b.sr ?? '0')
          }));

          const bowlers = bowlersArr.map(b => ({
            name: b.name ?? b.bowlName ?? b.playerName ?? 'Bowler',
            overs: String(b.overs ?? b.o ?? 0),
            maidens: String(b.maidens ?? b.m ?? 0),
            runs: String(b.runs ?? b.r ?? 0),
            wickets: String(b.wickets ?? b.w ?? 0),
            economy: (b.eco ?? b.economy ?? b.ec ?? '0')
          }));

          const totalRuns = inning.runs ?? inning.totalRuns ?? inning.total ?? inning.score ?? inning.teamTotal ?? null;
          const totalWkts = inning.wkts ?? inning.wickets ?? inning.totalWkts ?? inning.w ?? null;
          const oversStr = inning.overs ?? inning.oversPlayed ?? inning.totalOvers ?? inning.o ?? null;

          let computedRuns = null;
          let computedWkts = null;
          let computedOvers = null;

          if (totalRuns != null) {
            computedRuns = String(totalRuns);
          } else {
            const batsSum = batsmenArr.reduce((s, b) => s + Number(b.runs ?? b.r ?? 0), 0);
            const extraTotal = (extrasObj && (extrasObj.total ?? extrasObj.extras ?? extrasObj.extrasTotal)) ? Number(extrasObj.total ?? extrasObj.extras ?? extrasObj.extrasTotal) : 0;
            computedRuns = String(batsSum + extraTotal);
          }

          if (totalWkts != null) {
            computedWkts = String(totalWkts);
          } else {
            const wktsCount = batsmenArr.reduce((c, b) => {
              if (b.outdec || b.out || b.dismissal) return c + 1;
              return c;
            }, 0);
            computedWkts = String(wktsCount);
          }

          if (oversStr != null) {
            computedOvers = String(oversStr);
          } else {
            const ballsFromBats = batsmenArr.reduce((s, b) => s + Number(b.balls ?? b.b ?? 0), 0);
            const inningBalls = inning.balls ?? inning.totalBalls ?? null;
            const balls = (inningBalls != null) ? Number(inningBalls) : ballsFromBats;
            computedOvers = balls ? formatOversFromBalls(balls) : (inning.overs ?? '0.0');
          }

          if (isTeam1Inning) {
            matchData.team1.battingScorecard = batsmen;
            matchData.team2.bowlingScorecard = bowlers;
            matchData.team1.extras = (extrasObj && (extrasObj.total != null)) ? { total: Number(extrasObj.total) } : (extrasObj || matchData.team1.extras);
            matchData.team1.score = computedRuns ?? matchData.team1.score;
            matchData.team1.wickets = computedWkts ?? matchData.team1.wickets;
            matchData.team1.overs = chooseOversString(matchData.team1.overs, computedOvers ?? matchData.team1.overs);
          } else {
            matchData.team2.battingScorecard = batsmen;
            matchData.team1.bowlingScorecard = bowlers;
            matchData.team2.extras = (extrasObj && (extrasObj.total != null)) ? { total: Number(extrasObj.total) } : (extrasObj || matchData.team2.extras);
            matchData.team2.score = computedRuns ?? matchData.team2.score;
            matchData.team2.wickets = computedWkts ?? matchData.team2.wickets;
            matchData.team2.overs = chooseOversString(matchData.team2.overs, computedOvers ?? matchData.team2.overs);
          }
        });
      } else {
        console.log('ℹ️ [api] hscard missing expected scoreCard array; shape keys:', Object.keys(sc || {}));
      }
    } catch (scErr) {
      console.warn('⚠️ [api] Scorecard fetch failed (hscard):', scErr?.message || scErr);
    }
    // ------------------- end hscard parsing -------------------

    matchDetailsCache.set(matchId, { data: matchData, ts: Date.now() });
    publishMatchUpdate(matchData);
    console.log('✅ [api] Match details loaded (transformed) for', matchData.id);
    return matchData;

  } catch (err) {
    console.error('❌ fetchMatchDetails error:', err?.message ?? err);
    return {
      id: matchId,
      team1: { name: 'Team 1', shortName: 'TM1', flag: '🏏', score: '0', wickets: '0', overs: '0.0', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 } },
      team2: { name: 'Team 2', shortName: 'TM2', flag: '🏏', score: '0', wickets: '0', overs: '0.0', battingScorecard: [], bowlingScorecard: [], extras: { total: 0 } },
      status: 'Scheduled',
      type: 'Match',
      venue: 'Unknown Venue',
      toss: '',
      result: '',
      liveSummary: '',
      seriesName: 'Unknown Series',
      startTime: null,
      startTimeISO: null,
      currentBatsmen: [],
      currentBowler: null,
      recentBalls: []
    };
  }
};

export const fetchMatchCommentary = async (matchId) => {
  try {
    if (!matchId) throw new Error('matchId required');
    const res = await dedupedGet(`/mcenter/v1/${matchId}/hcomm`);
    return res?.data ?? res;
  } catch (err) {
    console.warn('fetchMatchCommentary error', err?.message ?? err);
    return null;
  }
};

export const fetchMatchOvers = async (matchId) => {
  try {
    if (!matchId) throw new Error('matchId required');
    const res = await dedupedGet(`/mcenter/v1/${matchId}/overs`);
    return res?.data ?? res;
  } catch (err) {
    console.warn('fetchMatchOvers error', err?.message ?? err);
    return null;
  }
};

export const fetchRankings = async ({ format = 'test', type = 'batsmen' } = {}) => {
  const map = {
    batsmen: '/stats/v1/rankings/batsmen',
    bowlers: '/stats/v1/rankings/bowlers',
    allrounders: '/stats/v1/rankings/allrounders',
    teams: '/stats/v1/rankings/teams'
  };

  const endpoint = map[type] ?? '/stats/v1/rankings/batsmen';
  try {
    const res = await dedupedGet(endpoint, {
      params: { formatType: format }
    });

    const data = res?.data ?? res ?? {};
    let rankArr = data.rank ?? data.ranks ?? data.rankings ?? data.data ?? [];

    if (!Array.isArray(rankArr) && typeof rankArr === 'object') {
      rankArr = Object.values(rankArr);
    }
    if (!Array.isArray(rankArr)) rankArr = [];

    const normalized = rankArr.map((r) => ({
      id: String(r.id ?? r.playerId ?? r.pid ?? (r.name ? r.name.replace(/\s+/g,'_') : Math.random().toString(36).slice(2))),
      rank: String(r.rank ?? r.position ?? ''),
      name: r.name ?? r.playerName ?? r.fullName ?? 'Unknown',
      country: r.country ?? r.team ?? '',
      rating: String(r.rating ?? r.points ?? ''),
      points: String(r.points ?? r.rating ?? ''),
      lastUpdatedOn: r.lastUpdatedOn ?? r.updatedOn ?? '',
      trend: r.trend ?? r.movement ?? 'Flat',
      faceImageId: r.faceImageId ?? r.faceId ?? ''
    }));

    return normalized;
  } catch (err) {
    const msg = err?.response?.data?.message || err?.message || 'Failed to fetch rankings';
    const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    e.inner = err;
    throw e;
  }
};

const fetchImageWithRetry = async (url, attempts = 3, initialDelay = 500) => {
  let attempt = 0;
  let delay = initialDelay;
  while (attempt < attempts) {
    try {
      const resp = await apiClient.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      return resp;
    } catch (err) {
      attempt += 1;
      if (attempt >= attempts) {
        throw err;
      }
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
};

export const fetchNews = async ({ attachImages = true, maxImages = 8 } = {}) => {
  try {
    const res = await dedupedGet('/news/v1/index');
    const data = res?.data ?? res ?? {};

    let rawList = data.storyList ?? [];
    if (!Array.isArray(rawList)) rawList = coerceToArray(rawList);

    const stories = rawList
      .map((it) => it.story ?? null)
      .filter(Boolean)
      .map((s) => ({
        id: String(s.id ?? Math.random().toString(36).slice(2, 9)),
        hline: s.hline ?? s.seoHeadline ?? '',
        intro: s.intro ?? '',
        pubTime: s.pubTime ?? s.published ?? '',
        source: s.source ?? '',
        storyType: s.storyType ?? '',
        imageId: s.imageId ?? s.coverImage?.id ?? '',
        coverImage: s.coverImage ?? null,
        raw: s,
        imageData: null
      }));

    if (attachImages) {
      const toFetch = stories.filter((st) => st.imageId).slice(0, maxImages);

      await Promise.all(
        toFetch.map(async (st) => {
          try {
            const imageId = st.imageId;
            const imgUrl = `https://cricbuzz-cricket.p.rapidapi.com/img/v1/i1/${imageId}/i.jpg`;
            const imgRes = await fetchImageWithRetry(imgUrl, 3, 500);
            if (!imgRes || !imgRes.data) {
              console.warn('[fetchNews] empty image response for', imageId);
              return;
            }
            const base64 = Buffer.from(imgRes.data).toString('base64');
            st.imageData = `data:image/jpeg;base64,${base64}`;
            console.log(`[fetchNews] image attached for story ${st.id} (${imageId})`);
          } catch (e) {
            const status = e?.response?.status;
            const msg = e?.message ?? String(e);
            console.warn('[fetchNews] image fetch failed for', st.imageId, 'status:', status, 'msg:', msg);
          }
        })
      );
    }

    return stories;
  } catch (err) {
    console.warn('fetchNews error:', err?.message ?? err);
    return [];
  }
};

export const fetchImageDataById = async (imageId, { timeout = 15000 } = {}) => {
  if (!imageId) throw new Error('no imageId');
  try {
    const url = `https://cricbuzz-cricket.p.rapidapi.com/img/v1/i1/${imageId}/i.jpg`;
    const resp = await fetchImageWithRetry(url, 3, 500);
    if (!resp || !resp.data) throw new Error('empty image response');

    const b64 = Buffer.from(resp.data).toString('base64');
    const dataUri = `data:image/jpeg;base64,${b64}`;
    return { dataUri };
  } catch (err) {
    const msg = err?.response
      ? `status=${err.response.status} ${err.response.statusText}`
      : err?.message ?? String(err);
    throw new Error(`fetchImageDataById(${imageId}) failed: ${msg}`);
  }
};


export default {
  fetchMatches,
  fetchMatchDetails,
  fetchMatchCommentary,
  fetchMatchOvers
};
