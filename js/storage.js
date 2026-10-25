/* ------------------------------------------------------------
   Talk Buddy – 로컬 저장소 (localStorage)
   - 설정(API 키, 모델, 옵션)
   - 대화 기록(세션)
------------------------------------------------------------- */
const Store = (() => {
  const KEYS = {
    settings: 'talkbuddy.settings',
    history:  'talkbuddy.history',
    current:  'talkbuddy.current',
  };

  const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'gpt-4o-mini',
    autoSpeak: true,
    showKoHint: false,
    name: '',
    lang: 'en',          // 배우는 언어: 'en' | 'ja'
    stage: 'elem',       // 학습 단계: 'elem' | 'middle' | 'high' | 'adult'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('저장 실패', e); }
  }

  /* ----- 설정 ----- */
  function getSettings() { return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }; }
  function saveSettings(patch) {
    const next = { ...getSettings(), ...patch };
    write(KEYS.settings, next);
    return next;
  }

  /* ----- 대화 기록 -----
     session = {
       id, scenarioId, startedAt, endedAt|null,
       messages: [{ role: 'ai'|'user', text, at, ko?, tip? }],
       missionsDone: [1,2,3], report: {...}|null, demo: bool
     }
  */
  function getHistory() { return read(KEYS.history, []); }
  function saveSession(session) {
    const list = getHistory();
    const idx = list.findIndex(s => s.id === session.id);
    if (idx >= 0) list[idx] = session; else list.push(session);
    write(KEYS.history, list);
  }
  function getSession(id) { return getHistory().find(s => s.id === id) || null; }
  function deleteSession(id) { write(KEYS.history, getHistory().filter(s => s.id !== id)); }
  function clearHistory() { write(KEYS.history, []); localStorage.removeItem(KEYS.current); }

  /* ----- 진행 중인 세션 ----- */
  function getCurrentId() { return read(KEYS.current, null); }
  function setCurrentId(id) { if (id) write(KEYS.current, id); else localStorage.removeItem(KEYS.current); }

  /* ----- 내보내기 / 가져오기 ----- */
  function exportJSON() {
    return JSON.stringify({ app: 'talkbuddy', version: 1, exportedAt: new Date().toISOString(), history: getHistory() }, null, 2);
  }
  function importJSON(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : (data.history || []);
    if (!Array.isArray(incoming)) throw new Error('형식이 올바르지 않아요.');
    const list = getHistory();
    const ids = new Set(list.map(s => s.id));
    let added = 0;
    for (const s of incoming) {
      if (s && s.id && s.scenarioId && !ids.has(s.id)) { list.push(s); ids.add(s.id); added++; }
    }
    write(KEYS.history, list);
    return added;
  }

  return { getSettings, saveSettings, getHistory, saveSession, getSession, deleteSession, clearHistory,
           getCurrentId, setCurrentId, exportJSON, importJSON };
})();
