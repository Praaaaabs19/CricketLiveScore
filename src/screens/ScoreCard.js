// src/components/ScoreCard.js
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fetchMatchDetails } from '../services/api';

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

const areTeamScoreSummariesEqual = (a = {}, b = {}) => {
  const aScore = a.score ?? '';
  const bScore = b.score ?? '';
  const aWickets = a.wickets ?? '';
  const bWickets = b.wickets ?? '';
  const aOvers = a.overs ?? '';
  const bOvers = b.overs ?? '';
  return aScore === bScore && aWickets === bWickets && aOvers === bOvers;
};

const areMatchScoresEqual = (prev, next) => {
  if (!prev || !next) return false;
  const pStatus = prev.status ?? '';
  const nStatus = next.status ?? '';
  if (pStatus !== nStatus) return false;
  const pTeam1 = prev.team1 ?? {};
  const pTeam2 = prev.team2 ?? {};
  const nTeam1 = next.team1 ?? {};
  const nTeam2 = next.team2 ?? {};
  return (
    areTeamScoreSummariesEqual(pTeam1, nTeam1) &&
    areTeamScoreSummariesEqual(pTeam2, nTeam2)
  );
};

const ScoreCard = ({ matchId, parentMatch = null }) => {
  const { theme } = useTheme();

  const parentHasDetailedCard = !!parentMatch && (
    (Array.isArray(parentMatch?.team1?.battingScorecard) && parentMatch.team1.battingScorecard.length > 0) ||
    (Array.isArray(parentMatch?.team1?.bowlingScorecard) && parentMatch.team1.bowlingScorecard.length > 0) ||
    (Array.isArray(parentMatch?.team2?.battingScorecard) && parentMatch.team2.battingScorecard.length > 0) ||
    (Array.isArray(parentMatch?.team2?.bowlingScorecard) && parentMatch.team2.bowlingScorecard.length > 0)
  );

  const [details, setDetails] = useState(parentHasDetailedCard ? parentMatch : null);
  const [loading, setLoading] = useState(!parentHasDetailedCard);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('team1'); // 'team1' or 'team2'
  const [selectedView, setSelectedView] = useState('batting'); // 'batting' or 'bowling'

  const intervalRef = useRef(null);
  const isMountedRef = useRef(true);

  const loadScorecardDetails = useCallback(async () => {
    try {
      setLoading((prevLoading) => (details ? prevLoading : true));
      setError(null);
      const data = await fetchMatchDetails(matchId);
      if (isMountedRef.current) {
        if (data) {
          setDetails((prev) => {
            if (!prev) return data;
            if (areMatchScoresEqual(prev, data)) {
              return prev;
            }
            return data;
          });
        }
        else throw new Error('No scorecard data available');
      }
    } catch (err) {
      if (isMountedRef.current) setError(err?.message || 'Failed to load scorecard');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    isMountedRef.current = true;

    // initial load only if ScoreCard is owner of data (no detailed parentMatch)
    if (!parentHasDetailedCard && !details && matchId) {
      loadScorecardDetails();
    }

    // Only poll when this component fetched the data itself.
    if (!parentHasDetailedCard && (details?.status === 'Live') && matchId) {
      intervalRef.current = setInterval(() => {
        loadScorecardDetails();
      }, 30000);
    }

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [matchId, parentHasDetailedCard, details?.status, loadScorecardDetails]);

  useEffect(() => {
    if (parentMatch && parentHasDetailedCard) setDetails(parentMatch);
  }, [parentMatch, parentHasDetailedCard]);

  const handleTeamTabPress = useCallback((nextTab) => {
    setActiveTab((current) => (current === nextTab ? current : nextTab));
  }, []);

  const handleViewTogglePress = useCallback((nextView) => {
    setSelectedView((current) => (current === nextView ? current : nextView));
  }, []);

  const styles = createStyles(theme);

  if (loading && !details) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.text }]}>Loading scorecard...</Text>
      </View>
    );
  }

  if (error && !details) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <TouchableOpacity onPress={loadScorecardDetails} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!details) {
    return (
      <View style={styles.centerContainer}>
        <Text style={[styles.noDataText, { color: theme.textSecondary }]}>No scorecard data available</Text>
      </View>
    );
  }

  const team1 = details.team1 ?? {};
  const team2 = details.team2 ?? {};
  const activeTeam = activeTab === 'team1' ? team1 : team2;
  // Bowling figures should belong to the *opposing* team for the currently selected batting team.
  const bowlingTeam = activeTab === 'team1' ? team2 : team1;
  const hasBattingData = Array.isArray(activeTeam.battingScorecard) && activeTeam.battingScorecard.length > 0;
  const hasBowlingData = Array.isArray(bowlingTeam.bowlingScorecard) && bowlingTeam.bowlingScorecard.length > 0;

  const renderBatsmanRow = ({ item, index }) => (
    <View style={[styles.dataRow, index % 2 === 0 && { backgroundColor: theme.background }]}>
      <Text style={[styles.playerName, { color: theme.text }]} numberOfLines={1}>{item.name || 'Unknown'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.runs != null ? String(item.runs) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.balls != null ? String(item.balls) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.fours != null ? String(item.fours) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.sixes != null ? String(item.sixes) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.strikeRate != null ? String(item.strikeRate) : '0.00'}</Text>
    </View>
  );

  const renderBowlerRow = ({ item, index }) => (
    <View style={[styles.dataRow, index % 2 === 0 && { backgroundColor: theme.background }]}>
      <Text style={[styles.playerName, { color: theme.text }]} numberOfLines={1}>{item.name || 'Unknown'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.overs != null ? String(item.overs) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.maidens != null ? String(item.maidens) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.runs != null ? String(item.runs) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.wickets != null ? String(item.wickets) : '0'}</Text>
      <Text style={[styles.dataCell, { color: theme.text }]}>{item.economy != null ? String(item.economy) : '0.00'}</Text>
    </View>
  );

  // UI
  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <TouchableOpacity
          onPress={() => handleTeamTabPress('team1')}
          style={[styles.tab, activeTab === 'team1' && styles.activeTab, { borderColor: activeTab === 'team1' ? theme.primary : theme.border, backgroundColor: activeTab === 'team1' ? theme.primary + '10' : 'transparent' }]}
        >
          <Text style={[styles.tabText, { color: activeTab === 'team1' ? theme.primary : theme.text }]}>{displayName(team1.name) || 'Team 1'}</Text>
          <Text style={[styles.tabScore, { color: activeTab === 'team1' ? theme.primary : theme.text }]}>{team1.score || '0'}/{team1.wickets || '0'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleTeamTabPress('team2')}
          style={[styles.tab, activeTab === 'team2' && styles.activeTab, { borderColor: activeTab === 'team2' ? theme.primary : theme.border, backgroundColor: activeTab === 'team2' ? theme.primary + '10' : 'transparent' }]}
        >
          <Text style={[styles.tabText, { color: activeTab === 'team2' ? theme.primary : theme.text }]}>{displayName(team2.name) || 'Team 2'}</Text>
          <Text style={[styles.tabScore, { color: activeTab === 'team2' ? theme.primary : theme.text }]}>{team2.score || '0'}/{team2.wickets || '0'}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.scoreSummary, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: theme.text }]}>Score:</Text>
          <Text style={[styles.summaryValue, { color: theme.primary }]}>{activeTeam.score || '0'}/{activeTeam.wickets || '0'}{activeTeam.overs && activeTeam.overs !== '0.0' ? ` (${activeTeam.overs} ov)` : ''}</Text>
        </View>
        {activeTeam.extras && activeTeam.extras.total > 0 && (
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: theme.text }]}>Extras:</Text>
            <Text style={[styles.summaryValue, { color: theme.text }]}>{activeTeam.extras.total}</Text>
          </View>
        )}
      </View>

      <View style={[styles.viewToggleContainer, { borderColor: theme.border }]}>
        <TouchableOpacity onPress={() => handleViewTogglePress('batting')} style={[styles.viewToggle, selectedView === 'batting' && [styles.activeViewToggle, { backgroundColor: theme.primary }]]}>
          <Text style={[styles.viewToggleText, { color: selectedView === 'batting' ? '#FFFFFF' : theme.text }]}>Batting</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleViewTogglePress('bowling')} style={[styles.viewToggle, selectedView === 'bowling' && [styles.activeViewToggle, { backgroundColor: theme.primary }]]}>
          <Text style={[styles.viewToggleText, { color: selectedView === 'bowling' ? '#FFFFFF' : theme.text }]}>Bowling</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.scorecardTable}>
          {selectedView === 'batting' ? (
            <>
              <View style={[styles.headerRow, { borderBottomColor: theme.primary, backgroundColor: theme.primary + '15' }]}>
                <Text style={[styles.headerPlayerName, { color: theme.text }]}>Batsman</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>R</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>B</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>4s</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>6s</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>SR</Text>
              </View>

              {hasBattingData ? (
                <FlatList data={activeTeam.battingScorecard} keyExtractor={(item, idx) => `${matchId}-${activeTab}-bat-${idx}`} renderItem={renderBatsmanRow} scrollEnabled={false} showsVerticalScrollIndicator={false} />
              ) : (
                <View style={styles.noDataContainer}>
                  <Text style={[styles.noDataText, { color: theme.textSecondary }]}>{details.status === 'Scheduled' ? 'Match not started yet' : 'Batting scorecard not available'}</Text>
                </View>
              )}
            </>
          ) : (
            <>
              <View style={[styles.headerRow, { borderBottomColor: theme.primary, backgroundColor: theme.primary + '15' }]}>
                <Text style={[styles.headerPlayerName, { color: theme.text }]}>Bowler</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>O</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>M</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>R</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>W</Text>
                <Text style={[styles.headerCell, { color: theme.text }]}>Econ</Text>
              </View>

              {hasBowlingData ? (
                <FlatList
                  data={bowlingTeam.bowlingScorecard}
                  keyExtractor={(item, idx) => `${matchId}-${activeTab}-bowl-${idx}`}
                  renderItem={renderBowlerRow}
                  scrollEnabled={false}
                  showsVerticalScrollIndicator={false}
                />
              ) : (
                <View style={styles.noDataContainer}>
                  <Text style={[styles.noDataText, { color: theme.textSecondary }]}>{details.status === 'Scheduled' ? 'Match not started yet' : 'Bowling figures not available'}</Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {details.status === 'Live' && (
        <View style={[styles.liveSection, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.liveSectionTitle, { color: theme.text }]}>🔴 Live</Text>
          {details.currentBatsmen && details.currentBatsmen.length > 0 && (
            <View style={styles.livePlayersContainer}>
              <Text style={[styles.liveLabel, { color: theme.text }]}>Current Batsmen:</Text>
              {details.currentBatsmen.map((b, idx) => (
                <Text key={idx} style={[styles.livePlayerText, { color: theme.textSecondary }]}>• {b.name} - {b.runs}({b.balls})</Text>
              ))}
            </View>
          )}
          {details.currentBowler && (
            <View style={styles.livePlayersContainer}>
              <Text style={[styles.liveLabel, { color: theme.text }]}>Current Bowler:</Text>
              <Text style={[styles.livePlayerText, { color: theme.textSecondary }]}>• {details.currentBowler.name} - {details.currentBowler.wickets}/{details.currentBowler.runs}</Text>
            </View>
          )}
        </View>
      )}

      {!hasBattingData && !hasBowlingData && details.status !== 'Scheduled' && (
        <View style={[styles.infoMessage, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.infoMessageText, { color: theme.textSecondary }]}>ℹ️ Detailed scorecard will be available once the match progresses</Text>
        </View>
      )}
    </View>
  );
};

const getBallColor = (ball) => {
  const ballStr = String(ball).toUpperCase();
  if (ballStr === 'W' || ballStr === 'OUT') return '#FF3B30';
  if (ballStr === '6') return '#5856D6';
  if (ballStr === '4') return '#34C759';
  if (ballStr === '0' || ballStr === 'DOT') return '#8E8E93';
  return '#007AFF';
};

const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { alignItems: 'center', justifyContent: 'center', padding: 20, minHeight: 150 },
  loadingText: { marginTop: 8, fontSize: 14 },
  errorText: { fontSize: 14, color: '#FF3B30', textAlign: 'center', marginBottom: 12 },
  retryButton: { backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  retryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  noDataText: { fontSize: 14, fontStyle: 'italic', textAlign: 'center' },
  tabContainer: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  activeTab: { elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  tabText: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tabScore: { fontSize: 16, fontWeight: '800' },
  scoreSummary: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  summaryLabel: { fontSize: 14, fontWeight: '600' },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  viewToggleContainer: { flexDirection: 'row', marginBottom: 12, borderRadius: 8, overflow: 'hidden', borderWidth: 1 },
  viewToggle: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  activeViewToggle: {},
  viewToggleText: { fontSize: 14, fontWeight: '600' },
  scorecardTable: { minWidth: '100%' },
  headerRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 2, borderRadius: 8, marginBottom: 2 },
  headerPlayerName: { flex: 1.8, fontWeight: '700', fontSize: 13, textAlign: 'left' },
  // make all numeric columns fixed width and right-aligned for perfect vertical alignment
  headerCell: { width: 50, textAlign: 'right', fontWeight: '700', fontSize: 13 },
  dataRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  playerName: { flex: 1.8, fontSize: 13 },
  // fixed width for numeric cells ensures alignment across rows
  dataCell: { width: 50, textAlign: 'right', fontSize: 13 },
  noDataContainer: { padding: 20, alignItems: 'center', justifyContent: 'center' },
  liveSection: { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1 },
  liveSectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  livePlayersContainer: { marginTop: 8 },
  liveLabel: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  livePlayerText: { fontSize: 13, marginLeft: 8, marginTop: 2 },
  ballsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  ballBadge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ballText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  infoMessage: { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1 },
  infoMessageText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

export default ScoreCard;
