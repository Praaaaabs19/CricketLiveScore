// src/screens/SignupScreen.js
import { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const SignupScreen = ({ navigation }) => {
  const { theme, isDarkMode } = useTheme();
  const { signUp, authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const styles = useMemo(() => createStyles(theme), [theme]);

  const canSubmit =
    email.trim().length > 0 &&
    password.trim().length >= 6 &&
    password.trim() === confirmPassword.trim();

  const handleSignup = async () => {
    if (!canSubmit || authLoading) return;
    setError('');
    try {
      await signUp(email, password);
    } catch (err) {
      setError(err?.message || 'Unable to create account. Please try again.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}> 
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Join the cricket squad! 🏏</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Create your account to track live scores.</Text>
          </View>

          <View style={styles.form}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={isDarkMode ? '#999999' : '#9e9e9e'}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Create a password"
              placeholderTextColor={isDarkMode ? '#999999' : '#9e9e9e'}
              secureTextEntry
              style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Confirm Password</Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              placeholderTextColor={isDarkMode ? '#999999' : '#9e9e9e'}
              secureTextEntry
              style={[styles.input, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            />

            {error ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: theme.error + '15', borderColor: theme.error + '40' }
                ]}
              >
                <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: canSubmit ? theme.primary : theme.primary + '55' }
              ]}
              activeOpacity={0.85}
              onPress={handleSignup}
              disabled={!canSubmit || authLoading}
            >
              {authLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={{ color: theme.textSecondary }}>Already have an account?</Text>
            <TouchableOpacity onPress={() => navigation.replace('Login')}>
              <Text style={[styles.link, { color: theme.primary }]}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: StatusBar.currentHeight || 0
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center'
  },
  header: {
    marginBottom: 32
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22
  },
  form: {
    gap: 12
  },
  label: {
    fontSize: 13,
    fontWeight: '600'
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15
  },
  errorBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600'
  },
  primaryButton: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700'
  },
  footer: {
    marginTop: 40,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6
  },
  link: {
    fontSize: 15,
    fontWeight: '700'
  }
});

export default SignupScreen;
