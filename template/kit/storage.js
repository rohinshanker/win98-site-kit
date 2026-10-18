// localStorage helpers that never throw: blocked storage (private mode,
// disabled cookies) and malformed JSON both fall back quietly.

const resolveStorage = (storage) => (typeof storage === "function" ? storage() : storage);

const defaultStorage = () => window.localStorage;

/** Reads a JSON value, returning `fallbackValue` when missing or unreadable. */
export const readJson = (key, fallbackValue = null, storage = defaultStorage) => {
  try {
    const serialized = resolveStorage(storage).getItem(key);
    return serialized === null ? fallbackValue : JSON.parse(serialized);
  } catch {
    return fallbackValue;
  }
};

/** Writes a JSON value; returns false when storage is unavailable. */
export const writeJson = (key, value, storage = defaultStorage) => {
  try {
    resolveStorage(storage).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/** Removes a key; returns false when storage is unavailable. */
export const remove = (key, storage = defaultStorage) => {
  try {
    resolveStorage(storage).removeItem(key);
    return true;
  } catch {
    return false;
  }
};

/** Reads a plain string, or `fallbackValue` when missing or unreadable. */
export const readString = (key, fallbackValue = "", storage = defaultStorage) => {
  try {
    const value = resolveStorage(storage).getItem(key);
    return value === null ? fallbackValue : value;
  } catch {
    return fallbackValue;
  }
};

export const writeString = (key, value, storage = defaultStorage) => {
  try {
    resolveStorage(storage).setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
};
