// Keep a small browser-stored object (Marker.io links, email edits) in step
// with the shared store when one is connected. Local copy stays as the fallback.
const localLoad = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch { return {}; } };
const localSave = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// Pull the team's copy and merge it over this browser's. Returns true when shared.
export async function pullSetting(key, localKey) {
  try {
    const j = await fetch(`/api/settings?key=${key}`).then((r) => r.json());
    if (!j.shared) return false;
    const merged = { ...localLoad(localKey), ...(j.value || {}) };
    localSave(localKey, merged);
    return true;
  } catch { return false; }
}

// Save the whole object for the team. Fire and forget; the local copy is already written.
export function pushSetting(key, value) {
  fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) }).catch(() => {});
}
