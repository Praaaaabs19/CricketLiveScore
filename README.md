## CricketLiveScore – Cricket Live Score Mobile Application

CricketLiveScore is a **React Native + Expo** mobile app that gives you a modern, fast way to follow cricket:

- Live, upcoming and recent matches with scores and status
- Ball‑by‑ball style scorecards for each innings
- Toss information and match results/margins
- ICC‑style rankings (batsmen, bowlers, all‑rounders, teams)
- Latest cricket news headlines
- Email/password authentication using **Firebase Auth**
- Automatic light/dark theming using a custom `ThemeContext`

Under the hood it uses the **Cricbuzz Cricket** API via **RapidAPI** for match, scorecard, rankings and news data.

---

## 1. How the app works (high‑level)

- **App bootstrap (`App.js`)**
  - Wraps the entire app in:
    - `ThemeProvider` → light/dark themes
    - `AuthProvider` → Firebase authentication state
    - `SafeAreaProvider` → safe area handling
  - Uses React Navigation stacks:
    - **Auth stack**: `LoginScreen`, `SignupScreen`
    - **Main stack**: `HomeScreen`, `MatchDetailsScreen`, `RankingsScreen`, `NewsScreen`
  - If the user is not logged in → Auth stack, otherwise → Main stack.

- **Authentication (`src/context/AuthContext.js`, `src/services/firebase.js`)**
  - Configured Firebase app with email/password sign‑in.
  - `AuthContext` exposes `signIn`, `signUp`, `signOut`, and `authLoading`.
  - `LoginScreen` and `SignupScreen` call these methods and show errors/spinners.

- **Theming (`src/context/ThemeContext.js`)**
  - Stores theme mode (`light`, `dark`, or `system`) in AsyncStorage.
  - Watches device theme (`Appearance`) when in `system` mode.
  - Exposes `theme`, `isDarkMode`, `toggleTheme`, `setThemeMode`.

- **Home screen (`src/screens/HomeScreen.js`)**
  - Fetches **live / upcoming / recent** matches from RapidAPI using `fetchMatches(type)`.
  - Maintains an in‑memory map of matches and merges updates to avoid flicker.
  - Periodically refreshes counts for tabs (total/live/upcoming/completed).
  - Broadcasts match snapshots through `state/matchUpdateBus` so details screens can stay in sync.

- **Match details (`src/screens/MatchDetailsScreen.js`)**
  - Fetches full details for a specific match via `fetchMatchDetails(matchId)`.
  - Subscribes to `matchUpdateBus` and merges incoming updates.
  - Shows:
    - Teams, scores, wickets, overs
    - Match type & status (Live/Completed/Scheduled)
    - Venue
    - Toss text and match result/margin
    - Full scorecard via `ScoreCard` (from `src/screens/ScoreCard.js`)

- **Rankings & news**
  - `RankingsScreen` → calls `fetchRankings({ format, type })` to render ICC‑style rankings for Tests, ODIs and T20s.
  - `NewsScreen` → calls `fetchNews({ attachImages: false })` to list latest news headlines without heavy images.

---

## 2. Project structure – where things live

At the project root:

- **`App.js`** – React Navigation setup + providers.
- **`app.json`** – Expo app configuration (name, icon, splash, Android/iOS config).
- **`package.json`** – NPM scripts and dependencies.
- **`assets/`** – Static assets.
  - `assets/images/` – icons, splash/logo and other images.
  - `assets/fonts/` – custom fonts.

Main application code is under **`src/`**:

- **`src/services/`**
  - `api.js` – **Cricbuzz / RapidAPI wrapper**.
    - Exposes:
      - `fetchMatches(type)` – live/upcoming/recent match list.
      - `fetchMatchDetails(matchId)` – match info + scorecard.
      - `fetchRankings({ format, type })` – rankings data.
      - `fetchNews({ attachImages })` – news stories.
    - Handles:
      - Axios client with RapidAPI headers.
      - Request deduping and retry handling.
      - Transforming raw Cricbuzz JSON into a consistent match model.
  - `firebase.js` – Firebase initialization and `auth` export for AuthContext.

- **`src/context/`**
  - `AuthContext.js` – wraps Firebase Auth; used by login/signup and root navigator.
  - `ThemeContext.js` – light/dark theme management.

- **`src/screens/`**
  - `HomeScreen.js` – match list, pull‑to‑refresh, tab counts, and navigation to details.
  - `MatchDetailsScreen.js` – per‑match view with toss, result and scorecard.
  - `ScoreCard.js` – detailed batting/bowling scorecards (used by MatchDetails).
  - `LoginScreen.js` / `SignupScreen.js` – auth flows.
  - `RankingsScreen.js` – ICC rankings UI.
  - `NewsScreen.js` – news list UI.

- **`src/state/`**
  - `matchUpdateBus.js` – lightweight event bus for match updates.

---

## 3. Prerequisites

- **Node.js** (LTS recommended: 18+) Must Download from the official site: (https://nodejs.org/en/download)
- **npm** (bundled with Node) or **Bun** if you prefer
- **Expo CLI** (installed automatically via `npx`)
- A free **RapidAPI** account
  - Subscribe to the **Cricbuzz Cricket** API to obtain an API key
- A configured **Firebase** project if you want to use your own auth backend (optional; a sample config is already present in `src/services/firebase.js`).

---

## 4. Installation & running the app

### 4.1 Extract the ZIP in downloads
Expand-Archive -Path .\199879_Prabhakar Morajkar_CricketLiveScore.zip -DestinationPath .\199879_Prabhakar Morajkar_CricketLiveScore

### 4.2 Open the project folder 
cd .\199879_Prabhakar Morajkar_CricketLiveScore

### 4.3 Install dependencies 

```bash
npm install
# or, if you use bun
bun install
```

### 4.4 Start the Expo dev server

Using npx (recommended):

```bash
npx expo start
```

You’ve also been using Bun directly, which is equivalent to:

```bash
bun expo start
```

### 4.5 Open the app

- **On a physical device**: install **Expo Go** (Android/iOS) and scan the QR code shown in your terminal.
- **On an emulator/simulator**: press the shortcuts that Expo suggests (e.g. `a` for Android, `i` for iOS) or run `npm run android` / `npm run ios`.

---

## 5. Editing the RapidAPI key (Cricbuzz API)

The app talks to Cricbuzz through RapidAPI. To use your own quota, set **your own RapidAPI key** in `src/services/api.js`.

### 5.1 Find the key constant

1. Open this file in your editor:

   ```text
   src/services/api.js
   ```

2. Near the top you’ll see:

   ```js
   const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '0a76dfe559msh6e1aeb6caf58f07p1c1617jsnfd38f7bfcb3b';
   ```

### 5.2 Option A – hard‑code your key (simple for local dev)

1. Replace the existing string with your own RapidAPI key:

   ```js
   const RAPIDAPI_KEY = 'YOUR_RAPIDAPI_KEY_HERE';
   ```

2. Save the file.
3. Stop the Expo dev server if it’s running.
4. Start it again:

   ```bash
   npm run start
   ```

> **Warning:** do **not** commit your personal API key to public Git repositories. For open‑source or production usage prefer Option B.

### 5.3 Option B – use an environment variable (safer)

1. Keep the line in `api.js` as:

   ```js
   const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '0a76dfe559msh6e1aeb6caf58f07p1c1617jsnfd38f7bfcb3b';
   ```

2. The code will read `process.env.RAPIDAPI_KEY`; if it’s missing, it falls back to the string literal.

---

## 6. Optional: changing the Firebase project

If you want to hook the app up to your own Firebase project instead of the sample one, edit:

```text
src/services/firebase.js
```

Replace the `firebaseConfig` object with the config from your Firebase console:

```js
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: '...',
  appId: '...'
};
```

Then restart the app. Authentication screens (`LoginScreen`, `SignupScreen`) will now use your Firebase project.

---

## 7. Step‑by‑step: from clone to live scores

1. **Clone or download** this repository and open it in your editor.
2. **Install dependencies**:
   - `npm install` (or `bun install`).
3. **Configure RapidAPI key**:
   1. Get a key from RapidAPI → Cricbuzz Cricket API.
   2. Open `src/services/api.js`.
   3. Update `RAPIDAPI_KEY` using Option A or B from section 5.
4. *(Optional)* **Configure Firebase**:
   - Edit `src/services/firebase.js` if you want to use your own project.
5. **Start the app**:
   - `npm run start` (or `bun expo start`).
6. **Launch on device/emulator** using Expo Go or the emulator shortcuts.
7. **Sign up or log in** using the auth screens.
8. Explore:
   - **Home**: live/upcoming/recent matches.
   - **Match Details**: toss, scores, overs, result and detailed scorecard.
   - **Rankings**: ICC rankings by format and type.
   - **News**: scrollable feed of the latest cricket stories.

---

## 8. Troubleshooting

- **SafeAreaView deprecation warning**
  - Expo/React Native now prefers `react-native-safe-area-context`. This project already uses `SafeAreaProvider`; some legacy usage of `SafeAreaView` may still log warnings but does not break functionality.

- **No live data / empty lists**
  - Double‑check that:
    - Your RapidAPI subscription to Cricbuzz Cricket is active.
    - `RAPIDAPI_KEY` in `src/services/api.js` is correct.

- **429 / rate‑limit errors**
  - The API layer includes some retry logic, but if you exceed free tier limits you may still see gaps. Consider upgrading the plan or reducing refresh frequency.

- **Authentication issues**
  - Ensure the Firebase project allows Email/Password sign‑in.
  - Check that `firebaseConfig` matches your console values if you customized it.

---

## 9. Contributing / customizing

- Modify UI and UX in `src/screens/`.
- Extend the API wrapper in `src/services/api.js` for additional endpoints.
- Adjust theming in `src/context/ThemeContext.js`.
- Hook additional screens into navigation in `App.js`.

This README should give you everything you need to understand **what the app does**, **how it is structured**, **how it talks to Cricbuzz via RapidAPI**, and **how to run and customize it**.
