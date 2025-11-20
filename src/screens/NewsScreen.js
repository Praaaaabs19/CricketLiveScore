// src/screens/NewsScreen.js
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../context/ThemeContext';
import { fetchNews } from '../services/api';

export default function NewsScreen({ navigation }) {
  const { theme } = useTheme();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
        setError(null);
      }
      // do NOT attach images here (avoid image fetches that cause 503)
      const data = await fetchNews({ attachImages: false });
      setStories(data || []);
    } catch (err) {
      console.warn('[news] load error', err);
      setError(err?.message || 'Failed to load news');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(false);
  }, [load]);

  const renderItem = ({ item }) => {
    const published = item.pubTime ? new Date(Number(item.pubTime)).toLocaleString() : '';
    const coverCaption = item.coverImage?.caption ?? '';

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        style={[styles.card, { backgroundColor: theme.surface }]}
        onPress={() => {
          // future: navigate to detail screen with item.raw or item.id
        }}
      >
        <View style={styles.cardBody}>
          <Text style={[styles.hline, { color: theme.text }]} numberOfLines={2}>
            {item.hline}
          </Text>

          {item.intro ? (
            <Text style={[styles.intro, { color: theme.textSecondary }]} numberOfLines={3}>
              {item.intro}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <Text style={{ color: theme.textSecondary, fontSize: 12 }}>🕒 {published}</Text>
            <Text style={{ color: theme.primary, fontSize: 12 }}>{item.storyType}</Text>
          </View>

          {coverCaption ? (
            <Text style={[styles.caption, { color: theme.textSecondary }]} numberOfLines={2}>
              {coverCaption}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.surface }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={22} color={theme.primary} />
        </TouchableOpacity>

        <Text style={[styles.title, { color: theme.text }]}>📰 Latest News</Text>

        <TouchableOpacity onPress={() => load(true)}>
          <Icon name="refresh" size={20} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={{ color: theme.text }}>{error}</Text>
              <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
                <Text style={{ color: '#fff' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={stories}
              keyExtractor={(i) => String(i.id)}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 12 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} colors={[theme.primary]} />}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: theme.textSecondary }}>No news available</Text>
                </View>
              }
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: StatusBar.currentHeight || 0 },
  header: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  title: { fontSize: 18, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', padding: 12, borderRadius: 10, marginBottom: 12, overflow: 'hidden' },
  cardBody: { flex: 1 },
  hline: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  intro: { fontSize: 13, marginBottom: 8 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caption: { fontSize: 12, marginTop: 8 },
  errorBox: { padding: 12, alignItems: 'center' },
  retryBtn: { marginTop: 8, backgroundColor: '#FF6B6B', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  empty: { paddingTop: 40, alignItems: 'center' }
});
