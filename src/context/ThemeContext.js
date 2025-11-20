// src/context/ThemeContext.js
import React, { createContext, useState, useContext, useEffect } from 'react';
import { Appearance, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

const STORAGE_KEY = 'APP_THEME_MODE'; // 'light' | 'dark' | 'system'

// Your existing themes kept exactly same:
const lightTheme = {
  background: '#ffffff',
  surface: '#f5f5f5',
  primary: '#1976d2',
  secondary: '#424242',
  text: '#000000',
  textSecondary: '#666666',
  border: '#e0e0e0',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#f44336',
};

const darkTheme = {
  background: '#121212',
  surface: '#1e1e1e',
  primary: '#bb86fc',
  secondary: '#03dac6',
  text: '#ffffff',
  textSecondary: '#aaaaaa',
  border: '#333333',
  success: '#4caf50',
  warning: '#ff9800',
  error: '#cf6679',
};

export const ThemeProvider = ({ children }) => {
  const [mode, setMode] = useState('system'); // 'light' | 'dark' | 'system'
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Resolve which theme is active
  const theme = isDarkMode ? darkTheme : lightTheme;

  // Load saved preference
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setMode(saved);
        }
      } catch (e) {}
    })();
  }, []);

  // Apply correct theme based on mode
  useEffect(() => {
    const resolve = () => {
      if (mode === 'light') return false;
      if (mode === 'dark') return true;
      return Appearance.getColorScheme() === 'dark';
    };

    const dark = resolve();
    setIsDarkMode(dark);

    StatusBar.setBarStyle(dark ? 'light-content' : 'dark-content', true);
  }, [mode]);

  // Listen to system theme change (if mode === 'system')
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (mode === 'system') {
        const dark = colorScheme === 'dark';
        setIsDarkMode(dark);
        StatusBar.setBarStyle(dark ? 'light-content' : 'dark-content', true);
      }
    });

    return () => subscription.remove();
  }, [mode]);

  // User toggles (light/dark)
  const toggleTheme = async () => {
    const newMode = mode === 'dark' ? 'light' : 'dark';
    setMode(newMode);
    await AsyncStorage.setItem(STORAGE_KEY, newMode);
  };

  // Explicit setMode (for a settings screen)
  const setThemeMode = async (newMode) => {
    setMode(newMode);
    await AsyncStorage.setItem(STORAGE_KEY, newMode);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDarkMode,
        mode,        // system / light / dark
        toggleTheme, // quick toggle
        setThemeMode // manual choose
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
