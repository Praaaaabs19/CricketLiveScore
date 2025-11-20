// App.js
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, SafeAreaView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MatchDetailsScreen from './src/screens/MatchDetailsScreen';
import NewsScreen from './src/screens/NewsScreen';
import RankingsScreen from './src/screens/RankingsScreen';
import SignupScreen from './src/screens/SignupScreen';

const AuthStack = createStackNavigator();
const MainStack = createStackNavigator();

const AuthStackScreen = () => (
  <AuthStack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Signup" component={SignupScreen} />
  </AuthStack.Navigator>
);

const MainStackScreen = () => (
  <MainStack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
    <MainStack.Screen name="Home" component={HomeScreen} />
    <MainStack.Screen name="MatchDetails" component={MatchDetailsScreen} />
    <MainStack.Screen name="Rankings" component={RankingsScreen} />
    <MainStack.Screen name="News" component={NewsScreen} />
  </MainStack.Navigator>
);

const RootNavigator = () => {
  const { user, initializing } = useAuth();
  const { theme } = useTheme();

  if (initializing) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  return (
    <NavigationContainer>
      {user ? <MainStackScreen /> : <AuthStackScreen />}
    </NavigationContainer>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SafeAreaProvider>
          <RootNavigator />
        </SafeAreaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
