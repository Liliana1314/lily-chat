const DB_NAME = "lily-engine";
const DB_VER = 1;
let running = false;
let loopGen = 0;
let softTimer = null;
let lastBeat = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("inbox")) {
        db.createObjectStore("inbox", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("abort"));
  });
}
async function getCfg() {
  const db = await openDb();
  try {
    const tx = db.transaction("kv", "readonly");
    const req = tx.objectStore("kv").get("cfg");
    const val = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return val;
  } finally {
    db.close();
  }
}
async function setCfg(cfg) {
  const db = await openDb();
  try {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(cfg, "cfg");
    await txDone(tx);
  } finally {
    db.close();
  }
}
async function pushInbox(item) {
  const db = await openDb();
  try {
    const tx = db.transaction("inbox", "readwrite");
    tx.objectStore("inbox").add(item);
    await txDone(tx);
  } finally {
    db.close();
  }
}
async function takeInbox() {
  const db = await openDb();
  try {
    const tx = db.transaction("inbox", "readwrite");
    const store = tx.objectStore("inbox");
    const items = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    store.clear();
    await txDone(tx);
    return items;
  } finally {
    db.close();
  }
}

function showNote(title, body, kind) {
  const tag = kind === "call" ? "lily-call" : kind === "bg" ? "lily-bg" : "lily-msg";
  return self.registration.showNotification(title || "莉莉·Amour", {
    body: body || "发来一条消息",
    tag: tag,
    renotify: kind !== "bg",
    requireInteraction: kind === "call" || kind === "bg",
    silent: kind === "bg",
    vibrate: kind === "bg" ? [] : [80, 40, 80],
    data: { open: kind === "mm" ? "stay" : "chat" }
  });
}

function roll(p) {
  return Math.random() * 100 < Math.max(0, Math.min(100, Number(p) || 0));
}
function nextWait(cfg) {
  const min = Math.max(800, Number(cfg.waitMin) || 2000);
  const max = Math.max(min + 400, Number(cfg.waitMax) || 8000);
  const a = Math.log(min);
  const b = Math.log(max);
  return Math.round(Math.exp(a + Math.random() * (b - a)));
}
function pickText(cfg) {
  const list = (cfg && cfg.texts) || [];
  if (!list.length) return "在想你";
  const i = Math.floor(Math.random() * list.length);
  return list[i] || "在想你";
}

async function tickIfDue() {
  if (!running) return;
  const cfg = await getCfg();
  if (!cfg || !cfg.running) {
    running = false;
    return;
  }
  const now = Date.now();
  if (now - lastBeat < 6000 && lastBeat) return;
  const due = Number(cfg.nextAt) || 0;
  if (now < due) return;

  const items = [];
  if (roll(cfg.idlePoke)) {
    items.push({ kind: "poke", text: cfg.poke || "拍了拍你", at: now });
  }
  if (roll(cfg.idleMsg)) {
    items.push({ kind: "msg", text: pickText(cfg), at: now });
  }
  if (roll(cfg.idleCall)) {
    items.push({ kind: "call", text: "邀请你语音通话", at: now });
  }

  cfg.nextAt = now + nextWait(cfg);
  await setCfg(cfg);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await pushInbox(it);
    await showNote(cfg.name || "莉莉·Amour", it.text, it.kind === "call" ? "call" : "msg");
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    list.forEach((c) => {
      try { c.postMessage({ type: "engine-tick", item: it }); } catch (e) {}
    });
  }
}

async function runEngineBurst() {
  const my = ++loopGen;
  const end = Date.now() + 4 * 60 * 1000;
  while (running && my === loopGen && Date.now() < end) {
    try { await tickIfDue(); } catch (e) {}
    const cfg = await getCfg();
    if (!cfg || !cfg.running) break;
    const wait = Math.max(500, Math.min(2500, (Number(cfg.nextAt) || Date.now() + 1500) - Date.now()));
    await sleep(wait);
  }
  if (running && my === loopGen) armSoft();
}
function armSoft() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    if (running) runEngineBurst();
  }, 1200);
}
async function startFromCfg(cfg) {
  if (!cfg) return;
  cfg.running = true;
  if (!cfg.nextAt || cfg.nextAt < Date.now() - 60000) cfg.nextAt = Date.now() + (cfg.waitMin || 2000);
  running = true;
  await setCfg(cfg);
  try {
    await showNote("莉莉·Amour 后台运行中", "正在接收消息。不要把这个应用划掉。", "bg");
  } catch (e) {}
  runEngineBurst();
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await self.clients.claim();
    const cfg = await getCfg();
    if (cfg && cfg.running) {
      running = true;
      await runEngineBurst();
    }
  })());
});
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "lily-engine") e.waitUntil(runEngineBurst());
});
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "notify") {
    e.waitUntil(
      self.registration.showNotification(d.title || "莉莉·Amour", {
        body: d.body || "发来一条消息",
        tag: d.tag || "lily-msg",
        renotify: d.renotify !== false,
        requireInteraction: !!d.requireInteraction,
        silent: !!d.silent,
        vibrate: d.silent ? [] : [80, 40, 80],
        data: { open: d.open || "chat" }
      }).catch(() => {})
    );
    return;
  }
  if (d.type === "clear") {
    e.waitUntil(
      self.registration.getNotifications({ tag: d.tag || "lily-bg" }).then((list) => {
        list.forEach((n) => n.close());
      })
    );
    return;
  }
  if (d.type === "heartbeat") {
    lastBeat = Number(d.at) || Date.now();
    return;
  }
  if (d.type === "engine-start") {
    lastBeat = Date.now();
    e.waitUntil(startFromCfg(d.cfg || {}));
    return;
  }
  if (d.type === "engine-stop") {
    running = false;
    loopGen += 1;
    clearTimeout(softTimer);
    e.waitUntil((async () => {
      const cfg = (await getCfg()) || {};
      cfg.running = false;
      await setCfg(cfg);
      const notes = await self.registration.getNotifications({ tag: "lily-bg" });
      notes.forEach((n) => n.close());
    })());
    return;
  }
  if (d.type === "inbox-take") {
    const port = e.ports && e.ports[0];
    e.waitUntil(
      takeInbox().then((items) => {
        if (port) port.postMessage({ items: items });
      }).catch(() => {
        if (port) port.postMessage({ items: [] });
      })
    );
  }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || "chat";
  e.waitUntil((async () => {
    const cfg = await getCfg();
    if (cfg && cfg.running) {
      running = true;
      runEngineBurst();
    }
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c && c.url) {
        c.postMessage({ type: "open", open: open });
        return c.focus();
      }
    }
    return self.clients.openWindow("./");
  })());
});
