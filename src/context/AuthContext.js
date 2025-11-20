// src/context/AuthContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { auth } from '../services/firebase';

const AuthContext = createContext({
  user: null,
  initializing: true,
  authLoading: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {}
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setInitializing(false);
    });

    return unsubscribe;
  }, []);

  const withLoading = async (fn) => {
    setAuthLoading(true);
    try {
      return await fn();
    } finally {
      setAuthLoading(false);
    }
  };

  const signInHandler = (email, password) =>
    withLoading(() => signInWithEmailAndPassword(auth, email.trim(), password));

  const signUpHandler = (email, password) =>
    withLoading(() => createUserWithEmailAndPassword(auth, email.trim(), password));

  const signOutHandler = () => withLoading(() => signOut(auth));

  const value = useMemo(() => ({
    user,
    initializing,
    authLoading,
    signIn: signInHandler,
    signUp: signUpHandler,
    signOut: signOutHandler
  }), [user, initializing, authLoading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
