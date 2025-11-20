// src/screens/HomeScreen.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    ActivityIndicator,
    FlatList,
    InteractionManager,
    RefreshControl,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fetchMatches } from '../services/api';
import { publishMatchUpdate, subscribeToMatchUpdates } from '../state/matchUpdateBus';

// Module-level cache
let cachedMatches = [];
let cachedFilter = 'all';
let cachedAliases = {}; // stores altId -> canonicalId aliases in-memory

// TTL + intervals
const MATCH_NOT_SEEN_TTL = 5 * 60 * 1000; // 5 minutes
const PURGE_INTERVAL_MS = 15 * 1000;
const STARTUP_QUIET_WINDOW_MS = 1500; // increase if network bursts are noisy

const teamSummaryKey = (team = {}) => [
  team?.name ?? '',
  team?.shortName ?? '',
  team?.score ?? '',
  team?.wickets ?? '',
  team?.overs ?? ''
].join('|');

const matchSummaryKey = (match = {}) => [
  match?.id ?? '',
  match?.status ?? '',
  match?.result ?? '',
  match?.type ?? '',
  match?.seriesName ?? '',
  match?.venue ?? '',
  teamSummaryKey(match?.team1),
  teamSummaryKey(match?.team2)
].join('::');

const teamDisplayName = (team = {}) => {
  if (!team) return '';
  const { name, shortName, teamName, teamSName, sName } = team;
  return name || teamName || shortName || teamSName || sName || '';
};

const normalizeTeamToken = (teamLike) => {
  if (teamLike == null) return '';
  if (typeof teamLike === 'string' || typeof teamLike === 'number') {
    return String(teamLike).trim().toLowerCase();
  }

  const candidateFields = ['teamId','id','teamName','teamname','name','fullName','shortName','teamSName','sName'];
  for (const field of candidateFields) {
    const value = teamLike[field];
    if (value != null && String(value).trim() !== '') {
      return String(value).trim().toLowerCase();
    }
  }

  const fallback = teamDisplayName(teamLike);
  return String(fallback).trim().toLowerCase();
};

const alignIncomingTeams = (currentMatch = {}, incomingMatch = {}) => {
  if (!currentMatch || Object.keys(currentMatch).length === 0) return incomingMatch;
  if (!incomingMatch || Object.keys(incomingMatch).length === 0) return incomingMatch;

  const currentTeam1Token = normalizeTeamToken(currentMatch.team1);
  const currentTeam2Token = normalizeTeamToken(currentMatch.team2);
  if (!currentTeam1Token || !currentTeam2Token) return incomingMatch;

  const incomingTeam1Token = normalizeTeamToken(incomingMatch.team1);
  const incomingTeam2Token = normalizeTeamToken(incomingMatch.team2);
  if (!incomingTeam1Token || !incomingTeam2Token) return incomingMatch;

  if (incomingTeam1Token === currentTeam2Token && incomingTeam2Token === currentTeam1Token) {
    return {
      ...incomingMatch,
      team1: incomingMatch.team2,
      team2: incomingMatch.team1
    };
  }

  return incomingMatch;
};

const oversToBalls = (overs) => {
  if (overs == null) return 0;
  const parts = String(overs).split('.');
  const ov = parseInt(parts[0] || '0', 10);
  const balls = parseInt(parts[1] || '0', 10);
  if (Number.isNaN(ov) || Number.isNaN(balls)) return 0;
  return (ov * 6) + balls;
};

const extractNumericValue = (value) => {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isNaN(num) ? null : num;
};

const preferNonDecreasingNumericString = (previous, incoming) => {
  const hasIncoming = incoming != null && String(incoming).trim() !== '';
  const hasPrevious = previous != null && String(previous).trim() !== '';

  if (!hasIncoming) return hasPrevious ? previous : incoming ?? previous ?? '';
  if (!hasPrevious) return String(incoming);

  const prevNum = extractNumericValue(previous);
  const incomingNum = extractNumericValue(incoming);

  if (prevNum != null && incomingNum != null && incomingNum < prevNum) {
    return previous;
  }

  return String(incoming);
};

const preferNonDecreasingOvers = (previous, incoming) => {
  const hasIncoming = incoming != null && String(incoming).trim() !== '';
  if (!hasIncoming) return previous;
  if (previous == null || String(previous).trim() === '') return String(incoming);

  const prevBalls = oversToBalls(previous);
  const incomingBalls = oversToBalls(incoming);

  if (prevBalls > 0 && incomingBalls > 0 && incomingBalls < prevBalls) {
    return previous;
  }

  if (prevBalls > 0 && incomingBalls > 0 && incomingBalls === prevBalls) {
    return (typeof previous === 'string' && previous.trim()) ? previous : String(incoming);
  }

  return String(incoming);
};

const mergeMatchSummary = (current = {}, incoming = {}) => {
  if (!incoming || Object.keys(incoming).length === 0) return current ?? null;

  const normalizedIncoming = alignIncomingTeams(current, incoming);

  const mergeTeam = (prev = {}, next = {}) => {
    const merged = { ...(prev ?? {}), ...(next ?? {}) };

    const stabilizedScore = preferNonDecreasingNumericString(prev?.score, next?.score);
    if (stabilizedScore != null) merged.score = stabilizedScore;

    const stabilizedWickets = preferNonDecreasingNumericString(prev?.wickets, next?.wickets);
    if (stabilizedWickets != null) merged.wickets = stabilizedWickets;

    // Do not regress overs when ball count appears identical; prefer stable previous formatted string
    if (prev?.overs || next?.overs) {
      merged.overs = preferNonDecreasingOvers(prev?.overs, next?.overs);
    }

    // Stabilize team abbreviation: once we pick one, do not let later snapshots flip it
    const prevShort = prev?.shortName || prev?.teamSName || prev?.sName || null;
    const nextShort = next?.shortName || next?.teamSName || next?.sName || null;
    if (prevShort && nextShort && prevShort !== nextShort) {
      // Keep previous abbreviation
      merged.shortName = prev.shortName ?? prev.teamSName ?? prev.sName ?? prevShort;
      if (Object.prototype.hasOwnProperty.call(merged, 'teamSName')) merged.teamSName = merged.shortName;
      if (Object.prototype.hasOwnProperty.call(merged, 'sName')) merged.sName = merged.shortName;
    } else if (!prevShort && nextShort) {
      // First time we see an abbreviation, lock it in
      merged.shortName = nextShort;
    }

    // Prevent regression of rich scorecard arrays (batting / bowling)
    if (Array.isArray(prev?.battingScorecard)) {
      const nextBats = Array.isArray(next?.battingScorecard) ? next.battingScorecard : null;
      if (!nextBats || nextBats.length < prev.battingScorecard.length) {
        merged.battingScorecard = prev.battingScorecard;
      }
    }
    if (Array.isArray(prev?.bowlingScorecard)) {
      const nextBowl = Array.isArray(next?.bowlingScorecard) ? next.bowlingScorecard : null;
      if (!nextBowl || nextBowl.length < prev.bowlingScorecard.length) {
        merged.bowlingScorecard = prev.bowlingScorecard;
      }
    }

    return merged;
  };

  return {
    ...current,
    ...normalizedIncoming,
    team1: mergeTeam(current?.team1, normalizedIncoming.team1),
    team2: mergeTeam(current?.team2, normalizedIncoming.team2)
  };
};

// Sticky counts settings
const COUNTS_STICKY_TTL = 5000; // ms to keep counts sticky after an authoritative refresh

// ---------- helpers ----------
const normalizeStr = (s = '') => {
  if (s == null) return '';
  try {
    return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  } catch {
    return '';
  }
};

const formatStartTimeForKey = (m = {}) => {
  // prefer startTimeISO, then startTime, then older fields
  const raw = m.startTimeISO ?? m.startTime ?? m.startDate ?? m.start ?? m.date ?? null;
  if (raw == null) return '';
  try {
    return String(raw);
  } catch {
    return '';
  }
};

const canonicalKeyFor = (m = {}) => {
  try {
    const t1 = normalizeStr(m.team1?.name ?? m.team1Name ?? m.team1?.shortName ?? '');
    const t2 = normalizeStr(m.team2?.name ?? m.team2Name ?? m.team2?.shortName ?? '');
    const [a, b] = [t1, t2].sort();
    const series = normalizeStr(m.seriesName ?? m.series ?? m.matchSeries ?? '');
    const venue = normalizeStr(m.venue ?? m.venueName ?? m.ground ?? '');
    const start = normalizeStr(formatStartTimeForKey(m));
    return `${a}|${b}|${series}|${venue}|${start}`;
  } catch {
    return '';
  }
};

// smarter dedupe: prefer Live > Completed > Scheduled when same canonical key appears
const statusPriority = (s = '') => {
  const ss = (s || '').toLowerCase();
  if (ss.includes('live') || ss.includes('in progress') || ss.includes('inprogress') || ss.includes('toss')) return 3;
  if (ss.includes('complete') || ss.includes('completed') || ss.includes('finished') || ss.includes('won') || ss.includes('result')) return 2;
  return 1; // scheduled/preview/unknown
};

const dedupeIncomingBatch = (incoming, idAliasRef) => {
  const seenById = new Set();
  const keyToBest = new Map(); // key -> match
  const out = [];

  for (const m of (incoming || [])) {
    if (!m) continue;
    let id = String(m.id ?? '');
    // resolve alias early
    if (id && idAliasRef && idAliasRef.has(id)) {
      id = idAliasRef.get(id);
    }
    if (id && seenById.has(id)) continue;

    const key = canonicalKeyFor(m) || `id:${id}`;

    // if we already have a candidate for this key, pick the one with higher priority
    if (keyToBest.has(key)) {
      const existing = keyToBest.get(key);
      const existingPriority = statusPriority(existing.status ?? existing.state ?? '');
      const incomingPriority = statusPriority(m.status ?? m.state ?? '');
      // if incoming is stronger, replace; else keep existing
      if (incomingPriority > existingPriority) {
        keyToBest.set(key, m);
        // mark previously-seen id removed from seenById if it existed
        const prevId = String(existing.id ?? '');
        if (prevId) seenById.delete(prevId);
        if (id) seenById.add(id);
      } else {
        // keep existing; mark this incoming id as seen (so we don't add duplicates later)
        if (id) seenById.add(id);
      }
    } else {
      keyToBest.set(key, m);
      if (id) seenById.add(id);
    }
  }

  // finally produce array (preserve deterministic order by iterating keys)
  for (const [k, m] of keyToBest.entries()) {
    out.push(m);
  }
  return out;
};

const formatStartForDisplay = (m = {}) => {
  // accepts startTime (epoch ms number), startTimeISO (iso string) or older fields
  const raw = m.startTime ?? m.startTimeISO ?? m.startDate ?? m.start ?? m.date ?? null;
  if (raw == null) return null;
  // if number-like string or number
  const n = Number(raw);
  if (!Number.isNaN(n) && String(raw).match(/^\d+$/)) {
    // heuristic: if seconds -> convert
    if (n > 1e12) return new Date(n).toLocaleString();
    if (n > 1e9) return new Date(n).toLocaleString();
  }
  // try parse ISO
  const parsed = Date.parse(String(raw));
  if (!Number.isNaN(parsed)) return new Date(parsed).toLocaleString();
  // fallback: show raw string
  return String(raw);
};

// ---------- component ----------
const HomeScreen = ({ navigation }) => {
  const { theme, isDarkMode, toggleTheme } = useTheme();
  const { signOut, authLoading } = useAuth();

  const matchesMapRef = useRef(new Map()); // id -> { match, lastSeen }
  const canonicalToIdRef = useRef(new Map()); // canonicalKey -> id
  const idAliasRef = useRef(new Map()); // altId -> canonicalId (aliasing)

  useEffect(() => {
    if (cachedMatches && cachedMatches.length) {
      const now = Date.now();
      const m = new Map();
      const c2id = new Map();
      for (const mm of cachedMatches) {
        const id = String(mm.id);
        m.set(id, { match: mm, lastSeen: now });
        const key = canonicalKeyFor(mm);
        if (key) c2id.set(key, id);
      }
      matchesMapRef.current = m;
      canonicalToIdRef.current = c2id;
      // hydrate aliases from module cache if any
      if (cachedAliases && Object.keys(cachedAliases).length) {
        for (const [k, v] of Object.entries(cachedAliases)) idAliasRef.current.set(k, v);
      }
    }
  }, []);

  const [matchesArray, setMatchesArray] = useState(() => cachedMatches.slice());
  const [loading, setLoading] = useState(matchesMapRef.current.size === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(() => cachedFilter);
  const [filterLoading, setFilterLoading] = useState(false);

  const broadcastMatchesToBus = useCallback((matches = []) => {
    matches.forEach((match) => {
      if (!match || match.id == null) return;
      const { __lastSeen, ...rest } = match;
      publishMatchUpdate(rest);
    });
  }, []);

  // authoritative counts state (sticky behaviour implemented below)
  const [totalCount, setTotalCount] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);

  // refs and flags
  const intervalRef = useRef(null);
  const purgeRef = useRef(null);
  const isMountedRef = useRef(true);
  const ongoingFetchRef = useRef(false);
  const filterRef = useRef(filter);
  const filterInteractionRef = useRef(null);
  filterRef.current = filter;

  const initialLoadRunningRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const startupQuietTimerRef = useRef(null);

  const lastSnapshotRef = useRef(null);

  // counts timing refs
  const lastCountsRefreshTsRef = useRef(0);
  const countsStickyUntilRef = useRef(0);

  const buildArrayFromMap = useCallback(() => {
    const arr = Array.from(matchesMapRef.current.values()).map(v => ({ ...v.match, __lastSeen: v.lastSeen }));
    arr.sort((a, b) => {
      const aLive = (a.status === 'Live') ? 0 : 1;
      const bLive = (b.status === 'Live') ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return ((a.seriesName || '') + String(a.id)).localeCompare((b.seriesName || '') + String(b.id));
    });
    return arr;
  }, []);

  const applyIncomingMatchUpdate = useCallback((incoming) => {
    if (!incoming || incoming.id == null) return;
    const id = String(incoming.id);
    const map = matchesMapRef.current;
    if (!map.has(id)) return; // only sync items present in list

    const existing = map.get(id);
    const merged = {
      ...existing,
      match: mergeMatchSummary(existing?.match ?? {}, incoming),
    };
    merged.lastSeen = Date.now();
    map.set(id, merged);
    const arr = buildArrayFromMap();
    cachedMatches = arr.slice();
    setMatchesArray(arr);
  }, [buildArrayFromMap]);

  const purgeOldMatches = useCallback(() => {
    const now = Date.now();
    let removed = false;
    for (const [id, entry] of matchesMapRef.current.entries()) {
      if ((now - entry.lastSeen) > MATCH_NOT_SEEN_TTL) {
        matchesMapRef.current.delete(id);
        for (const [key, mappedId] of canonicalToIdRef.current.entries()) {
          if (mappedId === id) canonicalToIdRef.current.delete(key);
        }
        // remove aliases mapping to this id too
        for (const [alias, mappedId] of idAliasRef.current.entries()) {
          if (mappedId === id) idAliasRef.current.delete(alias);
        }
        removed = true;
      }
    }
    if (removed) {
      const arr = buildArrayFromMap();
      cachedMatches = arr.slice();
      setMatchesArray(arr);
      broadcastMatchesToBus(arr);
      console.debug('[HomeScreen] purgeOldMatches removed stale items, remaining:', arr.map(m => m.id));
    }
  }, [buildArrayFromMap, broadcastMatchesToBus]);

  // merge with aliases + canonical dedupe
  const mergeMatchesIntoMap = useCallback((incomingRaw) => {
    const now = Date.now();
    const map = matchesMapRef.current;
    const c2id = canonicalToIdRef.current;
    const aliases = idAliasRef.current;

    // hydrate aliases from module cache once (helps cold-start)
    if (Object.keys(cachedAliases || {}).length && aliases.size === 0) {
      for (const [k, v] of Object.entries(cachedAliases)) aliases.set(k, v);
    }

    // dedupe incoming batch (resolve aliases early)
    const incoming = Array.isArray(incomingRaw) ? dedupeIncomingBatch(incomingRaw, aliases) : [];
    if (!incoming.length) {
      console.debug('[HomeScreen] mergeMatchesIntoMap called with empty/invalid incoming after dedupe');
      return;
    }

    const createdOrUpdated = [];
    const collisions = [];

    for (const m of incoming) {
      const rawIncomingId = String(m.id ?? '');
      // resolve alias -> canonical id if present
      const resolvedIncomingId = (rawIncomingId && aliases.has(rawIncomingId)) ? aliases.get(rawIncomingId) : rawIncomingId;
      const key = canonicalKeyFor(m);

      // If canonical already mapped -> update that entry and create alias for rawIncomingId -> existingId
      if (key && c2id.has(key)) {
        const existingId = c2id.get(key);
        const entry = map.get(existingId);

        if (entry) {
          // merge fields (prefer latest fields from incoming)
          map.set(existingId, { match: mergeMatchSummary(entry.match, m), lastSeen: now });
          createdOrUpdated.push(existingId);
          // if incoming used a different id, record alias so future bursts resolve to existingId
          if (rawIncomingId && rawIncomingId !== existingId) {
            aliases.set(rawIncomingId, existingId);
            // persist alias to module cache (helps cold-start)
            try { cachedAliases[rawIncomingId] = existingId; } catch (e) { /* ignore */ }

            // If we previously created a separate entry under rawIncomingId, remove it now
            if (map.has(rawIncomingId) && rawIncomingId !== existingId) {
              map.delete(rawIncomingId);
              console.debug('[HomeScreen] mergeMatchesIntoMap removed alt entry for incomingId ->', rawIncomingId);
            }

            collisions.push({ key, existingId, incomingId: rawIncomingId });
          }
          continue;
        } else {
          // mapping existed but entry missing - set under resolved id
          const idToUse = resolvedIncomingId || rawIncomingId || `tmp-${Math.random().toString(36).slice(2,9)}`;
          map.set(idToUse, { match: m, lastSeen: now });
          c2id.set(key, idToUse);
          if (rawIncomingId && rawIncomingId !== idToUse) {
            aliases.set(rawIncomingId, idToUse);
            try { cachedAliases[rawIncomingId] = idToUse; } catch (e) {}
          }
          createdOrUpdated.push(idToUse);
          continue;
        }
      }

      // No canonical mapping yet.
      // If resolvedIncomingId already exists in map, update it and set canonical mapping
      if (resolvedIncomingId && map.has(resolvedIncomingId)) {
        const prev = map.get(resolvedIncomingId);
        map.set(resolvedIncomingId, { match: mergeMatchSummary(prev.match, m), lastSeen: now });
        createdOrUpdated.push(resolvedIncomingId);
        if (key) c2id.set(key, resolvedIncomingId);
        continue;
      }

      // Insert new entry under resolvedIncomingId or new id
      const idToUse = resolvedIncomingId || rawIncomingId || `tmp-${Math.random().toString(36).slice(2,9)}`;
      map.set(idToUse, { match: m, lastSeen: now });
      if (key) c2id.set(key, idToUse);
      // if incoming had a different id (rare here) record alias
      if (rawIncomingId && rawIncomingId !== idToUse) {
        aliases.set(rawIncomingId, idToUse);
        try { cachedAliases[rawIncomingId] = idToUse; } catch (e) {}
      }
      createdOrUpdated.push(idToUse);
    }

    // persist + set state
    const arr = buildArrayFromMap();
    cachedMatches = arr.slice();
    matchesMapRef.current = map;
    canonicalToIdRef.current = c2id;
    idAliasRef.current = aliases;
    setMatchesArray(arr);

    console.debug('[HomeScreen] mergeMatchesIntoMap merged ids (incoming count):', incomingRaw.length,
      ' deduped:', incoming.length,
      ' createdOrUpdated:', createdOrUpdated.length,
      createdOrUpdated.slice(0, 120));
    if (collisions.length) {
      console.debug('[HomeScreen] mergeMatchesIntoMap canonical collisions (and aliases made):', collisions.slice(0,20));
    }

    // startup buffering quiet-window update
    if (initialLoadRunningRef.current && !initialLoadDoneRef.current) {
      if (startupQuietTimerRef.current) clearTimeout(startupQuietTimerRef.current);
      startupQuietTimerRef.current = setTimeout(() => {
        initialLoadDoneRef.current = true;
        initialLoadRunningRef.current = false;
        console.debug('[HomeScreen] startup quiet window elapsed — marking initial load done');
      }, STARTUP_QUIET_WINDOW_MS);
    }

    // After merges, force a counts refresh so UI counts reflect newly merged items immediately
    // We run it in an async IIFE so we don't need to change mergeMatchesIntoMap's signature.
    (async () => {
      try {
        await refreshCounts({ force: true });
      } catch (e) {
        console.warn('[HomeScreen] refreshCounts (forced) after merge failed', e);
      }
    })();
  }, [buildArrayFromMap]);

  // ----- authoritative count refresh with sticky TTL -----
  const refreshCounts = useCallback(async ({ force = false } = {}) => {
    try {
      const now = Date.now();
      // avoid too frequent refreshes unless forced
      if (!force && (now - lastCountsRefreshTsRef.current) < 1500) {
        console.debug('[HomeScreen] refreshCounts: skipping because refreshed recently');
        return;
      }

      console.debug('[HomeScreen] refreshCounts: fetching live/upcoming/recent snapshots for tab counts');
      const [liveRes, upRes, recentRes] = await Promise.allSettled([
        fetchMatches('live'),
        fetchMatches('upcoming'),
        fetchMatches('recent')
      ]);

      const live = (liveRes.status === 'fulfilled' && Array.isArray(liveRes.value)) ? liveRes.value : [];
      const upcoming = (upRes.status === 'fulfilled' && Array.isArray(upRes.value)) ? upRes.value : [];
      const recent = (recentRes.status === 'fulfilled' && Array.isArray(recentRes.value)) ? recentRes.value : [];

      const uniqueById = new Map();
      (live || []).forEach(m => { if (m && m.id) uniqueById.set(String(m.id), m); });
      (upcoming || []).forEach(m => { if (m && m.id) uniqueById.set(String(m.id), m); });
      (recent || []).forEach(m => { if (m && m.id) uniqueById.set(String(m.id), m); });

      const total = uniqueById.size;
      const liveC = (live || []).filter(m => (m && m.status === 'Live')).length;
      const upcomingC = (upcoming || []).filter(m => (m && (m.status === 'Scheduled' || m.status === 'Upcoming'))).length;
      const completedC = (recent || []).filter(m => (m && m.status === 'Completed')).length;

      // If counts are sticky and not forced, skip updating UI counts
      if (!force && countsStickyUntilRef.current > Date.now()) {
        console.debug('[HomeScreen] refreshCounts: counts sticky until', countsStickyUntilRef.current, ' - skipping update');
        lastCountsRefreshTsRef.current = Date.now();
        return;
      }

      if (isMountedRef.current) {
        setTotalCount(total);
        setLiveCount(liveC);
        setUpcomingCount(upcomingC);
        setCompletedCount(completedC);
        lastCountsRefreshTsRef.current = Date.now();
        countsStickyUntilRef.current = Date.now() + COUNTS_STICKY_TTL;
        console.debug('[HomeScreen] refreshCounts done:', { total, liveC, upcomingC, completedC });
      }
    } catch (err) {
      console.warn('[HomeScreen] refreshCounts error', err);
    }
  }, []);

  const loadMatches = useCallback(async (showLoader = true) => {
    if (initialLoadRunningRef.current && !initialLoadDoneRef.current) {
      console.debug('[HomeScreen] skipping loadMatches because initial load buffering is running');
      return;
    }
    if (ongoingFetchRef.current) return;
    ongoingFetchRef.current = true;

    try {
      if (showLoader) {
        setLoading(true);
        setError(null);
      }

      let fetched = [];

      // ---- SPECIAL CASE: "all" -> fetch live+upcoming+recent and populate full UI list ----
      if (filterRef.current === 'all') {
        const [liveRes, upcomingRes, recentRes] = await Promise.allSettled([
          fetchMatches('live'),
          fetchMatches('upcoming'),
          fetchMatches('recent')
        ]);
        const live = (liveRes.status === 'fulfilled' && Array.isArray(liveRes.value)) ? liveRes.value : [];
        const upcoming = (upcomingRes.status === 'fulfilled' && Array.isArray(upcomingRes.value)) ? upcomingRes.value : [];
        const recent = (recentRes.status === 'fulfilled' && Array.isArray(recentRes.value)) ? recentRes.value : [];

        const arrs = [...(live || []), ...(upcoming || []), ...(recent || [])];

        // dedupe by id (prefer id) and canonical key otherwise; prefer higher priority statuses
        const seenById = new Map();       // id -> match
        const seenByCanonical = new Map();// canonicalKey -> { idKey, match }

        for (const m of arrs) {
          if (!m) continue;
          const id = (m.id != null) ? String(m.id) : null;
          const key = canonicalKeyFor(m) || null;

          if (id) {
            if (seenById.has(id)) {
              const existing = seenById.get(id);
              if (statusPriority(m.status) > statusPriority(existing.status)) {
                seenById.set(id, m);
              }
            } else {
              seenById.set(id, m);
            }
            if (key) {
              const prev = seenByCanonical.get(key);
              if (!prev) {
                seenByCanonical.set(key, { idKey: id, match: m });
              } else {
                if (statusPriority(m.status) > statusPriority(prev.match.status)) {
                  seenByCanonical.set(key, { idKey: id, match: m });
                }
              }
            }
            continue;
          }

          // no id
          if (key) {
            if (!seenByCanonical.has(key)) {
              seenByCanonical.set(key, { idKey: null, match: m });
            } else {
              const prev = seenByCanonical.get(key);
              if (statusPriority(m.status) > statusPriority(prev.match.status)) {
                seenByCanonical.set(key, { idKey: null, match: m });
              }
            }
          } else {
            // fallback pseudo-key
            const pseudo = JSON.stringify(m).slice(0, 200);
            if (!seenByCanonical.has(pseudo)) seenByCanonical.set(pseudo, { idKey: null, match: m });
            else {
              const prev = seenByCanonical.get(pseudo);
              if (statusPriority(m.status) > statusPriority(prev.match.status)) {
                seenByCanonical.set(pseudo, { idKey: null, match: m });
              }
            }
          }
        }

        // Build finalList: include all id-backed matches, then canonical-only ones not covered by id
        const finalList = [];
        const idsIncluded = new Set();
        for (const [id, m] of seenById.entries()) {
          finalList.push(m);
          idsIncluded.add(id);
        }
        for (const [ck, obj] of seenByCanonical.entries()) {
          if (obj.idKey && idsIncluded.has(obj.idKey)) continue;
          finalList.push(obj.match);
        }

        // Sort: live first, then completed, then scheduled, stable fallback
        finalList.sort((a, b) => {
          const pa = statusPriority(a.status), pb = statusPriority(b.status);
          if (pa !== pb) return pb - pa; // higher priority first (live)
          // fallback by seriesName + id for stability
          const sa = (a.seriesName || '') + String(a.id ?? '');
          const sb = (b.seriesName || '') + String(b.id ?? '');
          return sa.localeCompare(sb);
        });

        // Replace map contents with these so UI shows full list
        const newMap = new Map();
        const newC2id = canonicalToIdRef.current || new Map();
        const newAliases = idAliasRef.current || new Map();
        const now = Date.now();

        for (const m of finalList) {
          const idToUse = (m.id != null) ? String(m.id) : `tmp-${Math.random().toString(36).slice(2,9)}`;
          newMap.set(idToUse, { match: m, lastSeen: now });

          const key = canonicalKeyFor(m);
          if (key) {
            newC2id.set(key, idToUse);
            // if the object has an altId property, register alias (best-effort)
            if (m.altId && !newAliases.has(m.altId)) {
              newAliases.set(m.altId, idToUse);
              try { cachedAliases[m.altId] = idToUse; } catch (e) {}
            }
          }
        }

        // Persist and set UI
        matchesMapRef.current = newMap;
        canonicalToIdRef.current = newC2id;
        idAliasRef.current = newAliases;
        const arrForUI = Array.from(newMap.values()).map(v => ({ ...v.match, __lastSeen: v.lastSeen }));
        cachedMatches = arrForUI.slice();
        setMatchesArray(arrForUI);
        broadcastMatchesToBus(arrForUI);

        fetched = finalList.slice();
      }
      // ---- END special "all" handling ----

      else if (filterRef.current === 'live') {
        const data = await fetchMatches('live');
        fetched = Array.isArray(data) ? data : [];
      } else if (filterRef.current === 'completed') {
        const data = await fetchMatches('recent');
        fetched = Array.isArray(data) ? data : [];
      } else if (filterRef.current === 'scheduled' || filterRef.current === 'upcoming') {
        const data = await fetchMatches('upcoming');
        fetched = Array.isArray(data) ? data : [];
      } else {
        const data = await fetchMatches('live');
        fetched = Array.isArray(data) ? data : [];
      }

      // If not the special "all" branch we still merge normally
      if (!(filterRef.current === 'all')) {
        if (fetched.length > 0) mergeMatchesIntoMap(fetched);
        else console.debug('[HomeScreen] loadMatches fetched empty result (kept existing map)');
      }

      setError(null);
    } catch (err) {
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to load matches');
        console.warn('[HomeScreen] loadMatches error:', err);
      }
    } finally {
      ongoingFetchRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [mergeMatchesIntoMap, broadcastMatchesToBus]);

  const initialLoad = useCallback(async () => {
    if (initialLoadDoneRef.current || initialLoadRunningRef.current) return;
    initialLoadRunningRef.current = true;
    ongoingFetchRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const liveP = fetchMatches('live').then(res => Array.isArray(res) ? res : []).catch(() => []);
      const upP = fetchMatches('upcoming').then(res => Array.isArray(res) ? res : []).catch(() => []);
      const recentP = fetchMatches('recent').then(res => Array.isArray(res) ? res : []).catch(() => []);

      const [live, upcoming, recent] = await Promise.all([liveP, upP, recentP]);

      // Combine and use same logic as the "all" branch to populate full map initially
      const combinedArrs = [...(live || []), ...(upcoming || []), ...(recent || [])];

      // dedupe & pick best by id/canonical, similar to loadMatches "all" logic
      const seenById = new Map();
      const seenByCanonical = new Map();

      for (const m of combinedArrs) {
        if (!m) continue;
        const id = (m.id != null) ? String(m.id) : null;
        const key = canonicalKeyFor(m) || null;

        if (id) {
          if (seenById.has(id)) {
            const existing = seenById.get(id);
            if (statusPriority(m.status) > statusPriority(existing.status)) {
              seenById.set(id, m);
            }
          } else {
            seenById.set(id, m);
          }
          if (key) {
            const prev = seenByCanonical.get(key);
            if (!prev) {
              seenByCanonical.set(key, { idKey: id, match: m });
            } else {
              if (statusPriority(m.status) > statusPriority(prev.match.status)) {
                seenByCanonical.set(key, { idKey: id, match: m });
              }
            }
          }
          continue;
        }

        if (key) {
          if (!seenByCanonical.has(key)) {
            seenByCanonical.set(key, { idKey: null, match: m });
          } else {
            const prev = seenByCanonical.get(key);
            if (statusPriority(m.status) > statusPriority(prev.match.status)) {
              seenByCanonical.set(key, { idKey: null, match: m });
            }
          }
        } else {
          const pseudo = JSON.stringify(m).slice(0, 200);
          if (!seenByCanonical.has(pseudo)) seenByCanonical.set(pseudo, { idKey: null, match: m });
          else {
            const prev = seenByCanonical.get(pseudo);
            if (statusPriority(m.status) > statusPriority(prev.match.status)) {
              seenByCanonical.set(pseudo, { idKey: null, match: m });
            }
          }
        }
      }

      const finalList = [];
      const idsIncluded = new Set();
      for (const [id, m] of seenById.entries()) {
        finalList.push(m);
        idsIncluded.add(id);
      }
      for (const [ck, obj] of seenByCanonical.entries()) {
        if (obj.idKey && idsIncluded.has(obj.idKey)) continue;
        finalList.push(obj.match);
      }

      finalList.sort((a, b) => {
        const pa = statusPriority(a.status), pb = statusPriority(b.status);
        if (pa !== pb) return pb - pa;
        const sa = (a.seriesName || '') + String(a.id ?? '');
        const sb = (b.seriesName || '') + String(b.id ?? '');
        return sa.localeCompare(sb);
      });

      if (finalList.length > 0) {
        // populate map same as loadMatches 'all'
        const newMap = new Map();
        const newC2id = canonicalToIdRef.current || new Map();
        const newAliases = idAliasRef.current || new Map();
        const now = Date.now();

        for (const m of finalList) {
          const idToUse = (m.id != null) ? String(m.id) : `tmp-${Math.random().toString(36).slice(2,9)}`;
          newMap.set(idToUse, { match: m, lastSeen: now });

          const key = canonicalKeyFor(m);
          if (key) {
            newC2id.set(key, idToUse);
            if (m.altId && !newAliases.has(m.altId)) {
              newAliases.set(m.altId, idToUse);
              try { cachedAliases[m.altId] = idToUse; } catch (e) {}
            }
          }
        }

        matchesMapRef.current = newMap;
        canonicalToIdRef.current = newC2id;
        idAliasRef.current = newAliases;
        const arrForUI = Array.from(newMap.values()).map(v => ({ ...v.match, __lastSeen: v.lastSeen }));
        cachedMatches = arrForUI.slice();
        setMatchesArray(arrForUI);
      } else {
        console.debug('[HomeScreen] initialLoad fetched no matches; leaving cache as-is.');
      }

      if (startupQuietTimerRef.current) clearTimeout(startupQuietTimerRef.current);
      startupQuietTimerRef.current = setTimeout(() => {
        initialLoadDoneRef.current = true;
        initialLoadRunningRef.current = false;
        console.debug('[HomeScreen] startup quiet window elapsed (post initial merge) — initialLoadDone = true');
      }, STARTUP_QUIET_WINDOW_MS);

      // Refresh counts immediately after initial load (force to ensure UI reflects authoritative snapshot)
      await refreshCounts({ force: true });

      console.debug('[HomeScreen] initialLoad merged count:', finalList.length);
    } catch (err) {
      console.warn('[HomeScreen] initialLoad failed', err);
      setError(err?.message || 'Initial load failed');
      initialLoadDoneRef.current = true;
      initialLoadRunningRef.current = false;
    } finally {
      ongoingFetchRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }, [mergeMatchesIntoMap, refreshCounts, broadcastMatchesToBus]);

  useEffect(() => {
    isMountedRef.current = true;
    const unsubscribe = subscribeToMatchUpdates(applyIncomingMatchUpdate, { replay: true });
    initialLoad();

    intervalRef.current = setInterval(() => {
      if (!initialLoadRunningRef.current || initialLoadDoneRef.current) loadMatches(false);
    }, 30000);

    purgeRef.current = setInterval(() => purgeOldMatches(), PURGE_INTERVAL_MS);

    const focusUnsub = navigation.addListener('focus', () => {
      try {
        const prev = lastSnapshotRef.current;
        const nowArr = Array.from(matchesMapRef.current.keys());
        if (prev) {
          const added = nowArr.filter(id => !prev.includes(id));
          const removed = prev.filter(id => !nowArr.includes(id));
          if (added.length || removed.length) {
            console.debug('[HomeScreen] snapshot diff after focus: added:', added, ' removed:', removed);
          } else {
            console.debug('[HomeScreen] snapshot diff after focus: no change');
          }
        } else {
          console.debug('[HomeScreen] focus: no prior snapshot available');
        }
        lastSnapshotRef.current = null;
      } catch (e) { console.warn('[HomeScreen] snapshot compare failed', e); }

      loadMatches(false);
      refreshCounts({ force: true }).catch((err) => console.warn('[HomeScreen] focus refresh failed', err));
    });

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (purgeRef.current) clearInterval(purgeRef.current);
      if (startupQuietTimerRef.current) clearTimeout(startupQuietTimerRef.current);
      if (focusUnsub && typeof focusUnsub === 'function') focusUnsub();
      if (unsubscribe) unsubscribe();
    };
  }, [initialLoad, loadMatches, purgeOldMatches, navigation, applyIncomingMatchUpdate, refreshCounts]);

  useEffect(() => {
    filterRef.current = filter;

    if (!initialLoadDoneRef.current) {
      initialLoad();
      return () => {};
    }

    // cancel any pending work from previous filter change
    if (filterInteractionRef.current) {
      filterInteractionRef.current.cancel();
      filterInteractionRef.current = null;
    }

    let cancelled = false;
    if (isMountedRef.current) setFilterLoading(true);

    const runAsync = async () => {
      try {
        // Prefer cached matches – only trigger network when leaving "all"
        if (filterRef.current !== 'all') {
          await loadMatches(false);
        }
        await refreshCounts();
      } catch (e) {
        console.warn('[HomeScreen] filter change load failed', e);
      } finally {
        if (!cancelled && isMountedRef.current) setFilterLoading(false);
      }
    };

    filterInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      runAsync().finally(() => {
        filterInteractionRef.current = null;
      });
    });

    return () => {
      cancelled = true;
      if (filterInteractionRef.current) {
        filterInteractionRef.current.cancel();
        filterInteractionRef.current = null;
      }
      if (isMountedRef.current) setFilterLoading(false);
    };
  }, [filter, initialLoad, loadMatches, refreshCounts]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadMatches(false);
    // user triggered refresh -> force counts update
    refreshCounts({ force: true }).catch((e) => console.warn('[HomeScreen] refreshCounts on manual refresh failed', e));
  }, [loadMatches, refreshCounts]);

  const handleMatchPress = useCallback((match) => {
    if (!match) return;
    const matchId = match.id;
    try {
      const snapshot = Array.from(matchesMapRef.current.keys());
      lastSnapshotRef.current = snapshot;
      console.debug('[HomeScreen] storing snapshot before navigation (count):', snapshot.length);
    } catch (e) { /* ignore */ }

    navigation.navigate('MatchDetails', { matchId, matchSnapshot: match });
  }, [navigation]);

  const filteredMatches = useMemo(() => {
    return matchesArray.filter((match) => {
      if (filter === 'all') return true;
      if (filter === 'live') return match.status === 'Live';
      if (filter === 'completed') return match.status === 'Completed';
      if (filter === 'scheduled' || filter === 'upcoming') {
        return match.status === 'Scheduled' || match.status === 'Upcoming';
      }
      return true;
    });
  }, [filter, matchesArray]);

  const mapValues = Array.from(matchesMapRef.current.values()).map(v => v.match);
  // Note: we now display authoritative sticky counts (state) instead of deriving counts directly from the map for tab labels
  const displayTotal = totalCount;
  const displayLive = liveCount;
  const displayCompleted = completedCount;
  const displayUpcoming = upcomingCount;

  const renderMatchCard = ({ item }) => {
    const isLive = item.status === 'Live';
    const isCompleted = item.status === 'Completed';
    const displayStart = formatStartForDisplay(item); // null or formatted string

    return (
      <TouchableOpacity
        onPress={() => handleMatchPress(item)}
        activeOpacity={0.7}
        style={[
          styles.matchCard,
          {
            backgroundColor: theme.surface,
            borderColor: isLive ? '#FF3B30' : theme.border,
            borderWidth: isLive ? 2 : 1
          }
        ]}
      >
        {item.seriesName && (
          <Text style={[styles.seriesName, { color: theme.textSecondary }]}>
            {item.seriesName}
          </Text>
        )}

        <View style={styles.teamsContainer}>
          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <Text style={styles.teamFlag}>{item.team1.flag}</Text>
              <Text style={[styles.teamName, { color: theme.text }]} numberOfLines={1}>
                {item.team1.name}
              </Text>
            </View>
            <View style={styles.scoreContainer}>
              <Text style={[styles.teamScore, { color: theme.text }]}>
                {item.team1.score}/{item.team1.wickets}
              </Text>
              {item.team1.overs && item.team1.overs !== '0.0' && (
                <Text style={[styles.overs, { color: theme.textSecondary }]}>
                  {' '}({item.team1.overs})
                </Text>
              )}
            </View>
          </View>

          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <Text style={styles.teamFlag}>{item.team2.flag}</Text>
              <Text style={[styles.teamName, { color: theme.text }]} numberOfLines={1}>
                {item.team2.name}
              </Text>
            </View>
            <View style={styles.scoreContainer}>
              <Text style={[styles.teamScore, { color: theme.text }]}>
                {item.team2.score}/{item.team2.wickets}
              </Text>
              {item.team2.overs && item.team2.overs !== '0.0' && (
                <Text style={[styles.overs, { color: theme.textSecondary }]}>
                  {' '}({item.team2.overs})
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.matchInfoRow}>
          <View style={[styles.typeTag, { backgroundColor: theme.primary + '20' }]}>
            <Text style={[styles.typeText, { color: theme.primary }]}>{item.type}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: item.status === 'Live' ? '#FF3B30' : '#8E8E93' }]}>
            {isLive && <Icon name="fiber-manual-record" size={10} color="#FFFFFF" style={{ marginRight: 4 }} />}
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>

        {item.toss && (
          <View style={styles.tossRow}>
            <Icon name="info" size={14} color={theme.textSecondary} style={{ marginRight: 4 }} />
            <Text style={[styles.tossText, { color: theme.textSecondary }]} numberOfLines={2}>
              {item.toss}
            </Text>
          </View>
        )}

        {item.venue && (
          <View style={styles.venueRow}>
            <Icon name="location-on" size={14} color={theme.textSecondary} />
            <Text style={[styles.venueText, { color: theme.textSecondary }]} numberOfLines={1}>
              {item.venue}
            </Text>
          </View>
        )}

        {/* start time / date display */}
        {displayStart && (
          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="schedule" size={14} color={theme.textSecondary} style={{ marginRight: 4 }} />
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{displayStart}</Text>
          </View>
        )}

        {isCompleted && item.result && (
          <View style={styles.resultRow}>
            <Icon name="emoji-events" size={16} color="#2E7D32" />
            <Text style={styles.resultText} numberOfLines={2}>
              {item.result}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const styles = createStyles(theme);

  if (loading && mapValues.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="sports-cricket" size={22} color={theme.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.headerTitle, { color: theme.text }]}>Live Cricket</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => initialLoad()} style={styles.refreshButton}>
              <Icon name="refresh" size={20} color={theme.primary} />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('Rankings')} style={styles.rankingsButton}>
              <Icon name="emoji-events" size={20} color={theme.text} />
            </TouchableOpacity>

            <TouchableOpacity onPress={toggleTheme} style={styles.themeToggle}>
              <Icon
                name={isDarkMode ? 'light-mode' : 'dark-mode'}
                size={20}
                color={theme.text}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>
            Loading matches...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="sports-cricket" size={22} color={theme.primary} style={{ marginRight: 8 }} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Live Cricket</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
         

          <TouchableOpacity onPress={() => navigation.navigate('Rankings')} style={styles.rankingsButton}>
            <Icon name="emoji-events" size={20} color={theme.text} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('News')}
            style={styles.rankingsButton}
          >
            <Icon name="article" size={20} color={theme.text} />
          </TouchableOpacity>

          <TouchableOpacity onPress={toggleTheme} style={styles.themeToggle}>
            <Icon
              name={isDarkMode ? 'light-mode' : 'dark-mode'}
              size={20}
              color={theme.text}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => signOut().catch(() => {})}
            style={styles.logoutButton}
            disabled={authLoading}
          >
            {authLoading ? (
              <ActivityIndicator size="small" color={theme.error} />
            ) : (
              <Icon name="logout" size={20} color={theme.error} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.filterContainer}>
        <TouchableOpacity
          onPress={() => setFilter('all')}
          style={[
            styles.filterTab,
            filter === 'all' && styles.activeFilterTab,
            {
              borderColor: filter === 'all' ? theme.primary : theme.border,
              backgroundColor: filter === 'all' ? theme.primary + '10' : 'transparent'
            }
          ]}
        >
          <Text style={[styles.filterText, { color: filter === 'all' ? theme.primary : theme.text }] }>
            All ({displayTotal})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFilter('live')}
          style={[
            styles.filterTab,
            filter === 'live' && styles.activeFilterTab,
            {
              borderColor: filter === 'live' ? theme.primary : theme.border,
              backgroundColor: filter === 'live' ? theme.primary + '10' : 'transparent'
            }
          ]}
        >
          <Text style={[styles.filterText, { color: filter === 'live' ? theme.primary : theme.text }] }>
            Live ({displayLive})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFilter('completed')}
          style={[
            styles.filterTab,
            filter === 'completed' && styles.activeFilterTab,
            {
              borderColor: filter === 'completed' ? theme.primary : theme.border,
              backgroundColor: filter === 'completed' ? theme.primary + '10' : 'transparent'
            }
          ]}
        >
          <Text style={[styles.filterText, { color: filter === 'completed' ? theme.primary : theme.text }] }>
            Completed ({displayCompleted})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setFilter('scheduled')}
          style={[
            styles.filterTab,
            filter === 'scheduled' && styles.activeFilterTab,
            {
              borderColor: filter === 'scheduled' ? theme.primary : theme.border,
              backgroundColor: filter === 'scheduled' ? theme.primary + '10' : 'transparent'
            }
          ]}
        >
          <Text style={[styles.filterText, { color: filter === 'scheduled' ? theme.primary : theme.text }] }>
            Upcoming ({displayUpcoming})
          </Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠️ {error}</Text>
        </View>
      )}

      <FlatList
        data={filteredMatches}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMatchCard}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="sports-cricket" size={64} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.text }]}>{filter === 'all' ? 'No matches available' : `No ${filter} matches`}</Text>
            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>Pull down to refresh</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

// styles (same as your previous createStyles)
const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingTop: StatusBar.currentHeight || 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border, elevation: 2 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  refreshButton: { padding: 8, marginLeft: 4 },
  refreshIcon: { fontSize: 20 },
  themeToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  rankingsButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  logoutButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 16 },
  filterContainer: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, backgroundColor: theme.background, gap: 8 },
  filterTab: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  activeFilterTab: { elevation: 2 },
  filterText: { fontSize: 13, fontWeight: '600' },
  errorBanner: { backgroundColor: '#FFF3CD', padding: 12, marginHorizontal: 12, marginTop: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FFC107' },
  errorBannerText: { color: '#856404', fontSize: 13, textAlign: 'center' },
  listContent: { padding: 12 },
  matchCard: { borderRadius: 12, padding: 16, marginBottom: 12 },
  seriesName: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', fontWeight: '600' },
  teamsContainer: { marginBottom: 12 },
  teamRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  teamInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  teamFlag: { fontSize: 20, marginRight: 8 },
  teamName: { fontSize: 16, fontWeight: '600', flex: 1 },
  scoreContainer: { flexDirection: 'row', alignItems: 'baseline' },
  teamScore: { fontSize: 18, fontWeight: '800' },
  tossRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center' },
  tossText: { fontSize: 12, flex: 1 },
  overs: { fontSize: 14, fontWeight: '400' },
  matchInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  typeText: { fontSize: 11, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  liveDot: { fontSize: 8 },
  statusText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  venueRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  venueIcon: { fontSize: 12 },
  venueText: { marginLeft: 6, fontSize: 13, flex: 1 },
  resultRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: '#E8F5E9', padding: 8, borderRadius: 6 },
  resultIcon: { fontSize: 16 },
  resultText: { marginLeft: 6, fontSize: 13, fontWeight: '600', color: '#2E7D32', flex: 1 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyText: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySubtext: { fontSize: 14 },
});

export default HomeScreen;
