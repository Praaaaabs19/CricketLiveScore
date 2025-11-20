// src/state/matchUpdateBus.js
// Lightweight pub/sub to keep match summaries and details in sync across screens.
const listeners = new Set();
const latestById = new Map();

export const publishMatchUpdate = (match) => {
  if (!match || !match.id) return;
  latestById.set(String(match.id), match);
  listeners.forEach((listener) => {
    try {
      listener(match);
    } catch (err) {
      console.warn('[matchUpdateBus] listener error', err);
    }
  });
};

export const subscribeToMatchUpdates = (listener, { replay = true } = {}) => {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);

  if (replay) {
    latestById.forEach((match) => {
      try {
        listener(match);
      } catch (err) {
        console.warn('[matchUpdateBus] replay listener error', err);
      }
    });
  }

  return () => {
    listeners.delete(listener);
  };
};

export const clearMatchUpdates = () => {
  listeners.clear();
  latestById.clear();
};
