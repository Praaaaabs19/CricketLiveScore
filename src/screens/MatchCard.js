// src/components/MatchCard.js
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

const MatchCard = ({ match, onPress }) => {
  const { theme } = useTheme();

  // normalize fields so MatchCard handles both shapes
  const normalized = {
    id: match.id ?? match.matchId ?? '',
    seriesName: match.seriesName ?? match.series ?? '',
    matchFormat: match.type ?? match.matchFormat ?? match.format ?? '',
    status: match.status ?? (match.isLive ? 'Live' : (match.state ?? 'Scheduled')),
    isLive: (match.status === 'Live') || match.isLive || ((match.state || '').toLowerCase().includes('live')),
    team1: {
      name: match.team1?.name ?? match.team1Name ?? match.team1?.fullName ?? (match.team1Name || ''),
      shortName: match.team1?.shortName ?? match.team1?.teamSName ?? match.team1Short ?? (match.team1?.name ? match.team1.name.slice(0,3).toUpperCase() : 'T1'),
      score: match.team1?.score ?? match.team1Score ?? match.team1?.runs ?? '',
      wickets: match.team1?.wickets ?? match.team1Wickets ?? match.team1?.wkts ?? '',
      overs: match.team1?.overs ?? match.team1Overs ?? match.team1?.ov ?? ''
    },
    team2: {
      name: match.team2?.name ?? match.team2Name ?? match.team2?.fullName ?? (match.team2Name || ''),
      shortName: match.team2?.shortName ?? match.team2?.teamSName ?? match.team2Short ?? (match.team2?.name ? match.team2.name.slice(0,3).toUpperCase() : 'T2'),
      score: match.team2?.score ?? match.team2Score ?? match.team2?.runs ?? '',
      wickets: match.team2?.wickets ?? match.team2Wickets ?? match.team2?.wkts ?? '',
      overs: match.team2?.overs ?? match.team2Overs ?? match.team2?.ov ?? ''
    },
    venue: match.venue ?? match.venueName ?? match.ground ?? ''
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'TBD';
    const date = new Date(parseInt(timestamp));
    const now = new Date();
    const diffTime = date - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays > 0 && diffDays < 7) return `In ${diffDays} days`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  };

  const getMatchStatusInfo = () => {
    const state = (match.state || '').toLowerCase();
    const status = normalized.status || '';
    if (normalized.isLive || state.includes('in progress') || state.includes('live')) {
      return { text: status || 'Live', color: '#FF3B30', showDot: true };
    }
    if (state.includes('complete') || state.includes('completed') || status.toLowerCase().includes('won')) {
      return { text: status || 'Completed', color: '#34C759', showDot: false };
    }
    // scheduled/preview
    return { text: status || formatDate(match.startDate ?? match.start), color: theme.textSecondary, showDot: false };
  };

  const statusInfo = getMatchStatusInfo();

  const formatScoreLine = (team) => {
    const hasScore = team.score != null && String(team.score).trim() !== '';
    const hasWickets = team.wickets != null && String(team.wickets).trim() !== '' && String(team.wickets) !== '0';
    const hasOvers = team.overs != null && String(team.overs).trim() !== '' && String(team.overs) !== '0.0';

    if (!hasScore && !hasWickets && !hasOvers) return '';

    let text = hasScore ? String(team.score) : '0';
    if (hasWickets) {
      text += `/${team.wickets}`;
    }
    if (hasOvers) {
      text += ` (${team.overs})`;
    }
    return text;
  };

  const styles = StyleSheet.create({
    container: {
      backgroundColor: theme.surface,
      marginHorizontal: 16,
      marginVertical: 8,
      borderRadius: 12,
      padding: 16,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      borderWidth: normalized.isLive ? 2 : 1,
      borderColor: normalized.isLive ? '#FF3B30' : theme.border,
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    seriesName: { fontSize: 12, color: theme.textSecondary, fontWeight: '600', flex: 1, marginRight: 8 },
    matchFormat: { fontSize: 10, color: theme.background, backgroundColor: theme.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, fontWeight: 'bold', overflow: 'hidden' },
    statusContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    liveDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    statusText: { fontSize: 14, fontWeight: '600' },
    teamsContainer: { gap: 12 },
    teamRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    teamInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    teamIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.primary + '20', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    teamShortName: { fontSize: 14, fontWeight: 'bold', color: theme.primary },
    teamName: { fontSize: 16, fontWeight: '600', color: theme.text, flex: 1 },
    teamScore: { fontSize: 18, fontWeight: 'bold', color: theme.text, minWidth: 80, textAlign: 'right' },
    noScore: { fontSize: 14, color: theme.textSecondary, fontStyle: 'italic' },
    divider: { height: 1, backgroundColor: theme.border, marginVertical: 4 },
    footer: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    venue: { fontSize: 12, color: theme.textSecondary, flex: 1 },
    matchDesc: { fontSize: 12, color: theme.textSecondary, fontWeight: '500' },
  });

  return (
    <TouchableOpacity onPress={() => onPress(normalized)}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.seriesName} numberOfLines={1}>{normalized.seriesName || 'Cricket Match'}</Text>
          {normalized.matchFormat && <Text style={styles.matchFormat}>{String(normalized.matchFormat).toUpperCase()}</Text>}
        </View>

        <View style={styles.statusContainer}>
          {statusInfo.showDot && <View style={[styles.liveDot, { backgroundColor: statusInfo.color }]} />}
          <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.text}</Text>
        </View>

        <View style={styles.teamsContainer}>
          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <View style={styles.teamIcon}><Text style={styles.teamShortName}>{normalized.team1.shortName}</Text></View>
              <Text style={styles.teamName} numberOfLines={1}>{normalized.team1.name}</Text>
            </View>
            {formatScoreLine(normalized.team1)
              ? <Text style={styles.teamScore}>{formatScoreLine(normalized.team1)}</Text>
              : normalized.isLive
                ? <Text style={styles.noScore}>-</Text>
                : null}
          </View>

          <View style={styles.divider} />

          <View style={styles.teamRow}>
            <View style={styles.teamInfo}>
              <View style={styles.teamIcon}><Text style={styles.teamShortName}>{normalized.team2.shortName}</Text></View>
              <Text style={styles.teamName} numberOfLines={1}>{normalized.team2.name}</Text>
            </View>
            {formatScoreLine(normalized.team2)
              ? <Text style={styles.teamScore}>{formatScoreLine(normalized.team2)}</Text>
              : normalized.isLive
                ? <Text style={styles.noScore}>-</Text>
                : null}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.venue} numberOfLines={1}>📍 {normalized.venue || 'Venue TBD'}</Text>
          {match.matchDesc && <Text style={styles.matchDesc}>{match.matchDesc}</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default MatchCard;
