// src/screens/RankingsScreen.js
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../context/ThemeContext';
import { fetchRankings } from '../services/api';

const FORMATS = ['test', 'odi', 't20'];
const TYPES = ['batsmen', 'bowlers', 'allrounders', 'teams'];

const RankingsScreen = ({ navigation }) => {
  const { theme } = useTheme();

  const [format, setFormat] = useState('test');
  const [type, setType] = useState('batsmen');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(
    async (fmt = format, tp = type) => {
      setLoading(true);
      setErr(null);
      try {
        const data = await fetchRankings({ format: fmt, type: tp });
        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        console.warn('fetchRankings failed', e);
        setErr(e?.message ?? 'Failed to load rankings');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [format, type]
  );

  useEffect(() => {
    load(format, type);
  }, [format, type, load]);

  const styles = createStyles(theme);

  const renderItem = ({ item }) => (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardLeft}>
        <View style={[styles.rankCircle, { borderColor: theme.primary }]}>
          <Text style={[styles.rankText, { color: theme.primary }]}>{item.rank}</Text>
        </View>

        <View style={styles.playerInfo}>
          <Text style={[styles.playerName, { color: theme.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.playerCountry, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.country}
          </Text>
        </View>
      </View>

      <View style={styles.pointsWrap}>
        <Text style={[styles.points, { color: theme.text }]}>{item.points || item.rating}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.background }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-back" style={[styles.backText, { color: theme.primary }]} />
        </TouchableOpacity>
        <Text style={[styles.heading, { color: theme.text }]}>ICC Rankings</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Format pills */}
      <View style={[styles.pillRow, { paddingHorizontal: 12 }]}>
        {FORMATS.map((f) => {
          const active = format === f;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFormat(f)}
              style={[
                styles.pill,
                active ? { backgroundColor: theme.primary } : { backgroundColor: theme.surface, borderColor: theme.border },
              ]}
              activeOpacity={0.8}
            >
              <Text style={[styles.pillText, { color: active ? '#fff' : theme.text }]}>{f.toUpperCase()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Type chips - horizontal */}
      <View style={[styles.chipsWrap, { paddingLeft: 12 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 12 }}>
          {TYPES.map((t) => {
            const active = type === t;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                style={[
                  styles.chip,
                  active ? { backgroundColor: theme.primary, borderColor: theme.primary } : { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : theme.text }]}>{t}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.text }]}>Loading rankings...</Text>
          </View>
        ) : err ? (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: theme.error }]}>⚠️ {err}</Text>
            <TouchableOpacity onPress={() => load(format, type)} style={[styles.retryBtn, { backgroundColor: theme.primary }]}>
              <Text style={styles.retryTxt}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => `${it.id}-${it.rank}`}
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            contentContainerStyle={{ padding: 12, paddingBottom: 28 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: { flex: 1, paddingTop: StatusBar.currentHeight || 0 },
    header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
    backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    backText: { fontSize: 28, fontWeight: '600' },
    heading: { fontSize: 18, fontWeight: '700' },

    pillRow: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 10 },
    pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 8, borderWidth: 1 },
    pillText: { fontSize: 13, fontWeight: '700' },

    chipsWrap: { paddingVertical: 8, marginBottom: 6 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginRight: 8, borderWidth: 1 },
    chipText: { fontWeight: '700', fontSize: 13, textTransform: 'capitalize' },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { marginTop: 8 },
    errorText: { textAlign: 'center' },
    retryBtn: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
    retryTxt: { color: '#fff', fontWeight: '700' },

    card: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
    },
    cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    rankCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankText: { fontWeight: '800', fontSize: 16 },
    playerInfo: { marginLeft: 12, flex: 1 },
    playerName: { fontSize: 15, fontWeight: '700' },
    playerCountry: { fontSize: 12, marginTop: 2 },

    pointsWrap: { width: 70, alignItems: 'flex-end' },
    points: { fontSize: 16, fontWeight: '800' },
  });

export default RankingsScreen;
