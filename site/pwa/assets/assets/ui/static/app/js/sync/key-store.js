// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const DATABASE = "hora-sync";
const STORE = "keys";
const RECORD = "entries";

export function memoryKeyStore() {
  let record = null;
  return {
    async get() {
      return record;
    },
    async set(next) {
      record = next;
    },
    async remove() {
      record = null;
    },
  };
}

export function createKeyStore() {
  let database = null;

  const connect = () =>
    (database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("blocked"));
    }).catch((error) => {
      database = null;
      throw error;
    }));

  async function run(mode, action) {
    const connection = await connect();
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  return {
    async get() {
      try {
        return (await run("readonly", (store) => store.get(RECORD))) ?? null;
      } catch {
        return null;
      }
    },
    async set(record) {
      try {
        await run("readwrite", (store) => store.put(record, RECORD));
      } catch {}
    },
    async remove() {
      try {
        await run("readwrite", (store) => store.delete(RECORD));
      } catch {}
    },
  };
}
