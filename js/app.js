/* ------------------------------------------------------------
   Talk Buddy – 앱 로직
   화면: home / scenarios / chat / report / history / settings
------------------------------------------------------------- */
(function () {
  'use strict';

  /* ---------- 유틸 ---------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
  const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDur = sec => sec < 60 ? `${Math.round(sec)}초` : `${Math.floor(sec / 60)}분`;
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
  const DAY = 86400000;
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const state = {
    screen: 'home',
    cat: 'all', level: 0, search: '',
    scenario: null, session: null,
    busy: false, phrasesOpen: false, suggestions: null, suggesting: false,
    draft: '', listening: false,
    hist: { period: 'week', offset: 0 },
    report: null, reportLoading: false,
    installPrompt: null,
  };

  /* ---------- PWA 설치 도우미 ---------- */
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installHidden = () => { try { return localStorage.getItem('talkbuddy.installHidden') === '1'; } catch { return false; } };

  const main = $('#main');
  const modalRoot = $('#modal-root');

  /* ---------- 토스트 / 모달 ---------- */
  let toastTimer;
  function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg; el.className = `show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2800);
  }
  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog">${html}</div></div>`;
    $('.modal-backdrop').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
    $$('.modal-close', modalRoot).forEach(b => b.addEventListener('click', closeModal));
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  /* ---------- 음성 (TTS / STT) ---------- */
  const Speech = {
    voices: {},
    init() {
      if (!('speechSynthesis' in window)) return;
      const pick = () => {
        const all = speechSynthesis.getVoices();
        const en = all.filter(v => /^en(-|_)?(US|GB|AU)?/i.test(v.lang));
        this.voices.en = en.find(v => /female|samantha|zira|aria|jenny|google us/i.test(v.name)) || en.find(v => /en-US/i.test(v.lang)) || en[0] || null;
        const ja = all.filter(v => /^ja/i.test(v.lang));
        this.voices.ja = ja.find(v => /nanami|haruka|kyoko|o-ren|google/i.test(v.name)) || ja[0] || null;
      };
      pick(); speechSynthesis.onvoiceschanged = pick;
    },
    speak(text, lg = 'en') {
      if (!('speechSynthesis' in window) || !text) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (LANGS[lg] || LANGS.en).tts; u.rate = lg === 'ja' ? 0.85 : 0.88; u.pitch = 1.05;
      if (this.voices[lg]) u.voice = this.voices[lg];
      speechSynthesis.speak(u);
    },
    stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    canListen() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    rec: null,
    listen(onResult, onEnd, lg = 'en') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return false;
      this.stop();
      const rec = new SR();
      rec.lang = (LANGS[lg] || LANGS.en).tts; rec.interimResults = true; rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        onResult((finalText + ' ' + interim).trim(), false);
      };
      rec.onerror = e => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? '마이크 사용을 허용해 주세요.' : '음성 인식에 문제가 생겼어요.', 'error'); };
      rec.onend = () => { onResult(finalText.trim(), true); onEnd(); this.rec = null; };
      rec.start(); this.rec = rec;
      return true;
    },
    stopListening() { if (this.rec) { try { this.rec.stop(); } catch { /* ignore */ } } },
  };

  /* ---------- 데이터 도우미 ---------- */
  function sessionDuration(s) {
    const last = s.endedAt || (s.messages.length ? s.messages[s.messages.length - 1].at : s.startedAt);
    return Math.max(0, (last - s.startedAt) / 1000);
  }
  function userCount(s) { return s.messages.filter(m => m.role === 'user').length; }
  const curLang = () => { const l = Store.getSettings().lang; return LANGS[l] ? l : 'en'; };
  const sessLang = s => (s && LANGS[s.lang]) ? s.lang : 'en';
  const langTag = lg => `<span class="lang-flag">${LANGS[lg].flag} ${LANGS[lg].name}</span>`;
  function langToggle(dark = false) {
    const cur = curLang();
    return `<div class="lang-toggle ${dark ? 'dark' : ''}" role="group" aria-label="배우는 언어">${Object.values(LANGS).map(l => `<button type="button" class="${cur === l.code ? 'active' : ''}" data-lang="${l.code}">${l.flag} ${l.name}</button>`).join('')}</div>`;
  }
  const curStage = () => { const s = Store.getSettings().stage; return STAGES[s] ? s : 'elem'; };
  const sessStage = s => (s && STAGES[s.stage]) ? s.stage : 'elem';
  const stageTag = st => `<span class="lang-flag">${STAGES[st].emoji} ${STAGES[st].name}</span>`;
  function stageToggle(dark = false) {
    const cur = curStage();
    return `<div class="lang-toggle stage ${dark ? 'dark' : ''}" role="group" aria-label="학습 단계">${Object.values(STAGES).map(s => `<button type="button" class="${cur === s.code ? 'active' : ''}" data-stage="${s.code}" title="${esc(s.desc)}">${s.emoji} ${s.name}</button>`).join('')}</div>`;
  }
  function completedScenarioIds(lg = curLang()) {
    return new Set(Store.getHistory().filter(s => s.endedAt && sessLang(s) === lg).map(s => s.scenarioId));
  }
  function calcStreak() {
    const days = new Set(Store.getHistory().filter(s => userCount(s) > 0).map(s => startOfDay(s.startedAt).getTime()));
    if (!days.size) return 0;
    let streak = 0; let cursor = startOfDay(Date.now()).getTime();
    if (!days.has(cursor)) { cursor -= DAY; if (!days.has(cursor)) return 0; }
    while (days.has(cursor)) { streak++; cursor -= DAY; }
    return streak;
  }
  function todaySessions() { return Store.getHistory().filter(s => sameDay(s.startedAt, Date.now())); }

  /* ---------- 내비게이션 ---------- */
  function navigate(screen, patch = {}) {
    Object.assign(state, patch, { screen });
    if (screen !== 'chat') { Speech.stopListening(); }
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    const navActive = { chat: 'scenarios', report: 'scenarios' }[state.screen] || state.screen;
    $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === navActive));
    document.body.classList.toggle('in-chat', state.screen === 'chat');
    $('#btn-back').hidden = !['chat', 'report'].includes(state.screen) && !(state.screen === 'scenarios' && state.cat !== 'all');
    $('#streak-badge').textContent = `🔥 ${calcStreak()}일`;

    switch (state.screen) {
      case 'home':      renderHome(); break;
      case 'scenarios': renderScenarios(); break;
      case 'chat':      renderChat(); break;
      case 'report':    renderReport(); break;
      case 'history':   renderHistory(); break;
      case 'settings':  renderSettings(); break;
    }
  }

  /* ========================================================
     홈
  ======================================================== */
  function renderHome() {
    const settings = Store.getSettings();
    const today = todaySessions();
    const sentences = today.reduce((n, s) => n + userCount(s), 0);
    const minutes = Math.round(today.reduce((n, s) => n + sessionDuration(s), 0) / 60);
    const hour = new Date().getHours();
    const ln = LANGS[curLang()].name;
    const st = curStage();
    const formal = st === 'adult' || st === 'high';
    const hello = formal ? (settings.name ? `${esc(settings.name)}님, 안녕하세요!` : '안녕하세요!') : (settings.name ? `${esc(settings.name)}, 안녕!` : '안녕, 친구!');
    const sub = formal
      ? (hour < 12 ? `오늘은 어떤 상황을 ${ln}로 연습해 볼까요?` : hour < 18 ? `오후에도 ${ln} 한 장면 연습해 보세요.` : `하루를 마무리하며 ${ln}로 대화해 볼까요?`)
      : (hour < 12 ? `오늘은 어떤 상황에서 ${ln}로 말해 볼까?` : hour < 18 ? `오늘 오후도 ${ln}로 신나게 이야기해 보자!` : `하루를 마무리하며 ${ln} 한 마디 어때?`);
    const myScenarios = stageScenarios(st);
    const myCategories = stageCategories(st);

    const currentId = Store.getCurrentId();
    const current = currentId ? Store.getSession(currentId) : null;
    const resume = current && !current.endedAt && SCENARIO_MAP[current.scenarioId] ? current : null;

    // 추천 상황: 아직 안 해본 것 위주로 3개
    const done = completedScenarioIds();
    const pool = myScenarios.filter(s => !done.has(s.id));
    const picks = shuffle(pool.length >= 3 ? pool : myScenarios).slice(0, 3);

    main.innerHTML = `
      <section class="hero">
        <h1>${hello} 👋</h1>
        <p>${sub}</p>
        <div class="toggles" style="margin-top:12px">${langToggle()}${stageToggle()}</div>
        <div class="stats">
          <div class="stat"><b>${today.length}</b><span>오늘 대화</span></div>
          <div class="stat"><b>${sentences}</b><span>말한 문장</span></div>
          <div class="stat"><b>${minutes}</b><span>공부한 분</span></div>
        </div>
      </section>

      ${!API.hasKey() ? `
      <div class="card" style="margin-top:14px; display:flex; gap:12px; align-items:center;">
        <span style="font-size:30px">🔑</span>
        <div style="flex:1">
          <b>아직 데모 모드예요</b>
          <p><small>설정에서 OpenAI API 키를 넣으면 진짜 AI와 대화할 수 있어요.</small></p>
        </div>
        <button class="btn small accent" data-go="settings">설정</button>
      </div>` : ''}

      ${!isStandalone() && !installHidden() ? `
      <div class="card" style="margin-top:14px; display:flex; gap:12px; align-items:center;">
        <span style="font-size:30px">📱</span>
        <div style="flex:1">
          <b>휴대폰에 앱으로 설치하기</b>
          <p><small>${state.installPrompt ? '홈 화면에 아이콘이 생기고 전체 화면으로 열려요.' : isIOS() ? 'Safari 아래 <b>공유(⬆)</b> → <b>홈 화면에 추가</b>를 누르세요.' : 'Chrome 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누르세요.'}</small></p>
        </div>
        ${state.installPrompt ? `<button class="btn small" id="btn-install">설치</button>` : ''}
        <button class="icon-btn" id="btn-install-hide" aria-label="닫기" style="width:32px;height:32px;font-size:14px;box-shadow:none;background:transparent">✕</button>
      </div>` : ''}

      ${resume ? `
      <button class="card resume-card" data-resume="${resume.id}">
        <span class="emoji">${SCENARIO_MAP[resume.scenarioId].emoji}</span>
        <div class="grow" style="text-align:left">
          <b>이어서 하기</b>
          <p><small>${esc(SCENARIO_MAP[resume.scenarioId].title)} · ${userCount(resume)}문장 말했어요</small></p>
        </div>
        <span>▶</span>
      </button>` : ''}

      <h2 class="section-title">오늘의 추천 상황 <button class="link" data-go="scenarios">전체 보기 ›</button></h2>
      <div class="scn-grid">${picks.map(scenarioCard).join('')}</div>

      <h2 class="section-title">${STAGES[st].emoji} ${STAGES[st].name} 카테고리 <small>${myScenarios.length}개 상황</small></h2>
      <div class="cat-grid">
        ${myCategories.map(c => `
          <button class="cat-card" style="--c:${c.color}" data-cat="${c.id}">
            <span class="emoji">${c.emoji}</span>
            <b>${esc(c.name)}</b>
            <small>${myScenarios.filter(s => s.cat === c.id).length}개 상황</small>
          </button>`).join('')}
      </div>
    `;
    bindCommon();
    $$('[data-resume]').forEach(b => b.addEventListener('click', () => resumeSession(b.dataset.resume)));
    const inst = $('#btn-install');
    if (inst) inst.addEventListener('click', async () => {
      const p = state.installPrompt; if (!p) return;
      p.prompt();
      const { outcome } = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
      if (outcome === 'accepted') { state.installPrompt = null; toast('설치했어요! 홈 화면에서 열어 보세요 📱', 'ok'); render(); }
    });
    const hide = $('#btn-install-hide');
    if (hide) hide.addEventListener('click', () => { try { localStorage.setItem('talkbuddy.installHidden', '1'); } catch { /* ignore */ } render(); });
  }

  function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function scenarioCard(s) {
    const c = CATEGORY_MAP[s.cat];
    const done = completedScenarioIds().has(s.id);
    const lc = localize(s, curLang());
    return `
      <button class="scn-card" style="--c:${c.color}" data-scn="${s.id}">
        ${done ? '<span class="done-badge">완료 ✓</span>' : ''}
        <span class="emoji">${s.emoji}</span>
        <b>${esc(s.title)}</b>
        <small>${esc(lc.subtitle)}</small>
        <span class="level" title="난이도 ${s.level}">${[1, 2, 3].map(n => `<i class="${n <= s.level ? 'on' : ''}"></i>`).join('')}</span>
      </button>`;
  }

  function bindCommon() {
    $$('[data-stage]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.stage === curStage()) return;
      Store.saveSettings({ stage: b.dataset.stage });
      state.cat = 'all'; state.search = '';
      toast(`${STAGES[b.dataset.stage].emoji} ${STAGES[b.dataset.stage].name} 단계로 바꿨어요`, 'ok');
      render();
    }));
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.lang === curLang()) return;
      Store.saveSettings({ lang: b.dataset.lang });
      toast(`${LANGS[b.dataset.lang].flag} ${LANGS[b.dataset.lang].name}로 배워요!`, 'ok');
      render();
    }));
    $$('[data-go]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));
    $$('[data-cat]').forEach(b => b.addEventListener('click', () => navigate('scenarios', { cat: b.dataset.cat, search: '' })));
    $$('[data-scn]').forEach(b => b.addEventListener('click', () => openScenarioModal(b.dataset.scn)));
  }

  /* ========================================================
     상황 목록
  ======================================================== */
  function renderScenarios() {
    const q = state.search.trim().toLowerCase();
    const st = curStage();
    const mine = stageScenarios(st);
    if (state.cat !== 'all' && (!CATEGORY_MAP[state.cat] || CATEGORY_MAP[state.cat].stage !== st)) state.cat = 'all';
    const hay = s => (s.title + s.en + localize(s, curLang()).subtitle + s.situation + s.missions.join(' ')).toLowerCase();
    let list = mine.filter(s => state.cat === 'all' || s.cat === state.cat);
    if (state.level) list = list.filter(s => s.level === state.level);
    if (q) list = list.filter(s => hay(s).includes(q));
    const cat = state.cat === 'all' ? null : CATEGORY_MAP[state.cat];

    main.innerHTML = `
      <h2 class="section-title">${cat ? `${cat.emoji} ${esc(cat.name)}` : `🎭 ${STAGES[st].name} 모든 상황`} <small>${list.length}개</small></h2>
      ${cat ? `<p style="margin:-6px 0 10px"><small>${esc(cat.desc)}</small></p>` : ''}
      <div class="toggles" style="margin:0 0 10px">${langToggle(true)}${stageToggle(true)}</div>
      <div class="chips">
        <button class="chip ${state.cat === 'all' ? 'active' : ''}" data-chip="all">전체</button>
        ${stageCategories(st).map(c => `<button class="chip ${state.cat === c.id ? 'active' : ''}" data-chip="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join('')}
      </div>
      <div class="search">
        <input id="search" type="search" placeholder="🔍 상황 검색 (예: 주문, 친구, 병원)" value="${esc(state.search)}">
        <select id="level">
          <option value="0" ${state.level === 0 ? 'selected' : ''}>난이도 전체</option>
          <option value="1" ${state.level === 1 ? 'selected' : ''}>● 쉬움</option>
          <option value="2" ${state.level === 2 ? 'selected' : ''}>●● 보통</option>
          <option value="3" ${state.level === 3 ? 'selected' : ''}>●●● 도전</option>
        </select>
      </div>
      ${list.length ? `<div class="scn-grid">${list.map(scenarioCard).join('')}</div>` : `<div class="empty">🔎 조건에 맞는 상황이 없어요.</div>`}
    `;
    $$('[data-chip]').forEach(b => b.addEventListener('click', () => { state.cat = b.dataset.chip; render(); }));
    const search = $('#search');
    search.addEventListener('input', () => {
      state.search = search.value;
      // 입력 유지하면서 목록만 갱신
      const grid = $('.scn-grid') || $('.empty');
      const q2 = state.search.trim().toLowerCase();
      let l2 = mine.filter(s => state.cat === 'all' || s.cat === state.cat);
      if (state.level) l2 = l2.filter(s => s.level === state.level);
      if (q2) l2 = l2.filter(s => hay(s).includes(q2));
      const html = l2.length ? `<div class="scn-grid">${l2.map(scenarioCard).join('')}</div>` : `<div class="empty">🔎 조건에 맞는 상황이 없어요.</div>`;
      grid.outerHTML = html;
      $('.section-title small').textContent = `${l2.length}개`;
      bindCommon();
    });
    $('#level').addEventListener('change', e => { state.level = Number(e.target.value); render(); });
    bindCommon();
  }

  /* ---------- 상황 상세 모달 ---------- */
  function openScenarioModal(id) {
    const s = SCENARIO_MAP[id]; const c = CATEGORY_MAP[s.cat];
    const lg = curLang(); const lc = localize(s, lg);
    const past = Store.getHistory().filter(h => h.scenarioId === id && h.endedAt && sessLang(h) === lg);
    const best = past.reduce((m, h) => Math.max(m, h.report && h.report.stars || 0), 0);
    openModal(`
      <div class="modal-head">
        <span class="emoji">${s.emoji}</span>
        <div><h2>${esc(s.title)}</h2><small>${esc(lc.subtitle)}</small></div>
        <button class="modal-close" aria-label="닫기">✕</button>
      </div>
      <div class="info-row" style="align-items:center">
        ${langToggle(true)}
        ${stageTag(s.stage || 'elem')}
        <span class="pill" style="border-left:5px solid ${c.color}">${c.emoji} ${esc(c.name)}</span>
        <span class="pill">난이도 ${'●'.repeat(s.level)}${'○'.repeat(3 - s.level)}</span>
        ${past.length ? `<span class="pill">🏅 ${past.length}번 완료 · 최고 ${'⭐'.repeat(best)}</span>` : ''}
      </div>
      <div class="card">
        <p>${esc(s.situation)}</p>
        <p style="margin-top:8px"><small>🤖 AI 역할: <b>${esc(lc.ai)}</b> &nbsp;|&nbsp; 🙋 내 역할: <b>${esc(s.user)}</b></small></p>
      </div>
      <h3 class="section-title" style="font-size:16px">🎯 미션</h3>
      <div class="list">${s.missions.map((m, i) => `<div class="list-item"><span class="num">${i + 1}</span><span>${esc(m)}</span></div>`).join('')}</div>
      <h3 class="section-title" style="font-size:16px">💬 유용한 표현 ${LANGS[lg].flag}</h3>
      <div class="list">${lc.phrases.map(([en, ko]) => `
        <div class="list-item">
          <div class="phrase"><b>${esc(en)}</b><small>${esc(ko)}</small></div>
          <button class="speak-btn" data-say="${esc(en)}" aria-label="듣기">🔊</button>
        </div>`).join('')}</div>
      <div style="margin-top:18px">
        <button class="btn full" id="btn-start">🚀 ${LANGS[lg].name}로 대화 시작하기</button>
      </div>
    `);
    $$('[data-say]', modalRoot).forEach(b => b.addEventListener('click', () => Speech.speak(b.dataset.say, lg)));
    $$('[data-lang]', modalRoot).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.lang === curLang()) return;
      Store.saveSettings({ lang: b.dataset.lang }); render(); openScenarioModal(id);
    }));
    $('#btn-start').addEventListener('click', () => { closeModal(); startScenario(id); });
  }

  /* ========================================================
     채팅
  ======================================================== */
  function startScenario(id) {
    const s = SCENARIO_MAP[id];
    const lg = curLang(); const lc = localize(s, lg);
    const session = {
      id: uid(), scenarioId: id, lang: lg, stage: s.stage || 'elem', startedAt: Date.now(), endedAt: null,
      messages: [{ role: 'ai', text: lc.opener, at: Date.now() }],
      missionsDone: [], report: null, demo: !API.hasKey(),
    };
    Store.saveSession(session); Store.setCurrentId(session.id);
    navigate('chat', { scenario: s, session, phrasesOpen: false, suggestions: null, draft: '', busy: false });
    if (Store.getSettings().autoSpeak) setTimeout(() => Speech.speak(lc.opener, lg), 300);
  }
  function resumeSession(id) {
    const session = Store.getSession(id); if (!session) return;
    const s = SCENARIO_MAP[session.scenarioId]; if (!s) return;
    Store.setCurrentId(id);
    navigate('chat', { scenario: s, session, phrasesOpen: false, suggestions: null, draft: '', busy: false });
  }

  function renderChat() {
    const s = state.scenario, ss = state.session;
    const lg = sessLang(ss), lc = localize(s, lg);
    const allDone = ss.missionsDone.length >= s.missions.length;
    const settings = Store.getSettings();

    main.innerHTML = `
      <section class="chat">
        <div class="chat-head">
          <span class="emoji">${s.emoji}</span>
          <div class="title">
            <b>${LANGS[lg].flag} ${esc(s.title)} ${ss.demo ? '<span class="demo-tag">데모</span>' : ''}</b>
            <small>🤖 ${esc(lc.ai)} · 🙋 ${esc(s.user)}</small>
          </div>
          <button class="btn small ghost" id="btn-end">끝내기</button>
        </div>
        <div class="missions">
          ${s.missions.map((m, i) => `<span class="mission ${ss.missionsDone.includes(i + 1) ? 'done' : ''}">${ss.missionsDone.includes(i + 1) ? '✅' : '⬜'} ${esc(m)}</span>`).join('')}
        </div>
        <div class="messages" id="messages">
          ${ss.messages.map((m, i) => renderMessage(m, i, settings)).join('')}
          ${state.busy ? `<div class="msg ai"><div class="bubble typing"><i></i><i></i><i></i></div></div>` : ''}
          ${allDone && !state.busy ? `<div class="all-done"><span style="font-size:28px">🎉</span><div class="grow">미션을 모두 완료했어요!<br><small style="color:#e8ffef">대화를 마치고 결과를 볼까요? 더 이야기해도 좋아요.</small></div><button class="btn small ghost" id="btn-finish">결과 보기</button></div>` : ''}
        </div>
        <div class="chat-tools">
          <button class="tool ${state.suggestions ? 'active' : ''}" id="btn-suggest">💡 뭐라고 말할까?</button>
          <button class="tool ${state.phrasesOpen ? 'active' : ''}" id="btn-phrases">📖 유용한 표현</button>
          <button class="tool" id="btn-mission">🎯 미션 보기</button>
          <button class="tool" id="btn-replay">🔊 다시 듣기</button>
        </div>
        ${state.suggestions ? `
          <div class="panel">
            <div class="panel-title">이렇게 말해 볼까요? (눌러서 넣기)</div>
            ${state.suggestions.length ? state.suggestions.map(x => `
              <button class="sug" data-fill="${esc(x.en)}">
                <div class="phrase"><b>${esc(x.en)}</b><small>${esc(x.ko)}</small></div>
                <span class="speak-btn" data-say="${esc(x.en)}">🔊</span>
              </button>`).join('') : '<small>추천을 가져오지 못했어요.</small>'}
          </div>` : ''}
        ${state.phrasesOpen ? `
          <div class="panel">
            <div class="panel-title">이 상황에서 쓰는 표현 (눌러서 넣기)</div>
            ${lc.phrases.map(([en, ko]) => `
              <button class="sug" data-fill="${esc(en)}">
                <div class="phrase"><b>${esc(en)}</b><small>${esc(ko)}</small></div>
                <span class="speak-btn" data-say="${esc(en)}">🔊</span>
              </button>`).join('')}
          </div>` : ''}
        <form class="composer" id="composer" autocomplete="off">
          <button type="button" class="round mic ${state.listening ? 'on' : ''}" id="btn-mic" aria-label="말하기" ${Speech.canListen() ? '' : 'hidden'}>🎤</button>
          <input id="input" type="text" placeholder="${state.listening ? `듣고 있어요... ${LANGS[lg].name}로 말해 보세요` : LANGS[lg].say}" value="${esc(state.draft)}" ${state.busy ? 'disabled' : ''} maxlength="300">
          <button type="submit" class="round send" aria-label="보내기" ${state.busy ? 'disabled' : ''}>➤</button>
        </form>
      </section>
    `;

    const box = $('#messages'); box.scrollTop = box.scrollHeight;
    const input = $('#input');
    if (!state.busy && !('ontouchstart' in window)) input.focus();
    input.addEventListener('input', () => { state.draft = input.value; });

    $('#composer').addEventListener('submit', e => { e.preventDefault(); sendMessage(input.value); });
    $('#btn-end').addEventListener('click', confirmEnd);
    const fin = $('#btn-finish'); if (fin) fin.addEventListener('click', endSession);
    $('#btn-suggest').addEventListener('click', toggleSuggestions);
    $('#btn-phrases').addEventListener('click', () => { state.phrasesOpen = !state.phrasesOpen; state.suggestions = null; render(); });
    $('#btn-mission').addEventListener('click', () => openScenarioInfo());
    $('#btn-replay').addEventListener('click', () => { const last = [...ss.messages].reverse().find(m => m.role === 'ai'); if (last) Speech.speak(last.text, lg); });
    $$('[data-fill]').forEach(b => b.addEventListener('click', e => {
      if (e.target.closest('[data-say]')) return;
      state.draft = b.dataset.fill; input.value = state.draft; input.focus();
    }));
    $$('[data-say]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); Speech.speak(b.dataset.say, lg); }));
    $$('[data-ko]').forEach(b => b.addEventListener('click', () => toggleKo(Number(b.dataset.ko))));
    const mic = $('#btn-mic'); if (mic) mic.addEventListener('click', toggleMic);
  }

  function renderMessage(m, i, settings) {
    if (m.role === 'user') {
      return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
    }
    const showKo = m.koOpen || (settings.showKoHint && m.ko);
    return `
      <div class="msg ai">
        <div class="bubble">${esc(m.text)}</div>
        ${showKo && m.ko ? `<div class="ko">🇰🇷 ${esc(m.ko)}</div>` : ''}
        <div class="meta">
          <button data-say="${esc(m.text)}">🔊 듣기</button>
          <button data-ko="${i}">${m.koLoading ? '⏳' : (showKo && m.ko ? '🙈 뜻 숨기기' : '🇰🇷 뜻 보기')}</button>
        </div>
      </div>
      ${m.tip ? `<div class="tip"><b>💡 선생님 팁</b>${esc(m.tip)}</div>` : ''}`;
  }

  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || state.busy) return;
    const ss = state.session, s = state.scenario;
    Speech.stopListening(); Speech.stop();
    ss.messages.push({ role: 'user', text, at: Date.now() });
    state.draft = ''; state.suggestions = null; state.busy = true;
    Store.saveSession(ss);
    render();

    try {
      const r = await API.reply(s, ss);
      const msg = { role: 'ai', text: r.text, at: Date.now(), tip: r.tip || null };
      ss.messages.push(msg);
      for (const n of r.missions) if (n >= 1 && n <= s.missions.length && !ss.missionsDone.includes(n)) ss.missionsDone.push(n);
      ss.missionsDone.sort();
      Store.saveSession(ss);
      state.busy = false;
      render();
      if (Store.getSettings().autoSpeak) Speech.speak(r.text, sessLang(ss));
      if (r.missions.length) toast(`🎯 미션 ${r.missions.join(', ')} 완료!`, 'ok');
    } catch (e) {
      state.busy = false;
      if (e.message === 'NO_KEY') { toast('설정에서 API 키를 입력해 주세요.', 'error'); }
      else toast(e.message, 'error');
      // 실패한 사용자 메시지는 입력창으로 되돌림
      const lastUser = ss.messages[ss.messages.length - 1];
      if (lastUser && lastUser.role === 'user') { ss.messages.pop(); state.draft = lastUser.text; Store.saveSession(ss); }
      render();
    }
  }

  async function toggleKo(i) {
    const m = state.session.messages[i];
    if (!m || m.role !== 'ai') return;
    if (m.ko) { m.koOpen = !m.koOpen; Store.saveSession(state.session); render(); return; }
    m.koLoading = true; render();
    try { m.ko = await API.translate(m.text, sessLang(state.session), sessStage(state.session)); m.koOpen = true; }
    catch (e) { toast(e.message === 'NO_KEY' ? '설정에서 API 키를 입력해 주세요.' : e.message, 'error'); }
    m.koLoading = false; Store.saveSession(state.session); render();
  }

  async function toggleSuggestions() {
    if (state.suggestions) { state.suggestions = null; render(); return; }
    if (state.suggesting) return;
    state.suggesting = true; state.phrasesOpen = false;
    const btn = $('#btn-suggest'); if (btn) { btn.textContent = '⏳ 생각 중...'; btn.disabled = true; }
    try { state.suggestions = await API.suggest(state.scenario, state.session); }
    catch (e) { toast(e.message === 'NO_KEY' ? '설정에서 API 키를 입력해 주세요.' : e.message, 'error'); }
    state.suggesting = false; render();
  }

  function toggleMic() {
    if (state.listening) { Speech.stopListening(); return; }
    Speech.stop();
    const ok = Speech.listen((text, isFinal) => {
      state.draft = text; const input = $('#input'); if (input) input.value = text;
      if (isFinal && text) { /* 사용자가 확인 후 보내도록 입력창에만 넣음 */ }
    }, () => { state.listening = false; render(); }, sessLang(state.session));
    if (ok) { state.listening = true; render(); } else toast('이 브라우저는 음성 인식을 지원하지 않아요. (Chrome/Edge 추천)', 'error');
  }

  function openScenarioInfo() {
    const s = state.scenario, ss = state.session, lc = localize(s, sessLang(ss));
    openModal(`
      <div class="modal-head"><span class="emoji">${s.emoji}</span><div><h2>${esc(s.title)}</h2><small>${esc(lc.subtitle)}</small></div><button class="modal-close">✕</button></div>
      <div class="card"><p>${esc(s.situation)}</p><p style="margin-top:8px"><small>🤖 ${esc(lc.ai)} &nbsp;|&nbsp; 🙋 ${esc(s.user)}</small></p></div>
      <h3 class="section-title" style="font-size:16px">🎯 미션</h3>
      <div class="list">${s.missions.map((m, i) => `<div class="list-item"><span class="num" style="${ss.missionsDone.includes(i + 1) ? 'background:var(--ok)' : ''}">${ss.missionsDone.includes(i + 1) ? '✓' : i + 1}</span><span>${esc(m)}</span></div>`).join('')}</div>
      <p style="margin-top:14px"><small>💡 막히면 "뭐라고 말할까?" 버튼을 눌러 보세요. 한국어로 써도 AI가 영어로 어떻게 말하는지 알려 줘요.</small></p>
    `);
  }

  function confirmEnd() {
    const ss = state.session;
    if (userCount(ss) === 0) {
      // 아무 말도 안 했으면 기록 남기지 않고 나감
      Store.deleteSession(ss.id); Store.setCurrentId(null);
      navigate('scenarios'); return;
    }
    openModal(`
      <div class="modal-head"><span class="emoji">🏁</span><div><h2>대화를 마칠까요?</h2><small>미션 ${ss.missionsDone.length}/${state.scenario.missions.length} 완료 · ${userCount(ss)}문장 말했어요</small></div><button class="modal-close">✕</button></div>
      <p style="margin:12px 0">결과 리포트에서 잘한 점과 더 좋은 표현을 볼 수 있어요.</p>
      <div class="report-actions">
        <button class="btn ok" id="m-finish">✅ 마치고 결과 보기</button>
        <button class="btn ghost" id="m-later">💾 저장하고 나중에 이어서 하기</button>
        <button class="btn ghost modal-close">↩ 계속 대화하기</button>
      </div>
    `);
    $('#m-finish').addEventListener('click', () => { closeModal(); endSession(); });
    $('#m-later').addEventListener('click', () => { closeModal(); Store.saveSession(ss); navigate('home'); });
  }

  async function endSession() {
    const ss = state.session, s = state.scenario;
    Speech.stop(); Speech.stopListening();
    ss.endedAt = Date.now(); Store.saveSession(ss); Store.setCurrentId(null);
    state.reportLoading = true; state.report = null;
    navigate('report');
    try { ss.report = await API.report(s, ss); }
    catch (e) { toast(e.message === 'NO_KEY' ? '설정에서 API 키를 입력해 주세요.' : e.message, 'error'); ss.report = { stars: 3, praise: '열심히 대화했어요! (리포트를 가져오지 못했어요)', corrections: [], words: [], nextTip: '' }; }
    Store.saveSession(ss);
    state.reportLoading = false; render();
  }

  /* ========================================================
     결과 리포트
  ======================================================== */
  function renderReport() {
    const s = state.scenario, ss = state.session, r = ss.report, lg = sessLang(ss);
    if (state.reportLoading || !r) {
      main.innerHTML = `<div class="report-hero"><div class="big">📝</div><h2>선생님이 대화를 살펴보고 있어요...</h2><p style="margin-top:8px"><small>잠깐만 기다려 주세요</small></p><div class="typing" style="justify-content:center;margin-top:10px"><i></i><i></i><i></i></div></div>`;
      return;
    }
    const stars = [1, 2, 3, 4, 5].map(n => `<span class="${n <= r.stars ? '' : 'off'}">⭐</span>`).join('');
    main.innerHTML = `
      <div class="report-hero">
        <div class="big">${r.stars >= 4 ? '🏆' : r.stars >= 3 ? '👏' : '💪'}</div>
        <h2>${esc(s.title)} 완료!</h2>
        <div class="stars">${stars}</div>
        <div class="info-row" style="justify-content:center">
          ${langTag(lg)}
          <span class="pill">🎯 미션 ${ss.missionsDone.length}/${s.missions.length}</span>
          <span class="pill">💬 ${userCount(ss)}문장</span>
          <span class="pill">⏱ ${fmtDur(sessionDuration(ss))}</span>
        </div>
      </div>
      <div class="card"><b>🌟 잘한 점</b><p style="margin-top:6px">${esc(r.praise)}</p></div>

      ${r.corrections && r.corrections.length ? `
        <h3 class="section-title" style="font-size:16px">✏️ 이렇게 말하면 더 좋아요</h3>
        <div class="list">${r.corrections.map(c => `
          <div class="list-item"><div class="corr">
            <span class="orig">${esc(c.original)}</span>
            <span class="better">→ ${esc(c.better)}</span>
            <small>${esc(c.why)}</small>
          </div><button class="speak-btn" data-say="${esc(c.better)}">🔊</button></div>`).join('')}</div>` :
        `<div class="card" style="margin-top:10px"><b>✨ 고칠 부분이 없어요!</b><p><small>문장을 아주 잘 만들었어요.</small></p></div>`}

      ${r.words && r.words.length ? `
        <h3 class="section-title" style="font-size:16px">📚 오늘 배운 표현</h3>
        <div class="word-grid">${r.words.map(w => `<div class="word"><div><b>${esc(w.en)}</b><br><small>${esc(w.ko)}</small></div><button class="speak-btn" data-say="${esc(w.en)}">🔊</button></div>`).join('')}</div>` : ''}

      ${r.nextTip ? `<div class="card" style="margin-top:14px;background:#EEF3FF"><b>🧭 다음 연습 팁</b><p style="margin-top:4px">${esc(r.nextTip)}</p></div>` : ''}

      <div class="report-actions">
        <button class="btn" id="r-again">🔁 같은 상황 다시 하기</button>
        <button class="btn accent" id="r-other">🎭 다른 상황 고르기</button>
        <button class="btn ghost" id="r-history">📊 기록 보기</button>
      </div>
    `;
    $$('[data-say]').forEach(b => b.addEventListener('click', () => Speech.speak(b.dataset.say, lg)));
    $('#r-again').addEventListener('click', () => { Store.saveSettings({ lang: lg }); startScenario(s.id); });
    $('#r-other').addEventListener('click', () => navigate('scenarios'));
    $('#r-history').addEventListener('click', () => navigate('history'));
  }

  /* ========================================================
     기록 (하루 / 일주일 / 한 달 / 전체)
  ======================================================== */
  function periodRange(period, offset) {
    const now = new Date();
    if (period === 'day') {
      const start = startOfDay(now); start.setDate(start.getDate() + offset);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const label = offset === 0 ? '오늘' : offset === -1 ? '어제' : `${start.getMonth() + 1}월 ${start.getDate()}일 (${WEEKDAYS[start.getDay()]})`;
      return { start, end, label };
    }
    if (period === 'week') {
      const start = startOfDay(now);
      const dow = (start.getDay() + 6) % 7; // 월요일 시작
      start.setDate(start.getDate() - dow + offset * 7);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const last = new Date(end - 1);
      const label = offset === 0 ? '이번 주' : offset === -1 ? '지난 주' : `${start.getMonth() + 1}/${start.getDate()} ~ ${last.getMonth() + 1}/${last.getDate()}`;
      return { start, end, label, sub: `${start.getMonth() + 1}/${start.getDate()} ~ ${last.getMonth() + 1}/${last.getDate()}` };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
      const label = offset === 0 ? '이번 달' : offset === -1 ? '지난 달' : `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
      return { start, end, label, sub: `${start.getFullYear()}년 ${start.getMonth() + 1}월` };
    }
    return { start: new Date(0), end: new Date(8.64e15), label: '전체 기간' };
  }

  function buildChart(period, range, sessions) {
    const buckets = [];
    const now = Date.now();
    if (period === 'day') {
      for (let h = 0; h < 24; h += 3) buckets.push({ label: `${h}시`, from: +range.start + h * 3600000, to: +range.start + (h + 3) * 3600000 });
    } else if (period === 'week') {
      for (let i = 0; i < 7; i++) { const d = new Date(range.start); d.setDate(d.getDate() + i); buckets.push({ label: WEEKDAYS[d.getDay()], from: +d, to: +d + DAY, today: sameDay(d, now) }); }
    } else if (period === 'month') {
      const days = Math.round((range.end - range.start) / DAY);
      for (let i = 0; i < days; i++) { const d = new Date(range.start); d.setDate(d.getDate() + i); buckets.push({ label: (i % 5 === 0 || i === days - 1) ? String(i + 1) : '', from: +d, to: +d + DAY, today: sameDay(d, now) }); }
    } else {
      // 전체: 최근 12개월
      for (let i = 11; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - i);
        const e = new Date(d); e.setMonth(e.getMonth() + 1);
        buckets.push({ label: `${d.getMonth() + 1}월`, from: +d, to: +e, today: i === 0 });
      }
    }
    for (const b of buckets) b.count = sessions.filter(s => s.startedAt >= b.from && s.startedAt < b.to).reduce((n, s) => n + userCount(s), 0);
    const max = Math.max(1, ...buckets.map(b => b.count));
    return `<div class="chart" aria-label="기간별 말한 문장 수">${buckets.map(b => `
      <div class="bar" title="${b.count}문장">
        ${b.count ? `<em>${b.count}</em>` : ''}
        <i class="${b.count ? '' : 'zero'} ${b.today ? 'today' : ''}" style="height:${b.count ? Math.max(6, Math.round(b.count / max * 80)) : 3}px"></i>
        <span>${b.label}</span>
      </div>`).join('')}</div>`;
  }

  function renderHistory() {
    const { period, offset } = state.hist;
    const hl = state.hist.lang || 'all';
    const hs = state.hist.stage || 'all';
    const range = periodRange(period, offset);
    const all = Store.getHistory().filter(s => userCount(s) > 0 && (hl === 'all' || sessLang(s) === hl) && (hs === 'all' || sessStage(s) === hs)).sort((a, b) => b.startedAt - a.startedAt);
    const list = all.filter(s => s.startedAt >= +range.start && s.startedAt < +range.end);

    const sentences = list.reduce((n, s) => n + userCount(s), 0);
    const minutes = Math.round(list.reduce((n, s) => n + sessionDuration(s), 0) / 60);
    const finished = list.filter(s => s.endedAt);
    const uniq = new Set(finished.map(s => s.scenarioId)).size;
    const stars = finished.reduce((n, s) => n + (s.report && s.report.stars || 0), 0);
    const missions = list.reduce((n, s) => n + (s.missionsDone || []).length, 0);

    // 카테고리별 분포
    const byCat = {};
    for (const s of list) { const c = SCENARIO_MAP[s.scenarioId] && SCENARIO_MAP[s.scenarioId].cat; if (c) byCat[c] = (byCat[c] || 0) + 1; }
    const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);

    main.innerHTML = `
      <h2 class="section-title">📊 나의 대화 기록</h2>
      <div class="chips" style="padding-top:0">
        ${[['all', '🌐 전체 언어'], ['en', '🇺🇸 영어'], ['ja', '🇯🇵 일본어']].map(([k, n]) => `<button class="chip ${hl === k ? 'active' : ''}" data-hlang="${k}">${n}</button>`).join('')}
      </div>
      <div class="chips" style="padding-top:0">
        <button class="chip ${hs === 'all' ? 'active' : ''}" data-hstage="all">📚 전체 단계</button>
        ${Object.values(STAGES).map(s => `<button class="chip ${hs === s.code ? 'active' : ''}" data-hstage="${s.code}">${s.emoji} ${s.name}</button>`).join('')}
      </div>
      <div class="seg">
        ${[['day', '하루'], ['week', '일주일'], ['month', '한 달'], ['all', '전체']].map(([k, n]) => `<button class="${period === k ? 'active' : ''}" data-period="${k}">${n}</button>`).join('')}
      </div>
      <div class="range-nav">
        <button class="icon-btn" id="h-prev" ${period === 'all' ? 'disabled' : ''}>‹</button>
        <div style="text-align:center"><b>${esc(range.label)}</b>${range.sub ? `<br><small>${esc(range.sub)}</small>` : ''}</div>
        <button class="icon-btn" id="h-next" ${period === 'all' || offset >= 0 ? 'disabled' : ''}>›</button>
      </div>

      <div class="stat-grid">
        <div class="stat-tile"><b>${list.length}</b><small>💬 대화 횟수</small></div>
        <div class="stat-tile"><b>${sentences}</b><small>✏️ 내가 말한 문장</small></div>
        <div class="stat-tile"><b>${minutes}분</b><small>⏱ 공부한 시간</small></div>
        <div class="stat-tile"><b>${uniq}</b><small>🎭 완료한 상황 (종류)</small></div>
        <div class="stat-tile"><b>${missions}</b><small>🎯 완료한 미션</small></div>
        <div class="stat-tile"><b>${stars}</b><small>⭐ 받은 별</small></div>
      </div>

      <div class="card" style="margin-top:12px">
        <b style="font-size:14px">${period === 'day' ? '시간대별' : period === 'week' ? '요일별' : period === 'month' ? '날짜별' : '월별'} 말한 문장 수</b>
        ${buildChart(period, range, list)}
      </div>

      ${catRows.length ? `
      <div class="card" style="margin-top:12px">
        <b style="font-size:14px">많이 연습한 카테고리</b>
        <div class="list">${catRows.map(([cid, n]) => { const c = CATEGORY_MAP[cid]; return `<div class="list-item" style="padding:8px 12px"><span>${c.emoji}</span><span style="flex:1">${esc(c.name)}</span><b>${n}회</b></div>`; }).join('')}</div>
      </div>` : ''}

      <h2 class="section-title">대화 목록 <small>${list.length}개</small></h2>
      ${list.length ? `<div class="list">${list.map(histItem).join('')}</div>` : `<div class="empty">아직 이 기간에는 대화가 없어요.<br>새로운 상황을 골라 시작해 보세요! 🎭<br><br><button class="btn" data-go="scenarios">상황 고르기</button></div>`}
    `;
    $$('[data-period]').forEach(b => b.addEventListener('click', () => { state.hist = { period: b.dataset.period, offset: 0, lang: hl, stage: hs }; render(); }));
    $$('[data-hlang]').forEach(b => b.addEventListener('click', () => { state.hist.lang = b.dataset.hlang; render(); }));
    $$('[data-hstage]').forEach(b => b.addEventListener('click', () => { state.hist.stage = b.dataset.hstage; render(); }));
    $('#h-prev').addEventListener('click', () => { state.hist.offset--; render(); });
    $('#h-next').addEventListener('click', () => { state.hist.offset++; render(); });
    $$('[data-hist]').forEach(b => b.addEventListener('click', () => openHistoryModal(b.dataset.hist)));
    bindCommon();
  }

  function histItem(s) {
    const sc = SCENARIO_MAP[s.scenarioId]; if (!sc) return '';
    const stars = s.report && s.report.stars ? '⭐'.repeat(s.report.stars) : (s.endedAt ? '' : '진행 중');
    return `
      <button class="card hist-item" data-hist="${s.id}" style="padding:12px 14px">
        <span class="emoji">${sc.emoji}</span>
        <div class="grow">
          <b>${LANGS[sessLang(s)].flag} ${esc(sc.title)}</b>
          <small>${STAGES[sessStage(s)].emoji} ${STAGES[sessStage(s)].name} · ${fmtDate(s.startedAt)} ${fmtTime(s.startedAt)} · ${userCount(s)}문장 · ${fmtDur(sessionDuration(s))} · 미션 ${(s.missionsDone || []).length}/${sc.missions.length}</small>
        </div>
        <div class="right">${stars}${s.demo ? '<br><small>데모</small>' : ''}</div>
      </button>`;
  }

  function openHistoryModal(id) {
    const s = Store.getSession(id); if (!s) return;
    const sc = SCENARIO_MAP[s.scenarioId]; const r = s.report;
    openModal(`
      <div class="modal-head">
        <span class="emoji">${sc.emoji}</span>
        <div><h2>${LANGS[sessLang(s)].flag} ${esc(sc.title)}</h2><small>${fmtDate(s.startedAt)} ${fmtTime(s.startedAt)} · ${fmtDur(sessionDuration(s))} · 미션 ${(s.missionsDone || []).length}/${sc.missions.length}</small></div>
        <button class="modal-close">✕</button>
      </div>
      ${r ? `<div class="card" style="margin-top:10px"><div class="stars" style="font-size:22px;margin:0 0 6px">${[1, 2, 3, 4, 5].map(n => `<span class="${n <= r.stars ? '' : 'off'}">⭐</span>`).join('')}</div><p>${esc(r.praise)}</p>
        ${r.corrections && r.corrections.length ? `<div class="list" style="margin-top:10px">${r.corrections.map(c => `<div class="list-item"><div class="corr"><span class="orig">${esc(c.original)}</span><span class="better">→ ${esc(c.better)}</span><small>${esc(c.why)}</small></div></div>`).join('')}</div>` : ''}
        ${r.words && r.words.length ? `<p style="margin-top:10px"><small>📚 ${r.words.map(w => `<b>${esc(w.en)}</b> ${esc(w.ko)}`).join(' · ')}</small></p>` : ''}
      </div>` : `<div class="card" style="margin-top:10px"><small>아직 끝나지 않은 대화예요.</small></div>`}
      <h3 class="section-title" style="font-size:16px">대화 내용</h3>
      <div class="transcript">${s.messages.map(m => `<div class="msg ${m.role}"><div class="bubble">${esc(m.text)}</div>${m.role === 'ai' && m.ko ? `<div class="ko">🇰🇷 ${esc(m.ko)}</div>` : ''}</div>${m.tip ? `<div class="tip"><b>💡 선생님 팁</b>${esc(m.tip)}</div>` : ''}`).join('')}</div>
      <div class="report-actions">
        ${!s.endedAt ? `<button class="btn ok" id="hm-resume">▶ 이어서 하기</button>` : `<button class="btn" id="hm-again">🔁 이 상황 다시 하기</button>`}
        <button class="btn ghost danger-zone" id="hm-delete" style="color:var(--danger)">🗑 이 기록 지우기</button>
      </div>
    `);
    const again = $('#hm-again'); if (again) again.addEventListener('click', () => { closeModal(); Store.saveSettings({ lang: sessLang(s) }); startScenario(sc.id); });
    const resume = $('#hm-resume'); if (resume) resume.addEventListener('click', () => { closeModal(); resumeSession(s.id); });
    $('#hm-delete').addEventListener('click', () => {
      if (confirm('이 대화 기록을 지울까요?')) { Store.deleteSession(s.id); if (Store.getCurrentId() === s.id) Store.setCurrentId(null); closeModal(); render(); toast('기록을 지웠어요.'); }
    });
  }

  /* ========================================================
     설정
  ======================================================== */
  function renderSettings() {
    const st = Store.getSettings();
    const total = Store.getHistory().length;
    main.innerHTML = `
      <h2 class="section-title">⚙️ 설정</h2>

      <div class="card">
        <div class="field">
          <label>🌐 배우는 언어</label>
          ${langToggle(true)}
          <span class="hint">홈 화면과 상황 선택 창에서도 바꿀 수 있어요.</span>
        </div>
        <div class="field">
          <label>📚 학습 단계</label>
          ${stageToggle(true)}
          <span class="hint">${Object.values(STAGES).map(s => `${s.emoji} ${s.name}: ${esc(s.desc)}`).join('<br>')}<br>일본어는 초등은 히라가나·가타카나만, 중등부터 한자를 사용하고 "뜻 보기"에 읽는 법이 함께 나와요.</span>
        </div>
        <div class="field">
          <label for="s-name">🙋 내 이름 (영어 이름도 좋아요)</label>
          <input id="s-name" type="text" placeholder="예: Minji" value="${esc(st.name)}" maxlength="20">
          <span class="hint">AI 친구가 이름을 불러 줘요.</span>
        </div>
      </div>

      <h3 class="section-title" style="font-size:16px">🤖 AI 연결 (OpenAI)</h3>
      <div class="card">
        <div class="field">
          <label for="s-key">API 키</label>
          <div class="row">
            <input id="s-key" class="grow" type="password" placeholder="sk-..." value="${esc(st.apiKey)}" autocomplete="off" spellcheck="false">
            <button class="btn small ghost" id="s-eye" type="button">👁</button>
          </div>
          <span class="hint">키는 이 기기의 브라우저에만 저장되고 OpenAI 서버로만 전송돼요. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">키 만들기 ↗</a> (보호자가 도와주세요)</span>
        </div>
        <div class="field">
          <label for="s-model">모델</label>
          <select id="s-model">
            ${[['gpt-4o-mini', 'gpt-4o-mini (추천 · 빠르고 저렴)'], ['gpt-4.1-mini', 'gpt-4.1-mini'], ['gpt-4.1', 'gpt-4.1 (더 똑똑, 비쌈)'], ['gpt-4o', 'gpt-4o'], ['gpt-5-mini', 'gpt-5-mini'], ['gpt-5', 'gpt-5']].map(([v, n]) => `<option value="${v}" ${st.model === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="row">
          <button class="btn full" id="s-save">💾 저장</button>
          <button class="btn ghost" id="s-test" type="button" style="white-space:nowrap">연결 테스트</button>
        </div>
        <p style="margin-top:10px"><small>상태: ${API.hasKey() ? '🟢 키 설정됨' : '🟡 데모 모드 (키 없음)'}</small></p>
      </div>

      <h3 class="section-title" style="font-size:16px">🔊 대화 옵션</h3>
      <div class="card">
        <div class="switch"><div><b>AI 대사 자동으로 읽어 주기</b><br><small>원어민 발음을 들으며 연습해요</small></div><button class="toggle ${st.autoSpeak ? 'on' : ''}" data-toggle="autoSpeak" aria-label="자동 읽기"></button></div>
        <div class="switch"><div><b>한국어 뜻 항상 보여 주기</b><br><small>한 번 본 뜻을 계속 표시해요</small></div><button class="toggle ${st.showKoHint ? 'on' : ''}" data-toggle="showKoHint" aria-label="뜻 항상 보기"></button></div>
      </div>

      <h3 class="section-title" style="font-size:16px">💾 데이터</h3>
      <div class="card">
        <p><small>저장된 대화: ${total}개 · 모든 기록은 이 브라우저에만 저장돼요.</small></p>
        <div class="row" style="margin-top:10px; flex-wrap:wrap">
          <button class="btn small ghost" id="s-export">⬇ 기록 내보내기 (JSON)</button>
          <button class="btn small ghost" id="s-import">⬆ 가져오기</button>
          <input id="s-file" type="file" accept="application/json" hidden>
          <button class="btn small ghost" id="s-clear" style="color:var(--danger)">🗑 전체 삭제</button>
        </div>
      </div>

      <p style="margin:20px 0 0; text-align:center"><small>Talk Buddy · 영어·일본어 회화 연습 앱 · ${Object.values(STAGES).map(s => `${s.name} ${stageScenarios(s.code).length}`).join(' · ')} = 상황 ${SCENARIOS.length}개 × 2개 언어</small></p>
    `;

    $('#s-eye').addEventListener('click', () => { const k = $('#s-key'); k.type = k.type === 'password' ? 'text' : 'password'; });
    $('#s-save').addEventListener('click', () => {
      Store.saveSettings({ name: $('#s-name').value.trim(), apiKey: $('#s-key').value.trim(), model: $('#s-model').value });
      toast('저장했어요!', 'ok'); render();
    });
    $('#s-test').addEventListener('click', async () => {
      Store.saveSettings({ name: $('#s-name').value.trim(), apiKey: $('#s-key').value.trim(), model: $('#s-model').value });
      const b = $('#s-test'); b.disabled = true; b.textContent = '확인 중...';
      try { await API.ping(); toast('연결 성공! 🎉', 'ok'); }
      catch (e) { toast(e.message === 'NO_KEY' ? 'API 키를 먼저 입력해 주세요.' : e.message, 'error'); }
      render();
    });
    $$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.toggle; Store.saveSettings({ [k]: !Store.getSettings()[k] }); render();
    }));
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => { Store.saveSettings({ lang: b.dataset.lang }); render(); }));
    $$('[data-stage]').forEach(b => b.addEventListener('click', () => { Store.saveSettings({ stage: b.dataset.stage }); state.cat = 'all'; render(); }));
    $('#s-export').addEventListener('click', () => {
      const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `talkbuddy-history-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#s-import').addEventListener('click', () => $('#s-file').click());
    $('#s-file').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const n = Store.importJSON(await f.text()); toast(`${n}개의 대화를 가져왔어요.`, 'ok'); render(); }
      catch { toast('파일을 읽을 수 없어요.', 'error'); }
    });
    $('#s-clear').addEventListener('click', () => {
      if (confirm('모든 대화 기록을 지울까요? 되돌릴 수 없어요.')) { Store.clearHistory(); toast('모든 기록을 지웠어요.'); render(); }
    });
  }

  /* ========================================================
     초기화
  ======================================================== */
  function init() {
    Speech.init();
    $$('.bottom-nav button').forEach(b => b.addEventListener('click', () => {
      if (state.screen === 'chat' && state.session && userCount(state.session) === 0) { Store.deleteSession(state.session.id); Store.setCurrentId(null); }
      navigate(b.dataset.nav, b.dataset.nav === 'scenarios' ? { cat: 'all', search: '' } : {});
    }));
    $('#brand').addEventListener('click', () => { if (state.screen === 'chat') confirmEnd(); else navigate('home'); });
    $('#btn-back').addEventListener('click', () => {
      if (state.screen === 'chat') confirmEnd();
      else if (state.screen === 'report') navigate('scenarios');
      else navigate('home');
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    // PWA 설치 프롬프트 (Android Chrome / 데스크톱 Chrome·Edge)
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installPrompt = e; if (state.screen === 'home') render(); });
    window.addEventListener('appinstalled', () => { state.installPrompt = null; if (state.screen === 'home') render(); });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
