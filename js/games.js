/* ------------------------------------------------------------
   Talk Buddy – 게임 모듈
   7가지 미니게임 + XP / 레벨 / 오늘의 목표 / 배지
   재료: 현재 언어·단계의 상황 표현(localize), VOCAB, GRAMMAR
   모든 게임은 API 키 없이 동작합니다.
------------------------------------------------------------- */
const Games = (() => {
  'use strict';
  let ctx = null;            // app.js 가 init 으로 넘겨주는 도우미들
  let esc = s => String(s);
  let shuffle = a => a.slice();
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DAILY_GOAL = 50;
  const CHAT_XP = 10;        // 대화 1회 완료 = 10 XP

  const GAMES = [
    { id: 'flash',     emoji: '🃏', name: '단어 카드',     desc: '카드를 뒤집어 뜻을 확인하고 아는 단어를 모아요', xp: '카드당 최대 2 XP', skill: '단어' },
    { id: 'quiz',      emoji: '🔤', name: '단어 퀴즈',     desc: '뜻을 보고 알맞은 단어를 고르세요 (4지선다)',       xp: '정답당 3 XP',  skill: '단어' },
    { id: 'blank',     emoji: '✏️', name: '빈칸 채우기',   desc: '예문의 빈칸에 들어갈 단어를 고르세요',             xp: '정답당 3 XP',  skill: '단어·문장' },
    { id: 'builder',   emoji: '🧩', name: '문장 조립',     desc: '섞인 조각을 순서대로 눌러 문장을 완성해요',         xp: '정답당 5 XP',  skill: '문장' },
    { id: 'match',     emoji: '⚡', name: '짝 맞추기',     desc: '표현과 뜻을 빠르게 연결하세요. 시간이 점수!',       xp: '최대 25 XP',   skill: '문장' },
    { id: 'dictation', emoji: '👂', name: '듣고 받아쓰기', desc: '소리를 듣고 문장을 그대로 써 보세요',               xp: '정답당 5 XP',  skill: '듣기·문장' },
    { id: 'grammar',   emoji: '📝', name: '문법 챌린지',   desc: '문법 문제를 풀고 설명으로 바로 복습해요',           xp: '정답당 4 XP',  skill: '문법' },
  ];
  const GAME_MAP = Object.fromEntries(GAMES.map(g => [g.id, g]));

  let st = { game: null };
  let timer = null;

  /* ---------- 공용 ---------- */
  function init(c) { ctx = c; esc = c.esc; shuffle = c.shuffle; }
  function inGame() { return !!st.game; }
  function reset() { clearTimer(); st = { game: null }; }
  function back() { clearTimer(); st = { game: null }; if (ctx) ctx.rerender(); }
  function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function render() { if (!ctx) return; if (!st.game) renderHub(); else if (st.result) renderResult(); else RENDER[st.game](); }
  const lang = () => ctx.getLang();
  const stage = () => ctx.getStage();
  const sepFor = () => (lang() === 'en' || stage() === 'elem') ? ' ' : '';

  function vocabPool() { return (((VOCAB || {})[stage()] || {})[lang()] || []).slice(); }
  function grammarPool() { return (((GRAMMAR || {})[stage()] || {})[lang()] || []).slice(); }
  function phrasePool() {
    const seen = new Set(); const out = [];
    for (const s of stageScenarios(stage())) {
      for (const [f, ko] of localize(s, lang()).phrases) {
        if (f && ko && !seen.has(f)) { seen.add(f); out.push({ f, ko, scenario: s.title }); }
      }
    }
    return out;
  }
  function pick(arr, n) { return shuffle(arr).slice(0, n); }
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[.,!?;:'"’“”、。！？「」『』・\-]/g, '').replace(/\s+/g, lang() === 'ja' ? '' : ' ').trim();
  }
  function tokenize(text) {
    const t = String(text).trim();
    if (lang() === 'en' || stage() === 'elem') return t.split(/\s+/).filter(Boolean);
    // 한자 포함 일본어: 문장부호로 나눈 뒤 2~4글자 조각으로
    const parts = t.split(/(?<=[、。！？!?])/).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const s = p.replace(/\s+/g, '');
      if (s.length <= 4) { out.push(s); continue; }
      const n = Math.ceil(s.length / 3); const size = Math.ceil(s.length / n);
      for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    }
    return out;
  }

  /* ---------- XP / 레벨 / 배지 ---------- */
  function summary() {
    const p = Store.getProgress();
    const finished = Store.getHistory().filter(s => s.endedAt);
    const chatXp = finished.length * CHAT_XP;
    const xp = p.xp + chatXp;
    const level = Math.floor(xp / 100) + 1;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayXp = p.games.filter(g => g.at >= +today).reduce((n, g) => n + g.xp, 0) + finished.filter(s => s.endedAt >= +today).length * CHAT_XP;
    return { xp, level, inLevel: xp % 100, todayXp, goal: DAILY_GOAL, games: p.games, known: Object.keys(p.known).length, finished: finished.length };
  }
  function badges(sm) {
    const g = sm.games;
    return [
      { e: '🎮', n: '첫 게임',     ok: g.length >= 1 },
      { e: '🗣️', n: '수다쟁이',    ok: sm.finished >= 10,           tip: '대화 10회 완료' },
      { e: '📚', n: '단어 수집가', ok: sm.known >= 30,              tip: '아는 단어 30개' },
      { e: '💯', n: '만점',        ok: g.some(x => x.total >= 5 && x.score === x.total) },
      { e: '⚡', n: '번개손',      ok: g.some(x => x.id === 'match' && x.xp >= 20), tip: '짝 맞추기 20 XP' },
      { e: '🔥', n: '3일 연속',    ok: ctx.getStreak() >= 3 },
      { e: '🌏', n: '두 언어',     ok: new Set(g.map(x => x.lang)).size >= 2,  tip: '영어와 일본어 모두' },
      { e: '🏆', n: '레벨 5',      ok: sm.level >= 5 },
    ];
  }

  /* ---------- 허브 ---------- */
  function renderHub() {
    const sm = summary();
    const L = LANGS[lang()], S = STAGES[stage()];
    const best = id => { const r = sm.games.filter(g => g.id === id && g.lang === lang() && g.stage === stage()); return r.length ? Math.max(...r.map(g => g.xp)) : null; };
    const bd = badges(sm);
    const SHORT = { flash: '뒤집어서 외우기', quiz: '뜻 맞히기', blank: '빈칸 고르기', builder: '순서대로 조립', match: '빠르게 연결하기', dictation: '듣고 그대로 쓰기', grammar: '문법 고르기' };
    const goalPct = Math.min(100, Math.round(sm.todayXp / sm.goal * 100));
    ctx.main.innerHTML = `
      <div class="card xp-card xp-simple">
        <div class="xp-mascot">${ctx.mascot(sm.todayXp >= sm.goal ? 'cheer' : 'happy', 64)}</div>
        <div class="grow" style="min-width:0">
          <div class="xp-top"><b>Lv.${sm.level} · ${sm.xp} XP</b><small>오늘 ${Math.min(sm.todayXp, sm.goal)}/${sm.goal}${sm.todayXp >= sm.goal ? ' 🎉' : ''}</small></div>
          <div class="xbar goal"><i style="width:${goalPct}%"></i></div>
          <small style="color:rgba(255,255,255,.85)">${sm.todayXp >= sm.goal ? '오늘 목표 달성! 더 해도 좋아요' : `오늘 목표까지 ${sm.goal - sm.todayXp} XP`}</small>
        </div>
      </div>

      <div style="margin:12px 0 10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap">${ctx.learnChip()}<small>${L.flag} ${L.name} · ${S.emoji} ${S.name} 자료로 놀아요</small></div>

      <div class="game-grid">
        ${GAMES.map(g => { const b = best(g.id); return `
          <button class="game-card simple" data-game="${g.id}">
            <span class="emoji">${g.emoji}</span>
            <b>${g.name}</b>
            <small>${SHORT[g.id] || g.desc}</small>
            ${b !== null ? `<span class="pill-mini best">최고 ${b} XP</span>` : ''}
          </button>`; }).join('')}
      </div>

      <h3 class="section-title" style="font-size:16px">🏅 배지 <small>${bd.filter(b => b.ok).length}/${bd.length}</small></h3>
      <div class="badge-grid">${bd.map(b => `<div class="badge-item ${b.ok ? 'on' : ''}" title="${esc(b.tip || b.n)}"><span>${b.e}</span><small>${b.n}</small></div>`).join('')}</div>
    `;
    ctx.bindCommon();
    $$('[data-game]').forEach(b => b.addEventListener('click', () => start(b.dataset.game)));
  }

  /* ---------- 시작 / 종료 ---------- */
  function start(id) {
    clearTimer();
    st = { game: id, i: 0, score: 0, wrong: [] };
    const ok = SETUP[id]();
    if (ok === false) { st = { game: null }; return; }
    ctx.rerender();
  }
  function finish(xp, extra = {}) {
    clearTimer();
    const total = st.total != null ? st.total : (st.items ? st.items.length : 0);
    const rec = { id: st.game, lang: lang(), stage: stage(), score: st.score, total, xp: Math.max(0, Math.round(xp)) };
    Store.addGameResult(rec);
    st.result = { ...rec, ...extra };
    ctx.rerender();
    const sm = summary();
    if (sm.todayXp >= sm.goal && sm.todayXp - rec.xp < sm.goal) setTimeout(() => ctx.toast('🎉 오늘의 목표 달성! 대단해요!', 'ok'), 400);
  }
  function renderResult() {
    const r = st.result, g = GAME_MAP[st.game];
    const ratio = r.total ? r.score / r.total : 1;
    const face = ratio >= 0.9 ? '🏆' : ratio >= 0.6 ? '👏' : '💪';
    const msg = ratio >= 0.9 ? '완벽해요!' : ratio >= 0.6 ? '잘했어요!' : '조금만 더 연습해 봐요!';
    ctx.main.innerHTML = `
      <div class="report-hero">
        <div class="big">${ctx.mascot(ratio >= 0.6 ? 'cheer' : 'happy', 100)}</div>
        <h2>${g.emoji} ${g.name} ${msg} ${face}</h2>
        <div class="info-row" style="justify-content:center">
          <span class="pill">점수 ${r.score} / ${r.total}</span>
          <span class="pill" style="color:var(--primary)">+${r.xp} XP</span>
          ${r.time != null ? `<span class="pill">⏱ ${r.time}초</span>` : ''}
        </div>
      </div>
      ${st.wrong && st.wrong.length ? `<h3 class="section-title" style="font-size:16px">다시 볼 것 ${st.wrong.length}개</h3>
        <div class="list">${st.wrong.map(w => `<div class="list-item"><div class="phrase"><b>${esc(w.f)}</b><small>${esc(w.ko)}</small></div><button class="speak-btn" data-say="${esc(w.f)}">🔊</button></div>`).join('')}</div>` : ''}
      <div class="report-actions">
        <button class="btn" id="g-again">🔁 다시 하기</button>
        <button class="btn ghost" id="g-hub">🎮 다른 게임</button>
      </div>`;
    $$('[data-say]').forEach(b => b.addEventListener('click', () => ctx.speak(b.dataset.say, lang())));
    $('#g-again').addEventListener('click', () => start(st.game));
    $('#g-hub').addEventListener('click', back);
  }
  function head(sub, right = '') {
    const g = GAME_MAP[st.game];
    return `<div class="g-head"><button class="icon-btn" id="g-back" aria-label="나가기">←</button><div class="title"><b>${g.emoji} ${g.name}</b><small>${sub}</small></div><div class="g-right">${right}</div></div>`;
  }
  function bindHead() { $('#g-back').addEventListener('click', back); }
  function progressBar(i, n) { return `<div class="xbar thin"><i style="width:${Math.round(i / n * 100)}%"></i></div>`; }
  function needData(kind) { ctx.toast(`이 언어·단계에는 ${kind} 자료가 아직 없어요.`, 'error'); return false; }

  /* ========================================================
     1. 단어 카드
  ======================================================== */
  const SETUP = {}, RENDER = {};
  SETUP.flash = () => {
    const pool = vocabPool(); if (pool.length < 4) return needData('단어');
    const known = Store.getProgress().known;
    const unknownFirst = shuffle(pool).sort((a, b) => (known[`${lang()}:${a.w}`] ? 1 : 0) - (known[`${lang()}:${b.w}`] ? 1 : 0));
    st.items = unknownFirst.slice(0, 10); st.total = 10; st.flipped = false; st.knownNow = 0;
  };
  RENDER.flash = () => {
    const it = st.items[st.i];
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 아는 단어 ${st.knownNow}`)}
      ${progressBar(st.i, st.total)}
      <div class="fcard ${st.flipped ? 'flipped' : ''}" id="fcard">
        <div class="fcard-inner">
          <div class="fcard-face front"><small>눌러서 뒤집기</small><b>${esc(it.w)}</b>${it.r ? `<span class="reading">${esc(it.r)}</span>` : ''}<button class="speak-btn" data-say="${esc(it.w)}">🔊</button></div>
          <div class="fcard-face back"><b>${esc(it.ko)}</b><p>${esc(it.ex)}</p><button class="speak-btn" data-say="${esc(it.ex)}">🔊</button></div>
        </div>
      </div>
      <div class="g-actions">
        <button class="btn ghost" id="f-no">😅 아직 몰라요</button>
        <button class="btn ok" id="f-yes">😎 알아요!</button>
      </div>`;
    bindHead();
    $('#fcard').addEventListener('click', e => { if (e.target.closest('[data-say]')) return; st.flipped = !st.flipped; render(); });
    $$('[data-say]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); ctx.speak(b.dataset.say, lang()); }));
    const next = (know) => {
      Store.setKnown(`${lang()}:${it.w}`, know);
      if (know) { st.knownNow++; st.score++; } else st.wrong.push({ f: it.w, ko: it.ko });
      st.i++; st.flipped = false;
      if (st.i >= st.total) finish(st.knownNow * 2 + (st.total - st.knownNow)); else render();
    };
    $('#f-no').addEventListener('click', () => next(false));
    $('#f-yes').addEventListener('click', () => next(true));
  };

  /* ========================================================
     2. 단어 퀴즈 (4지선다)
  ======================================================== */
  SETUP.quiz = () => {
    const pool = vocabPool(); if (pool.length < 4) return needData('단어');
    st.items = pick(pool, 10).map(it => {
      const dir = Math.random() < 0.5 ? 'ko2f' : 'f2ko';
      const others = pick(pool.filter(x => x.w !== it.w), 3);
      const opts = shuffle([it, ...others]);
      return { it, dir, opts, answer: opts.indexOf(it) };
    });
    st.total = st.items.length; st.picked = null;
  };
  RENDER.quiz = () => {
    const q = st.items[st.i], it = q.it;
    const prompt = q.dir === 'ko2f' ? it.ko : (it.w + (it.r ? ` (${it.r})` : ''));
    const label = o => q.dir === 'ko2f' ? o.w : o.ko;
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 점수 ${st.score}`)}
      ${progressBar(st.i, st.total)}
      <div class="card q-card">
        <small>${q.dir === 'ko2f' ? `이 뜻에 맞는 ${LANGS[lang()].name} 단어는?` : '이 단어의 뜻은?'}</small>
        <h2>${esc(prompt)}</h2>
        ${q.dir === 'f2ko' ? `<button class="speak-btn" data-say="${esc(it.w)}">🔊</button>` : ''}
      </div>
      <div class="opts">
        ${q.opts.map((o, i) => `<button class="opt ${st.picked == null ? '' : i === q.answer ? 'correct' : i === st.picked ? 'wrong' : 'dim'}" data-opt="${i}" ${st.picked != null ? 'disabled' : ''}>${esc(label(o))}</button>`).join('')}
      </div>
      ${st.picked != null ? `<div class="explain ${st.picked === q.answer ? 'good' : 'bad'}">${st.picked === q.answer ? '⭕ 정답!' : '❌ 아쉬워요.'} <b>${esc(it.w)}</b>${it.r ? ` (${esc(it.r)})` : ''} = ${esc(it.ko)}<br><small>${esc(it.ex)}</small></div>
        <div class="g-actions"><button class="btn full" id="q-next">${st.i + 1 >= st.total ? '결과 보기' : '다음 ➜'}</button></div>` : ''}`;
    bindHead();
    $$('[data-say]').forEach(b => b.addEventListener('click', () => ctx.speak(b.dataset.say, lang())));
    $$('[data-opt]').forEach(b => b.addEventListener('click', () => {
      st.picked = Number(b.dataset.opt);
      if (st.picked === q.answer) st.score++; else st.wrong.push({ f: it.w, ko: it.ko });
      render();
    }));
    const n = $('#q-next'); if (n) n.addEventListener('click', () => { st.i++; st.picked = null; if (st.i >= st.total) finish(st.score * 3); else render(); });
  };

  /* ========================================================
     3. 빈칸 채우기 (예문)
  ======================================================== */
  SETUP.blank = () => {
    const pool = vocabPool().filter(x => x.ex && x.ex.includes(x.w)); if (pool.length < 4) return needData('예문');
    st.items = pick(pool, 10).map(it => {
      const others = pick(pool.filter(x => x.w !== it.w), 3);
      const opts = shuffle([it, ...others]);
      return { it, opts, answer: opts.indexOf(it), q: it.ex.replace(it.w, '＿＿＿') };
    });
    st.total = st.items.length; st.picked = null;
  };
  RENDER.blank = () => {
    const q = st.items[st.i], it = q.it;
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 점수 ${st.score}`)}
      ${progressBar(st.i, st.total)}
      <div class="card q-card">
        <small>빈칸에 들어갈 말은?</small>
        <h2 style="font-size:20px">${esc(q.q)}</h2>
        <p><small>💡 ${esc(it.ko)}</small></p>
      </div>
      <div class="opts">
        ${q.opts.map((o, i) => `<button class="opt ${st.picked == null ? '' : i === q.answer ? 'correct' : i === st.picked ? 'wrong' : 'dim'}" data-opt="${i}" ${st.picked != null ? 'disabled' : ''}>${esc(o.w)}${o.r ? `<small> ${esc(o.r)}</small>` : ''}</button>`).join('')}
      </div>
      ${st.picked != null ? `<div class="explain ${st.picked === q.answer ? 'good' : 'bad'}">${st.picked === q.answer ? '⭕ 정답!' : '❌ 아쉬워요.'} <b>${esc(it.ex)}</b> <button class="speak-btn" data-say="${esc(it.ex)}">🔊</button></div>
        <div class="g-actions"><button class="btn full" id="q-next">${st.i + 1 >= st.total ? '결과 보기' : '다음 ➜'}</button></div>` : ''}`;
    bindHead();
    $$('[data-say]').forEach(b => b.addEventListener('click', () => ctx.speak(b.dataset.say, lang())));
    $$('[data-opt]').forEach(b => b.addEventListener('click', () => {
      st.picked = Number(b.dataset.opt);
      if (st.picked === q.answer) st.score++; else st.wrong.push({ f: it.ex, ko: it.ko });
      render();
    }));
    const n = $('#q-next'); if (n) n.addEventListener('click', () => { st.i++; st.picked = null; if (st.i >= st.total) finish(st.score * 3); else render(); });
  };

  /* ========================================================
     4. 문장 조립
  ======================================================== */
  SETUP.builder = () => {
    const pool = phrasePool().map(p => ({ ...p, tokens: tokenize(p.f) })).filter(p => p.tokens.length >= 3 && p.tokens.length <= 10);
    if (pool.length < 3) return needData('문장');
    st.items = pick(pool, 8); st.total = st.items.length; newBuilderItem();
  };
  function newBuilderItem() {
    const it = st.items[st.i];
    let order = shuffle(it.tokens.map((t, i) => i));
    if (order.every((v, i) => v === i) && it.tokens.length > 1) order = order.reverse();
    st.cur = { bank: order.map(i => ({ t: it.tokens[i], used: false })), picked: [], checked: null };
  }
  RENDER.builder = () => {
    const it = st.items[st.i], c = st.cur, sep = sepFor();
    const built = c.picked.map(i => c.bank[i].t).join(sep);
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 점수 ${st.score}`)}
      ${progressBar(st.i, st.total)}
      <div class="card q-card">
        <small>이 뜻이 되도록 조각을 순서대로 눌러요</small>
        <h2 style="font-size:19px">${esc(it.ko)}</h2>
      </div>
      <div class="builder-target ${c.checked === true ? 'good' : c.checked === false ? 'bad' : ''}">${c.picked.length ? c.picked.map((bi, k) => `<button class="token picked" data-unpick="${k}">${esc(c.bank[bi].t)}</button>`).join('') : '<small>여기에 문장이 만들어져요</small>'}</div>
      <div class="builder-bank">${c.bank.map((b, i) => `<button class="token ${b.used ? 'used' : ''}" data-pick="${i}" ${b.used || c.checked !== null ? 'disabled' : ''}>${esc(b.t)}</button>`).join('')}</div>
      ${c.checked === null ? `<div class="g-actions">
          <button class="btn ghost" id="b-undo" ${c.picked.length ? '' : 'disabled'}>⌫ 지우기</button>
          <button class="btn" id="b-check" ${c.picked.length === c.bank.length ? '' : 'disabled'}>확인</button>
        </div>` : `
        <div class="explain ${c.checked ? 'good' : 'bad'}">${c.checked ? '⭕ 정답!' : '❌ 정답은:'} <b>${esc(it.f)}</b> <button class="speak-btn" data-say="${esc(it.f)}">🔊</button></div>
        <div class="g-actions"><button class="btn full" id="q-next">${st.i + 1 >= st.total ? '결과 보기' : '다음 ➜'}</button></div>`}`;
    bindHead();
    $$('[data-say]').forEach(b => b.addEventListener('click', () => ctx.speak(b.dataset.say, lang())));
    $$('[data-pick]').forEach(b => b.addEventListener('click', () => { const i = Number(b.dataset.pick); c.bank[i].used = true; c.picked.push(i); render(); }));
    $$('[data-unpick]').forEach(b => b.addEventListener('click', () => { if (c.checked !== null) return; const k = Number(b.dataset.unpick); const bi = c.picked.splice(k, 1)[0]; c.bank[bi].used = false; render(); }));
    const undo = $('#b-undo'); if (undo) undo.addEventListener('click', () => { const bi = c.picked.pop(); if (bi != null) c.bank[bi].used = false; render(); });
    const chk = $('#b-check'); if (chk) chk.addEventListener('click', () => {
      c.checked = normalize(built) === normalize(it.tokens.join(sep));
      if (c.checked) st.score++; else st.wrong.push({ f: it.f, ko: it.ko });
      render();
    });
    const n = $('#q-next'); if (n) n.addEventListener('click', () => { st.i++; if (st.i >= st.total) finish(st.score * 5); else { newBuilderItem(); render(); } });
  };

  /* ========================================================
     5. 짝 맞추기
  ======================================================== */
  SETUP.match = () => {
    const pool = phrasePool().filter(p => p.f.length <= 48); if (pool.length < 6) return needData('표현');
    const pairs = pick(pool, 6);
    st.pairs = pairs; st.left = shuffle(pairs.map((p, i) => ({ i, t: p.f }))); st.right = shuffle(pairs.map((p, i) => ({ i, t: p.ko })));
    st.matched = new Set(); st.selL = null; st.selR = null; st.mistakes = 0; st.startAt = Date.now(); st.total = 6; st.flash = null;
    timer = setInterval(() => { const el = $('#m-timer'); if (el) el.textContent = `⏱ ${Math.floor((Date.now() - st.startAt) / 1000)}초`; }, 500);
  };
  RENDER.match = () => {
    const cell = (side, o) => {
      const done = st.matched.has(o.i);
      const sel = (side === 'L' ? st.selL : st.selR) === o.i;
      const bad = st.flash && st.flash.includes(`${side}${o.i}`);
      return `<button class="m-cell ${done ? 'done' : ''} ${sel ? 'sel' : ''} ${bad ? 'bad' : ''}" data-side="${side}" data-i="${o.i}" ${done ? 'disabled' : ''}>${esc(o.t)}</button>`;
    };
    ctx.main.innerHTML = `
      ${head(`맞춘 짝 ${st.matched.size} / 6 · 실수 ${st.mistakes}`, `<span class="pill" id="m-timer">⏱ ${Math.floor((Date.now() - st.startAt) / 1000)}초</span>`)}
      <p style="margin:6px 0 10px"><small>왼쪽 표현과 오른쪽 뜻을 하나씩 눌러 짝을 맞추세요.</small></p>
      <div class="match-grid">
        <div class="m-col">${st.left.map(o => cell('L', o)).join('')}</div>
        <div class="m-col">${st.right.map(o => cell('R', o)).join('')}</div>
      </div>`;
    bindHead();
    $$('.m-cell').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (b.dataset.side === 'L') st.selL = st.selL === i ? null : i; else st.selR = st.selR === i ? null : i;
      if (st.selL != null && st.selR != null) {
        if (st.selL === st.selR) {
          st.matched.add(st.selL); st.score = st.matched.size; ctx.speak(st.pairs[st.selL].f, lang());
          st.selL = st.selR = null;
          if (st.matched.size === 6) {
            const secs = Math.round((Date.now() - st.startAt) / 1000);
            finish(Math.max(5, 25 - st.mistakes * 3 - Math.floor(secs / 15)), { time: secs });
            return;
          }
        } else {
          st.mistakes++; st.flash = [`L${st.selL}`, `R${st.selR}`]; const l = st.selL, r = st.selR;
          st.wrong.push({ f: st.pairs[l].f, ko: st.pairs[l].ko });
          st.selL = st.selR = null;
          render(); setTimeout(() => { st.flash = null; if (st.game === 'match' && !st.result) render(); }, 500); return;
        }
      }
      render();
    }));
  };

  /* ========================================================
     6. 듣고 받아쓰기
  ======================================================== */
  SETUP.dictation = () => {
    if (!('speechSynthesis' in window)) { ctx.toast('이 브라우저는 음성 읽기를 지원하지 않아요.', 'error'); return false; }
    const pool = phrasePool().filter(p => p.f.length <= 60); if (pool.length < 3) return needData('문장');
    st.items = pick(pool, 8); st.total = st.items.length; st.checked = null; st.typed = ''; st.played = false;
  };
  RENDER.dictation = () => {
    const it = st.items[st.i];
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 점수 ${st.score}`)}
      ${progressBar(st.i, st.total)}
      <div class="card q-card">
        <small>들리는 대로 써 보세요 (대소문자·문장부호는 안 봐요)</small>
        <div class="g-actions" style="margin-top:8px"><button class="btn accent" id="d-play">🔊 듣기</button><button class="btn ghost" id="d-slow">🐢 천천히</button></div>
        <p><small>💡 뜻: ${esc(it.ko)}</small></p>
      </div>
      <form id="d-form" class="d-form" autocomplete="off">
        <input id="d-input" type="text" placeholder="${LANGS[lang()].say}" value="${esc(st.typed)}" ${st.checked !== null ? 'disabled' : ''} autocapitalize="off" spellcheck="false">
        ${st.checked === null ? `<div class="g-actions"><button type="button" class="btn ghost" id="d-show">정답 보기</button><button type="submit" class="btn">확인</button></div>` : `
          <div class="explain ${st.checked ? 'good' : 'bad'}">${st.checked ? '⭕ 정확해요!' : '❌ 정답은:'} <b>${esc(it.f)}</b></div>
          <div class="g-actions"><button type="button" class="btn full" id="q-next">${st.i + 1 >= st.total ? '결과 보기' : '다음 ➜'}</button></div>`}
      </form>`;
    bindHead();
    const play = (rate) => { ctx.speak(it.f, lang(), rate); st.played = true; };
    $('#d-play').addEventListener('click', () => play());
    $('#d-slow').addEventListener('click', () => play(0.6));
    if (!st.played) setTimeout(() => play(), 300);
    const input = $('#d-input'); input.addEventListener('input', () => { st.typed = input.value; });
    if (st.checked === null) input.focus();
    const check = (gaveUp) => {
      st.checked = !gaveUp && normalize(st.typed) === normalize(it.f);
      if (st.checked) st.score++; else st.wrong.push({ f: it.f, ko: it.ko });
      render();
    };
    $('#d-form').addEventListener('submit', e => { e.preventDefault(); if (st.checked === null) check(false); });
    const show = $('#d-show'); if (show) show.addEventListener('click', () => check(true));
    const n = $('#q-next'); if (n) n.addEventListener('click', () => { st.i++; st.checked = null; st.typed = ''; st.played = false; if (st.i >= st.total) finish(st.score * 5); else render(); });
  };

  /* ========================================================
     7. 문법 챌린지
  ======================================================== */
  SETUP.grammar = () => {
    const pool = grammarPool(); if (pool.length < 3) return needData('문법');
    st.items = shuffle(pool).slice(0, 10).map(g => { const idx = g.opts.map((_, i) => i); const order = shuffle(idx); return { g, opts: order.map(i => g.opts[i]), answer: order.indexOf(g.a) }; });
    st.total = st.items.length; st.picked = null;
  };
  RENDER.grammar = () => {
    const q = st.items[st.i], g = q.g;
    ctx.main.innerHTML = `
      ${head(`${st.i + 1} / ${st.total} · 점수 ${st.score}`)}
      ${progressBar(st.i, st.total)}
      <div class="card q-card">
        <small>빈칸에 알맞은 것은?</small>
        <h2 style="font-size:20px">${esc(g.q)}</h2>
      </div>
      <div class="opts">
        ${q.opts.map((o, i) => `<button class="opt ${st.picked == null ? '' : i === q.answer ? 'correct' : i === st.picked ? 'wrong' : 'dim'}" data-opt="${i}" ${st.picked != null ? 'disabled' : ''}>${esc(o)}</button>`).join('')}
      </div>
      ${st.picked != null ? `<div class="explain ${st.picked === q.answer ? 'good' : 'bad'}">${st.picked === q.answer ? '⭕ 정답!' : '❌ 아쉬워요.'} <b>${esc(g.q.replace('___', g.opts[g.a]))}</b><br><small>📖 ${esc(g.ko)}</small></div>
        <div class="g-actions"><button class="btn full" id="q-next">${st.i + 1 >= st.total ? '결과 보기' : '다음 ➜'}</button></div>` : ''}`;
    bindHead();
    $$('[data-opt]').forEach(b => b.addEventListener('click', () => {
      st.picked = Number(b.dataset.opt);
      if (st.picked === q.answer) st.score++; else st.wrong.push({ f: g.q.replace('___', g.opts[g.a]), ko: g.ko });
      render();
    }));
    const n = $('#q-next'); if (n) n.addEventListener('click', () => { st.i++; st.picked = null; if (st.i >= st.total) finish(st.score * 4); else render(); });
  };

  return { init, render, start, back, reset, inGame, summary, GAMES };
})();
