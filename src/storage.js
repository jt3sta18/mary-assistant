// Storage adapter for standalone deployment
// Mimics the window.storage API from Claude artifacts using localStorage

const storage = {
  async get(key) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) throw new Error("Key not found");
      return { key, value };
    } catch (e) {
      throw e;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },

  async delete(key) {
    try {
      localStorage.removeItem(key);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },

  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!prefix || key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return { keys, prefix };
  },
};

// Make it available globally so the Mary component can use window.storage
if (typeof window !== "undefined") {
  window.storage = window.storage || storage;
}

export default storage;
