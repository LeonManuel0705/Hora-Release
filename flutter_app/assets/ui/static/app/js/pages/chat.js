// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../core.js";
import { toast } from "../shell.js";
import { travels } from "../motion.js";
import { escapeHtml, formatMessage } from "../chat-format.js";
import { solveEquation, solveDerivative, solveIntegral, solveVector, solveMatrix, solveProbability, formatMathResponse } from "../chat-math.js";

let chatHistory = [];
let ollamaAvailable = false;
let ollamaModel = 'llama3.2:1b';
let activeBackend = 'offline';
let currentMathCategory = 'equation';
let _smoothScrollRaf = null;

async function loadChatHistory() {
  try {
    const resp = await fetch('/api/hub/assistant/history', { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.history)) {
        chatHistory = data.history.map(m => ({ role: m.role, content: m.content }));
        renderChatHistory();
        return;
      }
    }
  } catch (e) {}
  try {
    const saved = localStorage.getItem('app-chat-history');
    if (saved) {
      chatHistory = JSON.parse(saved);
      renderChatHistory();
    }
  } catch (e) {}
}

function renderChatHistory() {
  const container = document.getElementById('chatMessages');
  if (!chatHistory.length) return;
  container.innerHTML = '';
  chatHistory.forEach(msg => {
    addMessageToUI(msg.role, msg.content, false);
  });
  scrollToBottom(false);
}

async function checkAIStatus() {
  const statusEl = document.getElementById('assistantStatus');
  try {
    const response = await fetch('/api/hub/assistant/status', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data = await response.json();
      activeBackend = data.backend || 'offline';

      if (data.backend === 'local') {
        ollamaAvailable = true;
        statusEl.textContent = `Lokale KI (${data.model || 'local'})`;
        statusEl.dataset.tone = 'live';
        return;
      } else if (data.backend === 'ollama') {
        ollamaAvailable = true;
        ollamaModel = data.model || 'llama3.2';
        statusEl.textContent = `Ollama (${ollamaModel})`;
        statusEl.dataset.tone = 'live';
        return;
      } else if (data.backend === 'claude') {
        ollamaAvailable = true;
        statusEl.textContent = `Claude API (${data.model || 'Sonnet'})`;
        statusEl.dataset.tone = 'cloud';
        return;
      }
    }
  } catch (e) {
    ollamaAvailable = false;
  }

  activeBackend = 'offline';
  statusEl.textContent = 'Ohne KI';
  statusEl.dataset.tone = '';
  document.getElementById('assistantInstall').hidden = false;
}

function sendSuggestion(text) {
  document.getElementById('chatInput').value = text;
  sendMessage(new Event('submit'));
}

async function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  addMessageToUI('user', message);
  chatHistory.push({ role: 'user', content: message });

  const typingId = showTypingIndicator();

  try {
    if (activeBackend !== 'offline') {
      const streamSuccess = await streamAIResponse(message, typingId);
      if (streamSuccess) return;
    }

    const resp = await fetch('/api/hub/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: chatHistory.slice(-10)
      }),
      signal: AbortSignal.timeout(300000)
    });
    removeTypingIndicator(typingId);

    if (resp.ok) {
      const data = await resp.json();
      addMessageToUI('assistant', data.response);
      chatHistory.push({ role: 'assistant', content: data.response });
      if (data.actions_executed && data.actions_executed.length) {
        showActionResults(data.actions_executed);
      }
      return;
    }
    showUnreachable();
  } catch (err) {
    removeTypingIndicator(typingId);
    showUnreachable();
  }
}

function showUnreachable() {
  addMessageToUI('assistant', 'Der Assistent ist gerade nicht erreichbar. Versuch es gleich noch einmal.');
}

async function streamAIResponse(message, typingId) {
  try {
    const resp = await fetch('/api/hub/assistant/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: chatHistory.slice(-10)
      }),
      signal: AbortSignal.timeout(300000)
    });

    if (!resp.ok || !resp.body) return false;

    removeTypingIndicator(typingId);

    const msgEl = document.createElement('div');
    msgEl.className = 'message assistant streaming-message is-new';
    const avatar = icon('message-circle');
    const avatarEl = document.createElement('div');
    avatarEl.className = 'message-avatar';
    avatarEl.innerHTML = avatar;
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    msgEl.appendChild(avatarEl);
    msgEl.appendChild(contentEl);
    document.getElementById('chatMessages').appendChild(msgEl);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let revealedLen = 0;
    let committedLen = 0;
    let buffer = '';
    let streamDone = false;
    let cleanedFromServer = null;
    let actionsFromServer = null;

    const committedEl = document.createElement('div');
    committedEl.className = 'reveal-committed';
    const pendingEl = document.createElement('div');
    pendingEl.className = 'reveal-pending';
    contentEl.appendChild(committedEl);
    contentEl.appendChild(pendingEl);

    const animateHeightGrowth = () => {
      if (!travels()) return;
      const before = contentEl.offsetHeight;
      requestAnimationFrame(() => {
        const after = contentEl.offsetHeight;
        if (after <= before) return;
        contentEl.style.height = before + 'px';
        contentEl.style.transition = 'height 340ms cubic-bezier(0.22, 0.61, 0.36, 1)';
        requestAnimationFrame(() => {
          contentEl.style.height = after + 'px';
          setTimeout(() => {
            contentEl.style.height = '';
            contentEl.style.transition = '';
          }, 380);
        });
      });
    };

    const container = document.getElementById('chatMessages');
    let autoScroll = true;
    const scrollThreshold = 80;
    const isNearBottom = () => (container.scrollHeight - container.scrollTop - container.clientHeight) < scrollThreshold;
    const onUserScroll = () => { autoScroll = isNearBottom(); };
    container.addEventListener('scroll', onUserScroll, { passive: true });

    const commitPending = () => {
      if (committedLen >= revealedLen) return;
      committedEl.innerHTML = formatMessage(fullText.slice(0, revealedLen));
      pendingEl.textContent = '';
      committedLen = revealedLen;
    };

    let rafPending = false;
    let lastFrameTs = 0;
    const scheduleReveal = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(revealTick);
    };
    const revealTick = (ts) => {
      rafPending = false;
      const remaining = fullText.length - revealedLen;
      if (remaining <= 0) { lastFrameTs = ts || 0; return; }

      const dt = lastFrameTs ? Math.min(48, ts - lastFrameTs) : 16;
      lastFrameTs = ts || performance.now();
      const baseRate = 90;
      const lag = Math.max(1, Math.min(1.6, remaining / 400));
      let step = Math.max(1, Math.round((baseRate * lag * dt) / 1000));
      step = Math.min(step, 4, remaining);

      const chunk = fullText.slice(revealedLen, revealedLen + step);
      revealedLen += step;

      const segments = chunk.split(/(\n)/).filter(Boolean);
      let lineStartsHere = false;
      for (const seg of segments) {
        if (seg === '\n') {
          pendingEl.appendChild(document.createElement('br'));
          animateHeightGrowth();
          lineStartsHere = true;
          continue;
        }
        const span = document.createElement('span');
        span.className = lineStartsHere ? 'reveal-chunk reveal-line-start' : 'reveal-chunk';
        span.textContent = seg;
        pendingEl.appendChild(span);
        lineStartsHere = false;
      }

      const pendingText = fullText.slice(committedLen, revealedLen);
      const shouldCommit =
        pendingText.length > 100 ||
        /\n\n/.test(pendingText) ||
        (pendingText.length > 40 && /[.!?]\s*$/.test(pendingText));
      if (shouldCommit) commitPending();

      if (autoScroll) scrollToBottom(true);
      if (revealedLen < fullText.length) scheduleReveal();
    };

    const handleEvent = (data) => {
      if (data.token) {
        fullText += data.token;
        scheduleReveal();
      }
      if (data.done) {
        streamDone = true;
        if (typeof data.cleaned === 'string') cleanedFromServer = data.cleaned;
        if (Array.isArray(data.actions_executed)) actionsFromServer = data.actions_executed;
      }
    };

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let eventEnd;
      while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.substring(0, eventEnd);
        buffer = buffer.substring(eventEnd + 2);

        for (const line of event.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { handleEvent(JSON.parse(line.slice(6))); } catch (e) {}
        }
      }
    }

    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { handleEvent(JSON.parse(line.slice(6))); } catch (e) {}
      }
    }

    await new Promise(resolve => {
      const drain = () => {
        if (revealedLen >= fullText.length) return resolve();
        requestAnimationFrame(drain);
      };
      drain();
    });
    commitPending();

    container.removeEventListener('scroll', onUserScroll);
    msgEl.classList.remove('streaming-message');

    if (!fullText.trim()) {
      msgEl.remove();
      return false;
    }

    const finalText = (cleanedFromServer && cleanedFromServer.trim()) ? cleanedFromServer : fullText;
    contentEl.innerHTML = formatMessage(finalText);

    if (actionsFromServer && actionsFromServer.length) {
      showActionResults(actionsFromServer);
    }

    chatHistory.push({ role: 'assistant', content: finalText });
    if (autoScroll) scrollToBottom(true);
    return true;
  } catch (e) {
    console.log('Stream failed:', e);
    const partial = document.querySelector('.streaming-message');
    if (partial) partial.remove();
    return false;
  }
}

function showActionResults(actions) {
  const messagesEl = document.getElementById('chatMessages');
  const nearBottom = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 80;
  actions.forEach(action => {
    const card = document.createElement('div');
    card.className = `action-result-card is-new${action.success ? '' : ' is-failed'}`;
    card.innerHTML = `<span class="action-icon">${icon(action.success ? 'circle-check' : 'circle-alert')}</span><span class="action-text">${escapeHtml(action.message)}</span>`;
    messagesEl.appendChild(card);
  });
  if (nearBottom) scrollToBottom();
}

function addMessageToUI(role, content, scroll = true) {
  const container = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}${scroll ? ' is-new' : ''}`;

  const avatar = icon(role === 'assistant' ? 'message-circle' : 'user');

  const formattedContent = formatMessage(content);

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">${formattedContent}</div>
  `;

  container.appendChild(messageDiv);
  if (scroll) scrollToBottom();
}

function showTypingIndicator() {
  const container = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'message assistant typing';
  div.innerHTML = `
    <div class="message-avatar">${icon('message-circle')}</div>
    <div class="message-content" aria-label="Der Assistent schreibt">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom(smooth = true) {
  const container = document.getElementById('chatMessages');
  if (!smooth || !travels()) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  if (_smoothScrollRaf) cancelAnimationFrame(_smoothScrollRaf);
  const tick = () => {
    const target = container.scrollHeight - container.clientHeight;
    const current = container.scrollTop;
    const distance = target - current;
    if (distance < 1) {
      container.scrollTop = target;
      _smoothScrollRaf = null;
      return;
    }
    const step = Math.max(1, distance * 0.18);
    container.scrollTop = current + step;
    _smoothScrollRaf = requestAnimationFrame(tick);
  };
  _smoothScrollRaf = requestAnimationFrame(tick);
}

async function clearChat() {
  chatHistory = [];
  try {
    localStorage.removeItem('app-chat-history');
  } catch {}
  document.getElementById('chatMessages').innerHTML = `
    <div class="message assistant is-new">
      <div class="message-avatar">${icon('message-circle')}</div>
      <div class="message-content">
        <p>Chat wurde geleert. Wie kann ich dir helfen?</p>
      </div>
    </div>
  `;
  try {
    await fetch('/api/hub/assistant/history', { method: 'DELETE' });
  } catch {}
}

function selectMathCategory(cat) {
  currentMathCategory = cat;
  document.querySelectorAll('.math-cat').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));

  const examples = {
    equation: [
      { label: '2x + 5 = 15', val: '2x + 5 = 15' },
      { label: 'x² - 4x + 3 = 0', val: 'x² - 4x + 3 = 0' },
      { label: 'Kubische Gl.', val: 'x³ - 6x² + 11x - 6 = 0' }
    ],
    derivative: [
      { label: 'f(x) = x²', val: 'f(x) = x²' },
      { label: 'f(x) = 3x³ + 2x² - x', val: 'f(x) = 3x³ + 2x² - x' },
      { label: 'f(x) = sin(x)', val: 'f(x) = sin(x)' }
    ],
    integral: [
      { label: '∫ x² dx', val: '∫ x² dx' },
      { label: '∫ 2x + 3 dx', val: '∫ 2x + 3 dx' },
      { label: '∫ x² von 0 bis 2', val: '∫ x² dx von 0 bis 2' }
    ],
    vector: [
      { label: 'Betrag', val: 'Betrag von (3, 4, 0)' },
      { label: 'Skalarprodukt', val: '(1,2,3) · (4,5,6)' },
      { label: 'Kreuzprodukt', val: '(1,0,0) × (0,1,0)' }
    ],
    matrix: [
      { label: 'Determinante', val: 'det [[1,2],[3,4]]' },
      { label: 'Multiplikation', val: '[[1,2],[3,4]] * [[5,6],[7,8]]' },
      { label: 'Inverse', val: 'inv [[4,7],[2,6]]' }
    ],
    probability: [
      { label: 'Binomial', val: 'B(10, 0.5, 3)' },
      { label: 'Erwartungswert', val: 'E(X) für B(20, 0.3)' },
      { label: 'Normalvert.', val: 'P(X < 1.5) für N(0, 1)' }
    ]
  };

  const examplesDiv = document.getElementById('mathExamples');
  const exs = examples[cat] || examples.equation;
  examplesDiv.innerHTML = '<span class="tool-examples-label">Beispiele</span>' +
    exs.map(e => `<button type="button" class="pill" data-example="${escapeHtml(e.val)}">${escapeHtml(e.label)}</button>`).join('');

  document.getElementById('mathInput').placeholder = getPlaceholderForCategory(cat);
}

function getPlaceholderForCategory(cat) {
  const placeholders = {
    equation: 'z.B. x² - 5x + 6 = 0',
    derivative: 'z.B. f(x) = 3x² + 2x - 1',
    integral: 'z.B. ∫ x² dx oder ∫ x² dx von 0 bis 2',
    vector: 'z.B. Betrag von (3, 4, 5) oder (1,2,3) · (4,5,6)',
    matrix: 'z.B. det [[1,2],[3,4]] oder inv [[4,7],[2,6]]',
    probability: 'z.B. B(10, 0.5, 3) für Binomialverteilung'
  };
  return placeholders[cat] || placeholders.equation;
}

function setMathExample(example) {
  document.getElementById('mathInput').value = example;
}

async function solveMath() {
  const input = document.getElementById('mathInput').value.trim();
  if (!input) return;

  const resultEl = document.getElementById('mathResult');
  const solutionEl = document.getElementById('mathSolution');

  resultEl.hidden = false;
  solutionEl.innerHTML = '<p class="tool-wait">Löse die Aufgabe …</p>';

  if (ollamaAvailable) {
    try {
      const response = await fetch('/api/hub/assistant/math', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: input,
          model: ollamaModel
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.solution) {
          const formattedSolution = formatMathResponse(data.solution);
          solutionEl.innerHTML = formattedSolution;
          return;
        }
      }
    } catch (e) {
      console.log('AI math solving failed, falling back to local engine:', e);
    }
  }

  let solution = '';

  try {
    switch (currentMathCategory) {
      case 'equation':
        solution = solveEquation(input);
        break;
      case 'derivative':
        solution = solveDerivative(input);
        break;
      case 'integral':
        solution = solveIntegral(input);
        break;
      case 'vector':
        solution = solveVector(input);
        break;
      case 'matrix':
        solution = solveMatrix(input);
        break;
      case 'probability':
        solution = solveProbability(input);
        break;
      default:
        solution = solveEquation(input);
    }
  } catch (e) {
    solution = `<p class="error">Fehler beim Lösen: ${escapeHtml(e.message)}</p><p>Versuche die Aufgabe anders zu formulieren.</p>`;
  }

  solutionEl.innerHTML = solution;
}

async function generateEssay() {
  const type = document.getElementById('essayType').value;
  const topic = document.getElementById('essayTopic').value.trim();
  const info = document.getElementById('essayInfo').value.trim();
  const length = document.getElementById('essayLength').value;
  const language = document.getElementById('essayLanguage').value;

  if (!topic) {
    toolError('essayError', 'Gib zuerst ein Thema ein.', 'essayTopic');
    return;
  }
  toolError('essayError', '');

  const typeNames = {
    'eroerterung': 'Erörterung',
    'interpretation': 'Interpretation',
    'analyse': 'Analyse',
    'charakterisierung': 'Charakterisierung',
    'inhaltsangabe': 'Inhaltsangabe',
    'bericht': 'Bericht',
    'kommentar': 'Kommentar'
  };

  document.getElementById('essayResult').hidden = false;
  document.getElementById('essaySolution').innerHTML = '<p class="tool-wait">Schreibe den Essay …</p>';

  if (ollamaAvailable) {
    try {
      const wordCount = length === 'short' ? 300 : length === 'long' ? 800 : 500;

      const response = await fetch('/api/hub/assistant/essay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic + (info ? ` - ${info}` : ''),
          type: type,
          model: ollamaModel
        }),
        signal: AbortSignal.timeout(120000)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.response) {
          document.getElementById('essaySolution').innerHTML = formatEssayOutput(data.response);
          return;
        }
      }
    } catch (e) {
      console.log('Essay generation error:', e);
    }
  }

  document.getElementById('essaySolution').innerHTML = getEssayTemplate(type, escapeHtml(topic), language);
}

function getEssayTemplate(type, topic, language) {
  const templates = {
    'eroerterung': `
      <h4>Erörterung: ${topic}</h4>

      <p><strong>Einleitung:</strong></p>
      <p>Das Thema "${topic}" ist in der heutigen Gesellschaft von großer Relevanz. In der folgenden Erörterung sollen die verschiedenen Aspekte dieses Themas beleuchtet und gegeneinander abgewogen werden.</p>

      <p><strong>Hauptteil, Pro-Argumente:</strong></p>
      <ul>
        <li>Argument 1: [Hier Pro-Argument einfügen]</li>
        <li>Argument 2: [Hier weiteres Pro-Argument einfügen]</li>
        <li>Argument 3: [Hier drittes Pro-Argument einfügen]</li>
      </ul>

      <p><strong>Hauptteil, Contra-Argumente:</strong></p>
      <ul>
        <li>Argument 1: [Hier Contra-Argument einfügen]</li>
        <li>Argument 2: [Hier weiteres Contra-Argument einfügen]</li>
        <li>Argument 3: [Hier drittes Contra-Argument einfügen]</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>Abwägend lässt sich feststellen, dass... [Eigene Position mit Begründung]</p>

      <p class="tip"><em>Tipp: Fülle die Platzhalter mit konkreten Argumenten und Beispielen. Einen ganzen Essay schreibt der Assistent, wenn das Sprachmodell installiert ist.</em></p>
    `,
    'analyse': `
      <h4>Analyse: ${topic}</h4>

      <p><strong>Einleitung:</strong></p>
      <p>Der vorliegende Text/Das vorliegende Werk behandelt... [Kurze Einordnung in Kontext, Autor, Entstehungszeit]</p>

      <p><strong>Hauptteil, inhaltliche Analyse:</strong></p>
      <ul>
        <li>Thema und Kernaussage</li>
        <li>Aufbau und Struktur</li>
        <li>Zentrale Motive und Symbole</li>
      </ul>

      <p><strong>Sprachliche/Stilistische Analyse:</strong></p>
      <ul>
        <li>Wortwahl und Sprachebene</li>
        <li>Rhetorische Mittel (Metaphern, Vergleiche, etc.)</li>
        <li>Satzbau und Rhythmus</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>Zusammenfassend zeigt die Analyse... [Wirkung und Bedeutung]</p>
    `,
    'interpretation': `
      <h4>Interpretation: ${topic}</h4>

      <p><strong>Einleitung:</strong></p>
      <p>Das Werk "${topic}" von [Autor] aus dem Jahr [Jahr] ist ein bedeutendes Beispiel für... [Gattung, Epoche einordnen]</p>

      <p><strong>Inhaltsangabe:</strong></p>
      <p>[Kurze Zusammenfassung des Inhalts im Präsens]</p>

      <p><strong>Interpretation:</strong></p>
      <ul>
        <li>Deutung der Handlung und Figuren</li>
        <li>Symbolik und Motive</li>
        <li>Historischer/gesellschaftlicher Kontext</li>
        <li>Aktualitätsbezug</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>Die Interpretation zeigt, dass... [Fazit zur Bedeutung des Werks]</p>
    `,
    'charakterisierung': `
      <h4>Charakterisierung: ${topic}</h4>

      <p><strong>Einleitung:</strong></p>
      <p>Die Figur [Name] stammt aus dem Werk [Werk] von [Autor]. Sie spielt eine [zentrale/wichtige] Rolle in der Handlung.</p>

      <p><strong>Äußere Merkmale:</strong></p>
      <ul>
        <li>Alter, Aussehen</li>
        <li>Soziale Stellung, Beruf</li>
        <li>Familiäre Situation</li>
      </ul>

      <p><strong>Innere Merkmale:</strong></p>
      <ul>
        <li>Charaktereigenschaften</li>
        <li>Verhaltensweisen</li>
        <li>Beziehungen zu anderen Figuren</li>
        <li>Entwicklung im Verlauf der Handlung</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>Insgesamt lässt sich die Figur als... charakterisieren. Ihre Funktion im Werk ist...</p>
    `,
    'inhaltsangabe': `
      <h4>Inhaltsangabe: ${topic}</h4>

      <p><strong>Einleitungssatz:</strong></p>
      <p>Das/Die [Textsorte] "[Titel]" von [Autor], erschienen [Jahr], handelt von... [Kernthema in einem Satz]</p>

      <p><strong>Hauptteil:</strong></p>
      <p>[Zusammenfassung der Handlung im Präsens, chronologisch, ohne wörtliche Rede, nur das Wesentliche]</p>

      <p class="tip"><em>Tipps für die Inhaltsangabe:</em></p>
      <ul>
        <li>Immer Präsens verwenden</li>
        <li>Keine wörtliche Rede (indirekte Rede nutzen)</li>
        <li>Keine eigene Meinung</li>
        <li>Nur die wichtigsten Ereignisse</li>
        <li>Sachlich und neutral schreiben</li>
      </ul>
    `,
    'bericht': `
      <h4>Bericht: ${topic}</h4>

      <p><strong>Überschrift:</strong> [Informative Überschrift]</p>

      <p><strong>Einleitung (W-Fragen):</strong></p>
      <ul>
        <li><strong>Was</strong> ist passiert?</li>
        <li><strong>Wer</strong> war beteiligt?</li>
        <li><strong>Wann</strong> ist es passiert?</li>
        <li><strong>Wo</strong> ist es passiert?</li>
      </ul>

      <p><strong>Hauptteil:</strong></p>
      <p>[Chronologischer Ablauf der Ereignisse im Präteritum]</p>
      <ul>
        <li><strong>Wie</strong> ist es passiert? (Hergang)</li>
        <li><strong>Warum</strong> ist es passiert? (Ursachen)</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>[Folgen, Konsequenzen, aktueller Stand]</p>
    `,
    'kommentar': `
      <h4>Kommentar: ${topic}</h4>

      <p><strong>Einleitung:</strong></p>
      <p>[Aktueller Anlass, der zum Thema hinführt]</p>

      <p><strong>These:</strong></p>
      <p>[Klare Positionierung zum Thema]</p>

      <p><strong>Argumentation:</strong></p>
      <ul>
        <li>Argument 1 mit Beispiel/Beleg</li>
        <li>Argument 2 mit Beispiel/Beleg</li>
        <li>Gegenargument und Entkräftung</li>
      </ul>

      <p><strong>Schluss:</strong></p>
      <p>[Zusammenfassung der eigenen Position, ggf. Appell oder Ausblick]</p>

      <p class="tip"><em>Im Kommentar ist die eigene Meinung ausdrücklich erwünscht.</em></p>
    `
  };

  return templates[type] || templates['eroerterung'];
}

function formatEssayOutput(text) {
  return escapeHtml(text)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function copyEssay() {
  copyOutput('essaySolution', 'Essay kopiert');
}

async function generateSummary() {
  const text = document.getElementById('summaryInput').value.trim();
  const type = document.getElementById('summaryType').value;
  const subject = document.getElementById('summarySubject').value;

  if (!text) {
    toolError('summaryError', 'Füg zuerst einen Text ein.', 'summaryInput');
    return;
  }
  toolError('summaryError', '');

  document.getElementById('summaryResult').hidden = false;
  document.getElementById('summarySolution').innerHTML = '<p class="tool-wait">Fasse den Text zusammen …</p>';

  if (ollamaAvailable) {
    try {
      const lengthMap = {
        'kurz': 'short',
        'stichpunkte': 'medium',
        'detailliert': 'long',
        'lernkarten': 'medium'
      };

      const response = await fetch('/api/hub/assistant/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text + (subject ? `\n\n[Fach: ${subject}]` : ''),
          length: lengthMap[type] || 'medium',
          model: ollamaModel
        }),
        signal: AbortSignal.timeout(120000)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.summary) {
          document.getElementById('summarySolution').innerHTML = formatSummaryOutput(data.summary, type);
          return;
        }
      }
    } catch (e) {
      console.log('Summary generation error:', e);
    }
  }

  document.getElementById('summarySolution').innerHTML = getOfflineSummary(text, type);
}

function getOfflineSummary(text, type) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const words = text.split(/\s+/);
  const wordCount = words.length;

  let result = '';

  switch (type) {
    case 'kurz':
      const shortSummary = sentences.slice(0, Math.min(3, sentences.length)).join(' ');
      result = `
        <p><strong>Kurze Zusammenfassung:</strong></p>
        <p>${escapeHtml(shortSummary)}</p>
        <p class="stats">Original: ${wordCount} Wörter, Zusammenfassung: ${shortSummary.split(/\s+/).length} Wörter</p>
      `;
      break;

    case 'stichpunkte':
      const bulletPoints = sentences.slice(0, Math.min(6, sentences.length));
      result = `
        <p><strong>Stichpunkte:</strong></p>
        <ul>
          ${bulletPoints.map(s => `<li>${escapeHtml(s.trim())}</li>`).join('')}
        </ul>
      `;
      break;

    case 'detailliert':
      result = `
        <p><strong>Detaillierte Zusammenfassung:</strong></p>
        <p><em>Hauptinhalt:</em> ${escapeHtml(sentences.slice(0, 2).join(' '))}</p>
        <p><em>Weitere Details:</em> ${escapeHtml(sentences.slice(2, 5).join(' '))}</p>
        ${sentences.length > 5 ? `<p><em>Zusätzliche Informationen:</em> ${escapeHtml(sentences.slice(5, 8).join(' '))}</p>` : ''}
        <p class="stats">Original: ${wordCount} Wörter, ${sentences.length} Sätze</p>
      `;
      break;

    case 'lernkarten':
      const cards = sentences.slice(0, 5).map((s, i) => {
        const trimmed = s.trim();
        return `
          <div class="flashcard">
            <div class="flashcard-q"><strong>Q${i + 1}:</strong> Was bedeutet: "${escapeHtml(trimmed.substring(0, 50))}..."?</div>
            <div class="flashcard-a"><strong>A:</strong> ${escapeHtml(trimmed)}</div>
          </div>
        `;
      });
      result = `
        <p><strong>Lernkarten:</strong></p>
        ${cards.join('')}
      `;
      break;
  }

  if (!ollamaAvailable) {
    result += `<p class="tip"><em>Bessere Zusammenfassungen schreibt der Assistent, wenn das Sprachmodell installiert ist.</em></p>`;
  } else {
    result += `<p class="tip"><em>Das Sprachmodell hat nicht geantwortet. Hier ist eine einfache Textanalyse.</em></p>`;
  }

  return result;
}

function formatSummaryOutput(text, type) {
  if (type === 'stichpunkte') {
    const lines = text.split('\n').filter(l => l.trim());
    return '<ul>' + lines.map(l => `<li>${escapeHtml(l.replace(/^[-•*]\s*/, ''))}</li>`).join('') + '</ul>';
  }

  if (type === 'lernkarten') {
    const cards = text.split(/Q:|Frage:/gi).filter(c => c.trim());
    return cards.map(card => {
      const parts = card.split(/A:|Antwort:/i);
      if (parts.length >= 2) {
        return `
          <div class="flashcard">
            <div class="flashcard-q"><strong>Q:</strong> ${escapeHtml(parts[0].trim())}</div>
            <div class="flashcard-a"><strong>A:</strong> ${escapeHtml(parts[1].trim())}</div>
          </div>
        `;
      }
      return '';
    }).join('');
  }

  return escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>');
}

function copySummary() {
  copyOutput('summarySolution', 'Zusammenfassung kopiert');
}

const TOOLS = { math: 'mathModal', essay: 'essayModal', summary: 'summaryModal' };
let clearAsked = 0;

function toolError(id, text, focusId = '') {
  const box = document.getElementById(id);
  box.hidden = !text;
  box.innerHTML = text ? `${icon('circle-alert')}<span>${escapeHtml(text)}</span>` : '';
  if (text && focusId) document.getElementById(focusId).focus();
}

async function copyOutput(id, done) {
  try {
    await navigator.clipboard.writeText(document.getElementById(id).innerText);
    toast(done, { icon: 'copy' });
  } catch {
    getSelection()?.selectAllChildren(document.getElementById(id));
    toast('Der Text ist markiert. Kopier ihn mit der Tastatur.', { icon: 'info' });
  }
}

function askClear(button) {
  if (Date.now() - clearAsked < 4000) {
    clearAsked = 0;
    button.classList.remove('danger-button');
    button.querySelector('span').textContent = 'Chat leeren';
    clearChat();
    return;
  }
  clearAsked = Date.now();
  button.classList.add('danger-button');
  button.querySelector('span').textContent = 'Wirklich leeren?';
  setTimeout(() => {
    if (Date.now() - clearAsked < 3900) return;
    button.classList.remove('danger-button');
    button.querySelector('span').textContent = 'Chat leeren';
  }, 4000);
}

function openTool(name) {
  const dialog = document.getElementById(TOOLS[name]);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('textarea, input')?.focus();
}

function onToolClick(event) {
  const dialog = event.currentTarget;
  const target = event.target;
  if (target === dialog || target.closest('[data-close]')) {
    dialog.close();
    return;
  }
  const category = target.closest('[data-cat]');
  if (category) selectMathCategory(category.dataset.cat);
  const example = target.closest('[data-example]');
  if (example) setMathExample(example.dataset.example);
  if (target.closest('#mathSolve')) solveMath();
  if (target.closest('#essayGenerate')) generateEssay();
  if (target.closest('#summaryGenerate')) generateSummary();
  const copy = target.closest('[data-copy]');
  if (copy) (copy.dataset.copy === 'essaySolution' ? copyEssay : copySummary)();
}

export function init() {
  const page = document.getElementById('chatPage');
  if (!page) return;
  fetch('/api/hub/assistant/warmup', { method: 'POST' }).catch(() => {});
  loadChatHistory();
  checkAIStatus();
  addEventListener('pagehide', () => navigator.sendBeacon('/api/hub/assistant/release'));
  addEventListener('pageshow', (event) => {
    if (event.persisted) fetch('/api/hub/assistant/warmup', { method: 'POST' }).catch(() => {});
  });
  document.getElementById('chatForm').addEventListener('submit', sendMessage);
  page.addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-suggest]');
    if (suggestion) sendSuggestion(suggestion.dataset.suggest);
    const tool = event.target.closest('[data-tool]');
    if (tool) openTool(tool.dataset.tool);
    const clear = event.target.closest('#chatClear');
    if (clear) askClear(clear);
  });
  Object.values(TOOLS).forEach((id) => document.getElementById(id).addEventListener('click', onToolClick));
}
