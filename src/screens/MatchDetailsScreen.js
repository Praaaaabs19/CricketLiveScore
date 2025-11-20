// src/screens/MatchDetailsScreen.js
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../context/ThemeContext';
import { fetchMatchDetails } from '../services/api';
import { subscribeToMatchUpdates } from '../state/matchUpdateBus';
import ScoreCard from './ScoreCard';

// defensive UI helper
const displayName = (n) => {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  if (typeof n === 'number') return String(n);
  const tryFields = ['teamName','teamname','name','fullName','shortName','teamsname','teamSName','sName'];
  for (const f of tryFields) {
    if (n[f]) return String(n[f]);
  }
  try {
    const s = JSON.stringify(n);
    return s.length > 40 ? s.slice(0,37) + '...' : s;
  } catch {
    return '[Team]';
  }
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

  const fallback = displayName(teamLike);
  return fallback.trim().toLowerCase();
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

    if (prev?.overs || next?.overs) {
      merged.overs = preferNonDecreasingOvers(prev?.overs, next?.overs);
    }

    // Stabilize team abbreviation: once chosen, don't let later snapshots flip it
    const prevShort = prev?.shortName || prev?.teamSName || prev?.sName || null;
    const nextShort = next?.shortName || next?.teamSName || next?.sName || null;
    if (prevShort && nextShort && prevShort !== nextShort) {
      merged.shortName = prev.shortName ?? prev.teamSName ?? prev.sName ?? prevShort;
      if (Object.prototype.hasOwnProperty.call(merged, 'teamSName')) merged.teamSName = merged.shortName;
      if (Object.prototype.hasOwnProperty.call(merged, 'sName')) merged.sName = merged.shortName;
    } else if (!prevShort && nextShort) {
      merged.shortName = nextShort;
    }

    // Preserve rich arrays and prevent regression to shorter/older scorecards
    if (Array.isArray(prev?.battingScorecard)) {
      const nextBats = Array.isArray(next?.battingScorecard) ? next.battingScorecard : undefined;
      if (!nextBats || nextBats.length < prev.battingScorecard.length) {
        merged.battingScorecard = prev.battingScorecard;
      }
    }
    if (Array.isArray(prev?.bowlingScorecard)) {
      const nextBowl = Array.isArray(next?.bowlingScorecard) ? next.bowlingScorecard : undefined;
      if (!nextBowl || nextBowl.length < prev.bowlingScorecard.length) {
        merged.bowlingScorecard = prev.bowlingScorecard;
      }
    }

    const prevExtrasTotal = prev?.extras?.total;
    const nextExtrasTotal = next?.extras?.total;
    if (prevExtrasTotal != null || nextExtrasTotal != null) {
      const stabilizedExtrasTotal = preferNonDecreasingNumericString(prevExtrasTotal, nextExtrasTotal);
      if (stabilizedExtrasTotal != null && String(stabilizedExtrasTotal).trim() !== '') {
        merged.extras = {
          ...(prev?.extras || {}),
          ...(next?.extras || {}),
          total: stabilizedExtrasTotal
        };
      }
    }

    return merged;
  };

  const merged = { ...current }; // shallow copy

  Object.entries(normalizedIncoming).forEach(([key, value]) => {
    if (key === 'team1' || key === 'team2') {
      merged[key] = mergeTeam(current?.[key], value);
      return;
    }

    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return;
    }

    if (key === 'type') {
      const incomingType = String(value).trim();
      if (!incomingType) return;
      const prevType = typeof current?.type === 'string' ? current.type.trim() : '';
      // avoid downgrading from specific formats like "ODI/T20/Test" to generic "Match"
      if (prevType && /^match$/i.test(incomingType)) {
        return;
      }
      merged.type = incomingType;
      return;
    }

    if (key === 'toss') {
      const incomingToss = String(value).trim();
      if (!incomingToss) return;
      const prevToss = typeof current?.toss === 'string' ? current.toss.trim() : '';
      if (!prevToss) {
        merged.toss = incomingToss;
        return;
      }

      const incomingLower = incomingToss.toLowerCase();
      const prevLower = prevToss.toLowerCase();

      // Prefer the more informative string when one is a superset of the other
      if (incomingToss.length < prevToss.length && prevLower.includes(incomingLower)) {
        merged.toss = prevToss;
        return;
      }
      if (incomingToss.length > prevToss.length && incomingLower.includes(prevLower)) {
        merged.toss = incomingToss;
        return;
      }

      merged.toss = incomingToss;
      return;
    }

    merged[key] = value;
  });

  return merged;
};

const MatchDetailsScreen = ({ route, navigation }) => {
  const { matchId, matchSnapshot } = route.params || {};
  const { theme, isDarkMode } = useTheme();

  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const intervalRef = useRef(null);
  const isMountedRef = useRef(true);
  const matchRef = useRef(null);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const loadMatchDetails = useCallback(async (showLoader = true, { force = false } = {}) => {
    try {
      if (showLoader) {
        setLoading(true);
        setError(null);
      }
      const data = await fetchMatchDetails(matchId, { force });
      if (isMountedRef.current) {
        if (data) {
          setMatch((prev) => mergeMatchSummary(prev, data));
          setError(null);
        } else {
          throw new Error('No match data received');
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        const errorMessage = err?.message || 'Failed to load match details';
        setError(errorMessage);
        if (showLoader && !matchRef.current) {
          Alert.alert('Error', errorMessage, [
            { text: 'Retry', onPress: () => loadMatchDetails(true) },
            { text: 'Go Back', onPress: () => navigation.goBack() }
          ]);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [matchId, navigation]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!matchId) {
      setError('No match ID provided');
      setLoading(false);
      Alert.alert('Error', 'No match ID provided', [
        { text: 'Go Back', onPress: () => navigation.goBack() }
      ]);
      return;
    }

    // seed with snapshot if provided (prevents score flicker)
    if (matchSnapshot) {
      setMatch((prev) => mergeMatchSummary(prev, matchSnapshot));
      setLoading(false);
    } else {
      setLoading(true);
    }

    // initial load (use cache by default)
    loadMatchDetails(!matchSnapshot, { force: false });

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [matchId, matchSnapshot, loadMatchDetails, navigation]);

  useEffect(() => {
    if (!matchId) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (match?.status !== 'Live') return;

    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        loadMatchDetails(false);
      }
    }, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [matchId, match?.status, loadMatchDetails]);

  useEffect(() => {
    const idStr = matchId != null ? String(matchId) : null;
    if (!idStr) return () => {};

    const unsubscribe = subscribeToMatchUpdates((update) => {
      if (!update) return;
      const updateId = update.id != null ? String(update.id) : null;
      if (!updateId) return;
      if (updateId !== idStr) return;

      setMatch((prev) => mergeMatchSummary(prev, update));
    }, { replay: true });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [matchId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // user explicitly pulled to refresh: bypass cache
    loadMatchDetails(false, { force: true });
  }, [loadMatchDetails]);

  const handleManualReload = useCallback(() => {
    // header refresh button: also bypass cache
    loadMatchDetails(true, { force: true });
  }, [loadMatchDetails]);

  const styles = createStyles(theme);

  if (loading && !match) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Icon name="arrow-back" style={styles.backIcon} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Match Details</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>
            Loading match details...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !match) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Match Details</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={handleManualReload} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.retryButton, styles.backButtonAlt]}>
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!match) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Match Details</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.centerContainer}>
          <Text style={[styles.noDataText, { color: theme.text }]}>No match data available</Text>
        </View>
      </SafeAreaView>
    );
  }

  // extract data with defensive fallback
  const team1 = match.team1 || {};
  const team2 = match.team2 || {};
  const statusLower = String(match.status || '').toLowerCase();
  const isLive = statusLower === 'live';
  const isCompleted = statusLower === 'completed';
  const isScheduled = statusLower === 'scheduled' || statusLower === 'upcoming';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-back" style={styles.backIcon} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Match Details</Text>
        <TouchableOpacity onPress={handleManualReload} style={styles.refreshButton}>
          <Icon name="refresh" style={[styles.refreshIcon, { color: theme.primary }]} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[theme.primary]} tintColor={theme.primary} />
        }
      >
        <View style={styles.matchInfoCard}>
          {match.seriesName && (<Text style={[styles.seriesName, { color: theme.textSecondary }]}>{match.seriesName}</Text>)}
          <Text style={[styles.matchTitle, { color: theme.text }]}>
            {team1.flag || '🏏'} {displayName(team1.name) || 'Team 1'} vs {team2.flag || '🏏'} {displayName(team2.name) || 'Team 2'}
          </Text>

          <View style={styles.statusRow}>
            <View style={[styles.typeTag, { backgroundColor: theme.primary + '20' }]}>
              <Text style={[styles.typeText, { color: theme.primary }]}>{match.type || 'Match'}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(match.status) }]}>
              {isLive && <Text style={styles.liveDot}>🔴 </Text>}
              <Text style={styles.statusText}>{match.status || 'Scheduled'}</Text>
            </View>
          </View>

          <View style={styles.venueRow}>
            <Text style={[styles.venueIcon, { color: theme.textSecondary }]}>📍</Text>
            <Text style={[styles.venueText, { color: theme.textSecondary }]}>
              {match.venue || 'Venue not specified'}
            </Text>
          </View>

          {/* {match.toss && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoIcon, { color: theme.textSecondary }]}>🪙</Text>
              <Text style={[styles.infoText, { color: theme.textSecondary }]}>
                {match.toss}
              </Text>
            </View>
          )} */}

          <View style={[styles.scoresContainer, { borderTopColor: theme.border }]}>
            <View style={styles.teamScoreBlock}>
              <Text style={[styles.teamName, { color: theme.text }]}>
                {team1.shortName || displayName(team1.name) || 'TM1'}
              </Text>
              <Text style={styles.teamScore}>
                {team1.score || '0'}
                {team1.wickets && team1.wickets !== '0' ? `/${team1.wickets}` : ''}
              </Text>
              {team1.overs && team1.overs !== '0.0' && (
                <Text style={[styles.teamOvers, { color: theme.textSecondary }]}>
                  {'(' + team1.overs + ' ov)'}
                </Text>
              )}
            </View>

            <Text style={[styles.vsText, { color: theme.textSecondary }]}>vs</Text>

            <View style={styles.teamScoreBlock}>
              <Text style={[styles.teamName, { color: theme.text }]}>
                {team2.shortName || displayName(team2.name) || 'TM2'}
              </Text>
              <Text style={styles.teamScore}>
                {team2.score || '0'}
                {team2.wickets && team2.wickets !== '0' ? `/${team2.wickets}` : ''}
              </Text>
              {team2.overs && team2.overs !== '0.0' && (
                <Text style={[styles.teamOvers, { color: theme.textSecondary }]}>
                  {'(' + team2.overs + ' ov)'}
                </Text>
              )}
            </View>
          </View>

          {(isLive || isCompleted) && match.result && (
            <View style={{ marginTop: 12 }}>
              <View style={styles.resultSummaryRow}>
                <Image
                  source={require('../../assets/images/coin.png')}
                  style={styles.resultSummaryIcon}
                />
                <Text style={[styles.resultSummaryText, { color: theme.text }]}>
                  {match.result}
                </Text>
              </View>
            </View>
          )}

          {isCompleted && match.result && match.resultMargin && (
            <View style={[styles.resultContainer, !match.toss && { marginTop: 12 }]}>
              <Text style={styles.resultIcon}>🏆</Text>
              <Text style={styles.resultText}>{match.resultMargin}</Text>
            </View>
          )}
        </View>

        {/* Tabs area */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Detailed Scorecard</Text>
          <ScoreCard matchId={matchId} parentMatch={match} />
        </View>

        {error && match && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              ⚠️ Unable to fetch latest data. Showing cached information.
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

// small helper for status color
const getStatusColor = (status) => {
  switch (status) {
    case 'Live': return '#FF3B30';
    case 'Completed': return '#34C759';
    case 'Scheduled': return '#007AFF';
    default: return '#8E8E93';
  }
};

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background, paddingTop: StatusBar.currentHeight || 0 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12, backgroundColor: theme.surface,
    borderBottomWidth: 1, borderBottomColor: theme.border
  },
  backButton: { padding: 8 },
  backIcon: { fontSize: 24, color: theme.text },
  headerTitle: { fontSize: 18, fontWeight: '700', color: theme.text },
  refreshButton: { padding: 8 },
  refreshIcon: { fontSize: 20 },
  placeholder: { width: 40 },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 16 },
  matchInfoCard: {
    backgroundColor: theme.surface, marginHorizontal: 12, marginTop: 12, borderRadius: 12,
    padding: 16, borderWidth: 1, borderColor: theme.border
  },
  seriesName: { fontSize: 12, marginBottom: 6, textTransform: 'uppercase', fontWeight: '600' },
  matchTitle: { fontSize: 20, fontWeight: '800', marginBottom: 12, lineHeight: 28 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  typeTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  typeText: { fontSize: 12, fontWeight: '600' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  liveDot: { fontSize: 8 },
  statusText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  venueRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  venueIcon: { fontSize: 14 },
  venueText: { marginLeft: 6, fontSize: 14, flex: 1 },
  scoresContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 12, borderTopWidth: 1 },
  teamScoreBlock: { alignItems: 'center', flex: 1 },
  teamName: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  teamScore: { fontSize: 24, fontWeight: '800', color: '#1976D2', marginBottom: 2 },
  teamOvers: { fontSize: 12 },
  vsText: { marginHorizontal: 12, fontSize: 14, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border },
  infoIcon: { fontSize: 16 },
  infoText: { marginLeft: 8, fontSize: 14, flex: 1 },
  resultContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: '#E8F5E9', padding: 12, borderRadius: 8 },
  resultIcon: { fontSize: 20 },
  resultText: { marginLeft: 8, fontWeight: '700', fontSize: 14, color: '#2E7D32', flex: 1 },
  resultSummaryRow: { flexDirection: 'row', alignItems: 'center' },
  resultSummaryIcon: { width: 20, height: 20, marginRight: 8, resizeMode: 'contain' },
  resultSummaryText: { fontSize: 14, fontWeight: '600' },
  section: { marginHorizontal: 12, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  errorBanner: { backgroundColor: '#FFF3CD', padding: 12, marginHorizontal: 12, marginTop: 16, borderRadius: 8, borderWidth: 1, borderColor: '#FFC107' },
  errorBannerText: { color: '#856404', fontSize: 14, textAlign: 'center' },
  bottomSpacer: { height: 40 },
  // small utilities
  retryButton: { backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 8 },
  backButtonAlt: { backgroundColor: '#8E8E93' },
  retryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  centerText: { fontSize: 16 }
});

export default MatchDetailsScreen;
