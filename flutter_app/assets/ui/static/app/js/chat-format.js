// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripActionBlocks(text) {
  if (!text) return '';
  let out = text.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '');
  while (true) {
    const idx = out.indexOf('[ACTION]');
    if (idx === -1) break;
    let j = idx + '[ACTION]'.length;
    while (j < out.length && /\s/.test(out[j])) j++;
    if (out[j] !== '{') {
      out = out.slice(0, idx) + out.slice(idx + '[ACTION]'.length);
      continue;
    }
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = j; k < out.length; k++) {
      const c = out[k];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end === -1) { out = out.slice(0, idx); break; }
    out = out.slice(0, idx) + out.slice(end + 1);
  }
  out = out.replace(/\n*-{2,}\s*\n+\s*\{[\s\S]*?("type"|"name"|"title")[\s\S]*$/, '');
  out = out.replace(/\n+\s*\{\s*"(?:type|name|title)"\s*:[\s\S]*$/, '');
  return out.replace(/\s+$/, '');
}

function renderLatex(latex) {
  let s = latex;

  s = s.replace(/\\(?:limits|nolimits|displaystyle|textstyle|scriptstyle|mathstrut|phantom|relax)(?![A-Za-z])/g, '');
  s = s.replace(/\\(?:quad|qquad)(?![A-Za-z])/g, ' ');
  s = s.replace(/\\[,;:!]/g, ' ');
  s = s.replace(/\\ /g, ' ');
  s = s.replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002').replace(/\\\|/g, '\u0003');

  s = s.replace(/\\begin\{(cases|aligned|align\*?|gathered|split)\}([\s\S]*?)\\end\{\1\}/g, (_, env, body) => {
    const rows = body.split(/\\\\+/).map(r => r.trim()).filter(Boolean);
    const cells = rows.map(r => `<span class="math-row">${r.replace(/&/g, ' ')}</span>`).join('');
    return `<span class="math-env math-${env === 'cases' ? 'cases' : 'stack'}">${cells}</span>`;
  });
  s = s.replace(/\\begin\{([pbvVB])?matrix\}([\s\S]*?)\\end\{\1?matrix\}/g, (_, kind, body) => {
    kind = kind || '';
    const rows = body.split(/\\\\+/).map(r => r.trim()).filter(Boolean);
    const grid = rows.map(r => {
      const cells = r.split('&').map(c => `<span class="math-cell">${c.trim()}</span>`).join('');
      return `<span class="math-row">${cells}</span>`;
    }).join('');
    return `<span class="math-matrix math-matrix-${kind}">${grid}</span>`;
  });

  s = s.replace(/\\left\s*([\(\[\|\{])/g, '$1').replace(/\\right\s*([\)\]\|\}])/g, '$1');
  s = s.replace(/\\left\./g, '').replace(/\\right\./g, '');

  s = s.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/\^(-?[A-Za-z][A-Za-z0-9]*)/g, '<sup>$1</sup>');
  s = s.replace(/_(-?[A-Za-z][A-Za-z0-9]*)/g, '<sub>$1</sub>');
  s = s.replace(/\^(-?\d+(?:\.\d+)?)/g, '<sup>$1</sup>');
  s = s.replace(/_(-?\d+(?:\.\d+)?)/g, '<sub>$1</sub>');

  s = s.replace(/\\text\s*\{([^{}]*)\}/g, '<span class="math-text">$1</span>');
  s = s.replace(/\\(?:mathbf|boldsymbol)\s*\{([\s\S]*?)\}/g, '<span class="math-bold">$1</span>');
  s = s.replace(/\\mathit\s*\{([\s\S]*?)\}/g, '<span class="math-italic">$1</span>');
  s = s.replace(/\\(?:mathrm|mathsf|operatorname)\s*\{([\s\S]*?)\}/g, '<span class="math-upright">$1</span>');
  s = s.replace(/\\(?:mathbb|mathcal|mathfrak|mathscr)\s*\{([\s\S]*?)\}/g, '<span class="math-upright">$1</span>');

  const COMB = { hat: '\u0302', widehat: '\u0302', tilde: '\u0303', widetilde: '\u0303',
           bar: '\u0304', dot: '\u0307', ddot: '\u0308', vec: '\u20D7', acute: '\u0301', grave: '\u0300', breve: '\u0306', check: '\u030C' };
  for (const cmd of Object.keys(COMB)) {
    const mark = COMB[cmd];
    s = s.replace(new RegExp('\\\\' + cmd + '\\s*\\{([^{}])\\}', 'g'), (_, c) => c + mark);
    s = s.replace(new RegExp('\\\\' + cmd + '\\s*\\{([^{}]+)\\}', 'g'),
      (_, c) => `<span class="math-accent math-accent-${cmd}">${c}</span>`);
  }

  s = s.replace(/\\overline\s*\{([^{}]+)\}/g, '<span class="math-overline">$1</span>');
  s = s.replace(/\\underline\s*\{([^{}]+)\}/g, '<span class="math-underline">$1</span>');
  s = s.replace(/\\overrightarrow\s*\{([^{}]+)\}/g, '<span class="math-overrightarrow">$1</span>');
  s = s.replace(/\\overleftarrow\s*\{([^{}]+)\}/g, '<span class="math-overleftarrow">$1</span>');
  s = s.replace(/\\overleftrightarrow\s*\{([^{}]+)\}/g, '<span class="math-overlrarrow">$1</span>');
  s = s.replace(/\\overbrace\s*\{([^{}]+)\}/g, '<span class="math-overbrace">$1</span>');
  s = s.replace(/\\underbrace\s*\{([^{}]+)\}/g, '<span class="math-underbrace">$1</span>');

  s = s.replace(/\\(?:binom|tbinom|dbinom)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
    '<span class="math-binom">(<span class="math-binom-stack"><span class="math-binom-top">$1</span><span class="math-binom-bot">$2</span></span>)</span>');

  s = s.replace(/\\sqrt\s*\[([^\[\]]+)\]\s*\{([^{}]+)\}/g, '<span class="sqrt"><sup class="math-root-idx">$1</sup>√<span class="radicand">$2</span></span>');
  s = s.replace(/\\sqrt\s*\{([^{}]+)\}/g, '<span class="sqrt">√<span class="radicand">$1</span></span>');
  s = s.replace(/\\sqrt\s*([A-Za-z0-9])/g, '<span class="sqrt">√<span class="radicand">$1</span></span>');

  for (let i = 0; i < 4; i++) {
    s = s.replace(/\\(?:d|t|c)?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
      '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>');
  }
  s = s.replace(/\\(?:d|t|c)?frac\s*([A-Za-z0-9])\s*([A-Za-z0-9])/g,
    '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>');

  const greek = {alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',varepsilon:'ε',zeta:'ζ',eta:'η',theta:'θ',vartheta:'ϑ',iota:'ι',kappa:'κ',lambda:'λ',mu:'μ',nu:'ν',xi:'ξ',pi:'π',varpi:'ϖ',rho:'ρ',varrho:'ϱ',sigma:'σ',varsigma:'ς',tau:'τ',upsilon:'υ',phi:'φ',varphi:'ϕ',chi:'χ',psi:'ψ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Xi:'Ξ',Pi:'Π',Sigma:'Σ',Upsilon:'Υ',Phi:'Φ',Psi:'Ψ',Omega:'Ω'};
  for (const k in greek) s = s.replace(new RegExp('\\\\' + k + '(?![A-Za-z])', 'g'), greek[k]);

  const ops = {
    cdot:'·', cdots:'⋯', ldots:'…', dots:'…', vdots:'⋮', ddots:'⋱',
    times:'×', div:'÷', ast:'∗', star:'⋆', circ:'∘', bullet:'•',
    pm:'±', mp:'∓',
    leq:'≤', le:'≤', geq:'≥', ge:'≥', neq:'≠', ne:'≠', ll:'≪', gg:'≫',
    approx:'≈', equiv:'≡', sim:'∼', simeq:'≃', cong:'≅', propto:'∝',
    infty:'∞', partial:'∂', nabla:'∇',
    sum:'∑', prod:'∏', coprod:'∐', bigcup:'⋃', bigcap:'⋂', bigoplus:'⨁', bigotimes:'⨂',
    int:'∫', iint:'∬', iiint:'∭', iiiint:'⨌', oint:'∮', oiint:'∯', oiiint:'∰',
    forall:'∀', exists:'∃', nexists:'∄',
    in:'∈', notin:'∉', ni:'∋',
    subset:'⊂', supset:'⊃', subseteq:'⊆', supseteq:'⊇',
    cup:'∪', cap:'∩', emptyset:'∅', varnothing:'∅', setminus:'∖',
    rightarrow:'→', Rightarrow:'⇒', leftarrow:'←', Leftarrow:'⇐',
    leftrightarrow:'↔', Leftrightarrow:'⇔',
    longrightarrow:'⟶', longleftarrow:'⟵', Longrightarrow:'⟹', Longleftarrow:'⟸',
    to:'→', mapsto:'↦', gets:'←', implies:'⇒', iff:'⇔',
    lceil:'⌈', rceil:'⌉', lfloor:'⌊', rfloor:'⌋', langle:'⟨', rangle:'⟩',
    degree:'°', prime:'′', pprime:'″', backslash:'\\',
    hbar:'ℏ', ell:'ℓ', Re:'ℜ', Im:'ℑ', aleph:'ℵ', wp:'℘',
    land:'∧', lor:'∨', lnot:'¬', neg:'¬', wedge:'∧', vee:'∨',
    top:'⊤', bot:'⊥', vdash:'⊢', models:'⊨',
    oplus:'⊕', otimes:'⊗', ominus:'⊖', odot:'⊙',
    perp:'⊥', parallel:'∥',
    mid:'|', vert:'|', Vert:'‖',
    triangle:'△', square:'□', diamond:'◇',
  };
  for (const k in ops) s = s.replace(new RegExp('\\\\' + k + '(?![A-Za-z])', 'g'), ops[k]);

  s = s.replace(/\^(-?[^\s^_{}$\\])/g, '<sup>$1</sup>');
  s = s.replace(/_(-?[^\s^_{}$\\])/g, '<sub>$1</sub>');

  s = s.replace(/\\(ln|log|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|exp|max|min|lim|liminf|limsup|sup|inf|arg|det|dim|ker|mod|gcd|lcm|Pr|deg)(?![A-Za-z])/g, '<span class="math-fn">$1</span>');

  s = s.replace(/\\\\/g, '<br>');
  s = s.replace(/\\([A-Za-z]+)/g, '$1');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '{').replace(/\u0002/g, '}').replace(/\u0003/g, '‖');
  return s;
}

function renderMath(escapedText) {
  const normalize = m => m.replace(/\s+/g, ' ').trim();
  let out = escapedText;
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `<span class="math-block">${renderLatex(normalize(m))}</span>`);
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `<span class="math-block">${renderLatex(normalize(m))}</span>`);
  out = out.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, pre, m) => `${pre}<span class="math-inline">${renderLatex(normalize(m))}</span>`);
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `<span class="math-inline">${renderLatex(normalize(m))}</span>`);
  return out;
}

export function formatMessage(text) {
  const stripped = stripActionBlocks(text || '');
  let html = escapeHtml(stripped);
  html = renderMath(html);
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^\*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}
