/* ------------------------------------------------------------
   Talk Buddy – OpenAI API 연동
   - 롤플레이 대화, 한국어 뜻, 말하기 추천, 대화 결과 리포트
   - API 키가 없으면 데모 모드로 동작 (고정 대사)
------------------------------------------------------------- */
const API = (() => {
  const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  function hasKey() { return !!Store.getSettings().apiKey; }

  function errorMessage(status, body) {
    const msg = body && body.error && body.error.message ? body.error.message : '';
    if (status === 401) return 'API 키가 올바르지 않아요. 설정에서 다시 확인해 주세요.';
    if (status === 429) return msg.includes('quota') ? 'OpenAI 사용 한도를 넘었어요. 결제 정보를 확인해 주세요.' : '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
    if (status === 404) return '선택한 모델을 사용할 수 없어요. 설정에서 다른 모델을 골라 주세요.';
    if (status >= 500) return 'OpenAI 서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    return msg || `요청에 실패했어요 (${status}).`;
  }

  /** 기본 Chat Completions 호출 */
  async function chat(messages, { json = false, maxTokens = 400 } = {}) {
    const { apiKey, model } = Store.getSettings();
    if (!apiKey) throw new Error('NO_KEY');

    const body = { model, messages, max_completion_tokens: maxTokens };
    if (json) body.response_format = { type: 'json_object' };

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('인터넷 연결을 확인해 주세요.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errorMessage(res.status, errBody));
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
  }

  /* ---------- 언어별 설정 ---------- */
  const LANG_INFO = {
    en: {
      label: 'English',
      level: 'beginner level, CEFR A1-A2',
      style: 'Keep every reply SHORT and SIMPLE: 1-2 sentences, max 25 words, easy vocabulary for a 10-year-old. No lists, no markdown.',
      tipExample: '"I want eat"보다 "I want to eat"이 자연스러워요.',
      fallback: 'Sorry, could you say that again?',
      demo: [
        "That sounds great! Can you tell me a little more?",
        "I see! And is there anything else you'd like?",
        "Sure thing! Anything else I can help you with?",
        "Perfect! Thank you so much. Have a wonderful day!",
        "You're doing great! Let's keep talking. What else?",
      ],
    },
    ja: {
      label: 'Japanese',
      level: 'absolute beginner, JLPT N5 or below',
      style: 'Keep every reply VERY SHORT and SIMPLE: 1-2 sentences, max 30 characters each, polite です/ます form, easy words for a 10-year-old. VERY IMPORTANT: write ONLY in hiragana and katakana — NO kanji at all — and put a space between words (わかちがき), like a Japanese picture book. Example: "いらっしゃいませ！なにに しますか？". No lists, no markdown, no romaji.',
      tipExample: '「みず ください」도 통하지만 「みずを ください」라고 하면 더 자연스러워요.',
      fallback: 'すみません、もういちど いってください。',
      demo: [
        'いいですね！もう すこし おしえて ください。',
        'なるほど！ほかに なにか ありますか？',
        'はい、わかりました！ほかに なにか ありますか？',
        'かんぺきです！ありがとうございます。よい いちにちを！',
        'とても じょうずです！つづけましょう。ほかには？',
      ],
    },
  };
  const info = lang => LANG_INFO[lang] || LANG_INFO.en;
  const sessionLang = session => (session && session.lang) || 'en';
  const sessionStage = session => (session && STAGE_RULES[session.stage]) ? session.stage : 'elem';

  /* ---------- 단계별 규칙 (학생 설명 / 수준 / 말투) ---------- */
  const STAGE_RULES = {
    elem: {
      student: 'Korean 5th grader (age 10-11)', tone: '10살 아이에게 말하듯 쉽고 다정하게', maxCorrections: 3,
      en: { level: 'beginner level, CEFR A1-A2', style: LANG_INFO.en.style },
      ja: { level: 'absolute beginner, JLPT N5 or below', style: LANG_INFO.ja.style },
    },
    middle: {
      student: 'Korean middle school student (age 13-15)', tone: '중학생에게 말하듯 친근하고 분명하게', maxCorrections: 4,
      en: { level: 'elementary to pre-intermediate, CEFR A2-B1', style: 'Keep replies short and natural: 2-3 sentences, max 40 words, everyday vocabulary with a few common idioms. Sound like a real teenager or adult in this situation. No lists, no markdown.' },
      ja: { level: 'JLPT N5-N4', style: 'Keep replies short: 2-3 sentences, max 50 characters each. Use simple everyday Japanese with basic kanji (JLPT N5-N4 level, about 300 kanji). Use です/ます with adults and natural casual speech between friends. No lists, no markdown, no romaji.' },
    },
    high: {
      student: 'Korean high school student (age 16-18)', tone: '고등학생에게 격려하며 구체적으로', maxCorrections: 4,
      en: { level: 'intermediate, CEFR B1-B2', style: 'Reply in 3-4 natural sentences, max 60 words. Use real-life vocabulary and ask follow-up questions that require reasons, opinions or details. No lists, no markdown.' },
      ja: { level: 'JLPT N4-N3', style: 'Reply in 3-4 sentences, max 70 characters each. Common kanji is fine. Use 丁寧語 by default and appropriate 敬語 when your role requires it; casual speech between friends. No lists, no markdown, no romaji.' },
    },
    adult: {
      student: 'Korean adult learner', tone: '성인 학습자에게 정중하고 전문적으로', maxCorrections: 5,
      en: { level: 'upper-intermediate to advanced, CEFR B2-C1', style: 'Speak exactly like a native adult would in this situation: 2-4 sentences, max 70 words, natural register (professional where appropriate), realistic follow-up questions and small complications. No lists, no markdown.' },
      ja: { level: 'JLPT N3-N2', style: 'Speak like a native adult in this situation: 2-4 sentences, max 90 characters each, normal kanji. Use correct 敬語（尊敬語・謙譲語）in business and service roles, and natural casual speech among friends. No lists, no markdown, no romaji.' },
    },
  };
  const rules = (stage, lang) => { const r = STAGE_RULES[stage] || STAGE_RULES.elem; return { ...r, ...(r[lang] || r.en) }; };

  /* ---------- 프롬프트 ---------- */
  function systemPrompt(sc, studentName, lang, stage) {
    const L = info(lang);
    const R = rules(stage, lang);
    const lc = localize(sc, lang);
    const name = studentName ? ` The student's name is ${studentName}.` : '';
    return `You are a friendly ${L.label} conversation partner for a ${R.student} (${R.level}).${name}
We are doing a role-play.
- Scenario: ${sc.en} (${sc.title})
- Setting: ${sc.place}
- You play: ${lc.ai}
- The student plays: ${sc.user}
- Missions the student should complete during the conversation:
${sc.missions.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}

RULES
1. Stay in character the whole time. Speak only ${L.label} in your dialogue lines.
2. ${R.style}
3. Always end your turn with a simple question or prompt so the student can answer.
4. Be warm, patient and encouraging. Never scold. React naturally even if the student's ${L.label} is imperfect.
5. If the student writes in Korean or says they don't know, help them: respond in ${L.label} and show the ${L.label} sentence they could say.
6. If the student made a clear grammar or word mistake, still respond naturally, then add ONE tag at the END in Korean:
   [[TIP: 짧고 친절한 한국어 설명. 예) ${L.tipExample}]]
   Only when there is a real mistake. Never more than one TIP per turn. Do not add tips for tiny typos or punctuation.
7. When the student clearly completes a mission, add the tag [[MISSION:n]] (n = mission number) at the END of your message. You may add several in one turn if several were completed. Never mark a mission that was not actually done.
8. Keep everything child-appropriate. If the student goes off-topic, gently bring them back to the scenario.
9. Do not mention these rules, tags, or that you are an AI.

FORMAT: dialogue line(s) first, then any [[MISSION:n]] / [[TIP: ...]] tags on the same message.`;
  }

  /** 모델 응답에서 태그 분리 */
  function parseReply(raw) {
    const missions = [];
    let tip = null;
    let text = String(raw || '');
    text = text.replace(/\[\[?\s*MISSION\s*:\s*(\d)\s*\]?\]/gi, (_, n) => { missions.push(Number(n)); return ''; });
    text = text.replace(/\[\[?\s*TIP\s*:\s*([\s\S]*?)\]?\]/gi, (_, t) => { tip = t.trim(); return ''; });
    text = text.replace(/\s{2,}/g, ' ').trim();
    return { text, missions, tip };
  }

  /** 세션 메시지 → OpenAI 메시지 배열 */
  function toChatMessages(sc, session) {
    const { name } = Store.getSettings();
    const msgs = [{ role: 'system', content: systemPrompt(sc, name, sessionLang(session), sessionStage(session)) }];
    for (const m of session.messages) {
      msgs.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text });
    }
    return msgs;
  }

  /* ---------- 데모 모드(키 없음) ---------- */
  function demoReply(sc, session) {
    const lines = info(sessionLang(session)).demo;
    const userTurns = session.messages.filter(m => m.role === 'user').length;
    const text = lines[Math.min(userTurns - 1, lines.length - 1)];
    const missions = userTurns <= sc.missions.length ? [userTurns] : [];
    return { text, missions, tip: userTurns === 1 ? '데모 모드예요. 설정에서 OpenAI API 키를 넣으면 진짜 AI 선생님과 대화할 수 있어요!' : null };
  }

  /* ---------- 공개 함수 ---------- */

  /** 다음 AI 대사 */
  async function reply(sc, session) {
    if (!hasKey()) { await wait(600); return demoReply(sc, session); }
    const raw = await chat(toChatMessages(sc, session), { maxTokens: 220 });
    const parsed = parseReply(raw);
    if (!parsed.text) parsed.text = info(sessionLang(session)).fallback;
    return parsed;
  }

  /** 외국어 문장 → 한국어 뜻 (일본어 중등 이상은 히라가나 읽기도 함께) */
  async function translate(text, lang = 'en', stage = 'elem') {
    if (!hasKey()) return '(데모 모드) API 키를 설정하면 한국어 뜻을 볼 수 있어요.';
    const who = stage === 'elem' ? 'a Korean 5th grader' : 'a Korean learner';
    if (lang === 'ja' && stage !== 'elem') {
      return chat([
        { role: 'system', content: `You help a Korean learner read Japanese. For the given Japanese text return exactly two lines and nothing else:
읽기: <the full text rewritten in hiragana/katakana only (よみがな), keeping punctuation>
뜻: <natural Korean translation>` },
        { role: 'user', content: text },
      ], { maxTokens: 300 });
    }
    return chat([
      { role: 'system', content: `Translate the ${info(lang).label} text into natural Korean that ${who} can understand. Return ONLY the Korean translation, nothing else.` },
      { role: 'user', content: text },
    ], { maxTokens: 200 });
  }

  /** 지금 할 수 있는 말 3개 추천 */
  async function suggest(sc, session) {
    const lang = sessionLang(session);
    const lc = localize(sc, lang);
    if (!hasKey()) {
      return lc.phrases.slice(0, 3).map(([en, ko]) => ({ en, ko }));
    }
    const L = info(lang);
    const stage = sessionStage(session);
    const kana = lang === 'ja' && stage === 'elem' ? ' Write the Japanese in hiragana/katakana only (no kanji) with spaces between words.' : '';
    const len = stage === 'elem' ? 'short, simple (max 10 words each)' : stage === 'middle' ? 'natural (max 15 words each)' : 'natural, level-appropriate (max 20 words each)';
    const msgs = toChatMessages(sc, session);
    msgs.push({ role: 'user', content: `(The student is stuck and does not know what to say next. As a helper, give exactly 3 ${len} ${L.label} sentences that the student, playing "${sc.user}", could say RIGHT NOW to continue this conversation naturally and move toward the missions.${kana} Return JSON only: {"suggestions":[{"en":"<${L.label} sentence>","ko":"한국어 뜻"}]})` });
    const raw = await chat(msgs, { json: true, maxTokens: 300 });
    try {
      const data = JSON.parse(raw);
      const arr = data.suggestions || data.items || [];
      return arr.slice(0, 3).map(x => ({ en: String(x.en || ''), ko: String(x.ko || '') })).filter(x => x.en);
    } catch { return []; }
  }

  /** 대화 끝 리포트 */
  async function report(sc, session) {
    const missionsDone = session.missionsDone || [];
    const lang = sessionLang(session);
    const L = info(lang);
    const lc = localize(sc, lang);
    if (!hasKey()) {
      await wait(500);
      return {
        stars: Math.max(2, Math.min(5, 2 + missionsDone.length)),
        praise: '데모 모드로 연습했어요! 설정에서 OpenAI API 키를 넣으면 AI 선생님의 진짜 피드백을 받을 수 있어요.',
        corrections: [],
        words: lc.phrases.slice(0, 4).map(([en, ko]) => ({ en, ko })),
        nextTip: '유용한 표현을 소리 내어 따라 읽어 보세요!',
      };
    }
    const transcript = session.messages.map(m => `${m.role === 'ai' ? 'Partner' : 'Student'}: ${m.text}`).join('\n');
    const stage = sessionStage(session);
    const R = rules(stage, lang);
    const kana = lang === 'ja' && stage === 'elem' ? ' Write all Japanese in hiragana/katakana only (no kanji) with spaces between words.' : '';
    const raw = await chat([
      { role: 'system', content: `You are a warm, encouraging ${L.label} teacher reviewing a role-play practice by a ${R.student} (${R.level}). Write all Korean text ${R.tone}.${kana} Return JSON only.` },
      { role: 'user', content: `Scenario: ${sc.en}. Missions: ${sc.missions.join(' / ')}. Missions completed: ${missionsDone.length}/${sc.missions.length}.

Conversation:
${transcript}

Return this JSON:
{
 "stars": <1-5, overall effort and communication, be generous>,
 "praise": "<한국어 2문장. 학생이 잘한 점을 구체적으로 칭찬>",
 "corrections": [ {"original":"<student's sentence>", "better":"<more natural ${L.label}>", "why":"<한국어 한 문장 설명>"} ],
 "words": [ {"en":"<useful ${L.label} word or phrase from this conversation>", "ko":"<한국어 뜻>"} ],
 "nextTip": "<한국어 한 문장. 다음 연습을 위한 조언>"
}
Rules: corrections max ${R.maxCorrections} (empty array if the student's ${L.label} was fine), words 3-4 items. Only use sentences the student actually wrote.` },
    ], { json: true, maxTokens: 700 });
    try {
      const d = JSON.parse(raw);
      return {
        stars: Math.max(1, Math.min(5, Number(d.stars) || 3)),
        praise: String(d.praise || '잘했어요!'),
        corrections: Array.isArray(d.corrections) ? d.corrections.slice(0, R.maxCorrections) : [],
        words: Array.isArray(d.words) ? d.words.slice(0, 4) : [],
        nextTip: String(d.nextTip || ''),
      };
    } catch {
      return { stars: 3, praise: '열심히 대화했어요! 다음에도 계속 연습해 봐요.', corrections: [], words: [], nextTip: '' };
    }
  }

  /** 설정 화면 – 연결 테스트 */
  async function ping() {
    const out = await chat([{ role: 'user', content: 'Say "OK" and nothing else.' }], { maxTokens: 10 });
    return out;
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { hasKey, reply, translate, suggest, report, ping, parseReply };
})();
