import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCrWpquAav1aNuQoEkafwpR6valZAV-qPI',
  authDomain: 'cricketapp-8e2f2.firebaseapp.com',
  projectId: 'cricketapp-8e2f2',
  storageBucket: 'cricketapp-8e2f2.firebasestorage.app',
  messagingSenderId: '891039315792',
  appId: '1:891039315792:web:81c3c03eb69ed262ee9e55',
  measurementId: 'G-WSS1FL3QRC'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
} catch (error) {
  auth = getAuth(app);
}

export { app, auth };
