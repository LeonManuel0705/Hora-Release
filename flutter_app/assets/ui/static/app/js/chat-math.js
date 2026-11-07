// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MATH_CALLS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, log: Math.log, sqrt: Math.sqrt, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp, min: Math.min, max: Math.max };
const MATH_VALUES = { PI: Math.PI, E: Math.E };
const TOKENS = /Math\.[A-Za-z]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\*\*|[-+*/(),]|\S/g;

// The page's security rules forbid turning text into code, so the expression is read by hand.
export function readExpression(text) {
  const tokens = String(text).match(TOKENS) || [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected) => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) throw new SyntaxError(`expected ${expected || 'more'}`);
    return token;
  };
  const sum = () => {
    let value = product();
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + product() : value - product();
    return value;
  };
  const product = () => {
    let value = unary();
    while (peek() === '*' || peek() === '/') value = take() === '*' ? value * unary() : value / unary();
    return value;
  };
  const unary = () => {
    if (peek() === '-') {
      take();
      return -unary();
    }
    if (peek() === '+') {
      take();
      return unary();
    }
    return power();
  };
  const power = () => {
    const base = primary();
    if (peek() !== '**') return base;
    take();
    return base ** unary();
  };
  const primary = () => {
    const token = take();
    if (token === '(') {
      const value = sum();
      take(')');
      return value;
    }
    if (/^[\d.]/.test(token)) {
      const value = Number(token);
      if (Number.isNaN(value)) throw new SyntaxError(token);
      return value;
    }
    const name = token.startsWith('Math.') ? token.slice(5) : '';
    if (Object.hasOwn(MATH_VALUES, name)) return MATH_VALUES[name];
    if (!Object.hasOwn(MATH_CALLS, name)) throw new SyntaxError(token);
    take('(');
    const args = [sum()];
    while (peek() === ',') {
      take();
      args.push(sum());
    }
    take(')');
    return MATH_CALLS[name](...args);
  };
  const value = sum();
  if (at !== tokens.length) throw new SyntaxError(tokens[at]);
  return value;
}

export function evaluateExpression(expr, x) {
  let normalized = expr
    .replace(/\s+/g, '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\^/g, '**')
    .replace(/(\d)([x])/g, '$1*$2')
    .replace(/([x])(\d)/g, '$1*$2')
    .replace(/\)(\d)/g, ')*$1')
    .replace(/(\d)\(/g, '$1*(')
    .replace(/\)\(/g, ')*(')
    .replace(/([x])\(/g, '$1*(')
    .replace(/\)([x])/g, ')*$1')
    .replace(/sin/g, 'Math.sin')
    .replace(/cos/g, 'Math.cos')
    .replace(/tan/g, 'Math.tan')
    .replace(/sqrt/g, 'Math.sqrt')
    .replace(/log/g, 'Math.log')
    .replace(/ln/g, 'Math.log')
    .replace(/abs/g, 'Math.abs')
    .replace(/pi/gi, 'Math.PI')
    .replace(/e(?![a-z])/gi, 'Math.E');

  normalized = normalized.replace(/x/g, `(${x})`);

  const safeMath = normalized.replace(/Math\.(sin|cos|tan|abs|log|sqrt|pow|floor|ceil|round|PI|E|exp|min|max)/g, '');
  if (!/^[\d\s+\-*/().eE,]+$/.test(safeMath)) {
    return NaN;
  }

  try {
    return readExpression(normalized);
  } catch (e) {
    return NaN;
  }
}

function findRootNewton(leftExpr, rightExpr, initialGuess = 0, tolerance = 1e-10, maxIterations = 100) {
  const f = (x) => evaluateExpression(leftExpr, x) - evaluateExpression(rightExpr, x);

  const df = (x) => {
    const h = 1e-8;
    return (f(x + h) - f(x - h)) / (2 * h);
  };

  let x = initialGuess;
  for (let i = 0; i < maxIterations; i++) {
    const fx = f(x);
    const dfx = df(x);

    if (Math.abs(fx) < tolerance) {
      return x;
    }

    if (Math.abs(dfx) < 1e-15) {
      x += 0.5;
      continue;
    }

    x = x - fx / dfx;

    if (Math.abs(x) > 1e10) {
      return NaN;
    }
  }

  if (Math.abs(f(x)) < tolerance * 100) {
    return x;
  }
  return NaN;
}

function findAllRoots(leftExpr, rightExpr, degree = 2) {
  const roots = [];
  const startingPoints = [-100, -50, -20, -10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10, 20, 50, 100];

  for (const guess of startingPoints) {
    const root = findRootNewton(leftExpr, rightExpr, guess);

    if (!isNaN(root) && isFinite(root)) {
      const isDuplicate = roots.some(r => Math.abs(r - root) < 1e-6);
      if (!isDuplicate) {
        const f = evaluateExpression(leftExpr, root) - evaluateExpression(rightExpr, root);
        if (Math.abs(f) < 1e-6) {
          roots.push(root);
        }
      }
    }

    if (roots.length >= degree + 2) break;
  }

  return roots.sort((a, b) => a - b);
}

function parseQuadraticCoefficients(leftExpr, rightExpr) {
  const f = (x) => evaluateExpression(leftExpr, x) - evaluateExpression(rightExpr, x);

  const y0 = f(0);
  const y1 = f(1);
  const y_1 = f(-1);

  const c = y0;
  const a = (y1 + y_1) / 2 - c;
  const b = (y1 - y_1) / 2;

  const y2 = f(2);
  const expected = 4 * a + 2 * b + c;

  if (Math.abs(y2 - expected) < 1e-6) {
    return { a, b, c, isQuadratic: true };
  }

  return { a: 0, b: 0, c: 0, isQuadratic: false };
}

export function solveEquation(input) {
  let eq = input.replace(/\s+/g, '').replace(/²/g, '^2').replace(/³/g, '^3');

  const parts = eq.split('=');
  if (parts.length !== 2) {
    return '<p class="error">Gleichung muss ein = Zeichen enthalten</p>';
  }

  let leftExpr = parts[0];
  let rightExpr = parts[1];

  if (!leftExpr) leftExpr = '0';
  if (!rightExpr) rightExpr = '0';

  let steps = [`<div class="solution-step"><strong>Gleichung:</strong> ${escapeHtml(input)}</div>`];

  const leftHasX = leftExpr.includes('x');
  const rightHasX = rightExpr.includes('x');

  if (!leftHasX && !rightHasX) {
    return '<p class="error">Gleichung enthält keine Variable x</p>';
  }

  const hasX3 = eq.includes('x^3') || eq.includes('x³');
  const hasX2 = eq.includes('x^2') || eq.includes('x²');

  let degree = 1;
  if (hasX3) degree = 3;
  else if (hasX2) degree = 2;

  steps.push(`<div class="solution-step"><strong>Umgeformt:</strong> (${escapeHtml(leftExpr)}) - (${escapeHtml(rightExpr)}) = 0</div>`);

  if (degree === 2) {
    const coeffs = parseQuadraticCoefficients(leftExpr, rightExpr);

    if (coeffs.isQuadratic && coeffs.a !== 0) {
      const { a, b, c } = coeffs;
      const discriminant = b * b - 4 * a * c;

      steps.push(`<div class="solution-step"><strong>Standardform:</strong> ${a.toFixed(4)}x² + ${b.toFixed(4)}x + ${c.toFixed(4)} = 0</div>`);
      steps.push(`<div class="solution-step"><strong>Koeffizienten:</strong> a = ${a.toFixed(4)}, b = ${b.toFixed(4)}, c = ${c.toFixed(4)}</div>`);
      steps.push(`<div class="solution-step"><strong>Diskriminante:</strong> D = b² - 4ac = ${discriminant.toFixed(4)}</div>`);

      if (discriminant > 0) {
        const x1 = (-b + Math.sqrt(discriminant)) / (2 * a);
        const x2 = (-b - Math.sqrt(discriminant)) / (2 * a);
        steps.push(`<div class="solution-step">D > 0 → Zwei reelle Lösungen</div>`);
        steps.push(`<div class="solution-step">x₁ = (-b + √D) / 2a = ${x1.toFixed(6)}</div>`);
        steps.push(`<div class="solution-step">x₂ = (-b - √D) / 2a = ${x2.toFixed(6)}</div>`);

        const verify1 = Math.abs(evaluateExpression(leftExpr, x1) - evaluateExpression(rightExpr, x1));
        const verify2 = Math.abs(evaluateExpression(leftExpr, x2) - evaluateExpression(rightExpr, x2));
        steps.push(`<div class="solution-step"><em>Probe: f(x₁) = ${verify1.toExponential(2)}, f(x₂) = ${verify2.toExponential(2)}</em></div>`);

        steps.push(`<div class="solution-final"><strong>x₁ ≈ ${x1.toFixed(6)}<br>x₂ ≈ ${x2.toFixed(6)}</strong></div>`);
      } else if (Math.abs(discriminant) < 1e-10) {
        const x = -b / (2 * a);
        steps.push(`<div class="solution-step">D = 0 → Eine doppelte Nullstelle</div>`);
        steps.push(`<div class="solution-final"><strong>x = ${x.toFixed(6)}</strong></div>`);
      } else {
        const realPart = -b / (2 * a);
        const imagPart = Math.sqrt(-discriminant) / (2 * a);
        steps.push(`<div class="solution-step">D < 0 → Komplexe Lösungen</div>`);
        steps.push(`<div class="solution-final"><strong>x₁ = ${realPart.toFixed(4)} + ${imagPart.toFixed(4)}i<br>x₂ = ${realPart.toFixed(4)} - ${imagPart.toFixed(4)}i</strong></div>`);
      }

      return steps.join('');
    }
  }

  steps.push(`<div class="solution-step"><strong>Numerische Lösung:</strong></div>`);

  const roots = findAllRoots(leftExpr, rightExpr, degree);

  if (roots.length === 0) {
    steps.push(`<div class="solution-step">Keine reellen Lösungen gefunden.</div>`);
    return steps.join('');
  }

  roots.forEach((root, i) => {
    const roundedRoot = Math.abs(root) < 1e-10 ? 0 : root;
    const verify = Math.abs(evaluateExpression(leftExpr, root) - evaluateExpression(rightExpr, root));
    steps.push(`<div class="solution-step">x${roots.length > 1 ? '₁₂₃₄₅'[i] : ''} = ${roundedRoot.toFixed(6)} <em>(Probe: ${verify.toExponential(2)})</em></div>`);
  });

  if (roots.length === 1) {
    steps.push(`<div class="solution-final"><strong>x ≈ ${roots[0].toFixed(6)}</strong></div>`);
  } else {
    const formatted = roots.map((r, i) => `x${'₁₂₃₄₅'[i]} ≈ ${r.toFixed(6)}`).join('<br>');
    steps.push(`<div class="solution-final"><strong>${formatted}</strong></div>`);
  }

  return steps.join('');
}

export function solveDerivative(input) {
  const funcMatch = input.match(/f\(x\)\s*=\s*(.+)/i);
  if (!funcMatch) {
    return '<p>Bitte im Format f(x) = ... eingeben</p>';
  }

  let func = funcMatch[1].replace(/\s+/g, '').replace(/²/g, '^2').replace(/³/g, '^3');
  let steps = [`<div class="solution-step"><strong>Funktion:</strong> f(x) = ${escapeHtml(funcMatch[1])}</div>`];
  let derivative = '';
  let terms = [];

  func = func.replace(/-/g, '+-');
  const parts = func.split('+').filter(p => p);

  steps.push('<div class="solution-step"><strong>Ableitungsregeln anwenden:</strong></div>');

  parts.forEach(term => {
    term = term.trim();
    if (!term) return;

    if (!term.includes('x')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → 0 (Konstante)</div>`);
      return;
    }

    const powerMatch = term.match(/^(-?\d*\.?\d*)x\^?(\d*)$/);
    if (powerMatch) {
      const coef = parseFloat(powerMatch[1] || 1) || 1;
      const exp = parseFloat(powerMatch[2] || 1) || 1;
      const newCoef = coef * exp;
      const newExp = exp - 1;

      let derivTerm = '';
      if (newExp === 0) derivTerm = `${newCoef}`;
      else if (newExp === 1) derivTerm = `${newCoef}x`;
      else derivTerm = `${newCoef}x^${newExp}`;

      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ${newCoef}x^${newExp} = ${derivTerm} (Potenzregel)</div>`);
      terms.push(derivTerm);
      return;
    }

    if (term.includes('sin')) {
      const coefMatch = term.match(/^(-?\d*)/);
      const coef = parseFloat(coefMatch[1] || 1) || 1;
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ${coef}cos(x)</div>`);
      terms.push(`${coef}cos(x)`);
      return;
    }

    if (term.includes('cos')) {
      const coefMatch = term.match(/^(-?\d*)/);
      const coef = parseFloat(coefMatch[1] || 1) || 1;
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ${-coef}sin(x)</div>`);
      terms.push(`${-coef}sin(x)`);
      return;
    }

    if (term.includes('e^x')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → e^x</div>`);
      terms.push('e^x');
      return;
    }

    if (term.includes('ln')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → 1/x</div>`);
      terms.push('1/x');
      return;
    }
  });

  derivative = terms.join(' + ').replace(/\+ -/g, '- ');
  steps.push(`<div class="solution-final"><strong>f'(x) = ${derivative || '0'}</strong></div>`);

  return steps.join('');
}

export function solveIntegral(input) {
  let func = input.replace(/∫/g, '').replace(/dx/gi, '').replace(/\s+/g, '');
  let bounds = null;

  const boundsMatch = input.match(/von\s*(-?\d+\.?\d*)\s*bis\s*(-?\d+\.?\d*)/i);
  if (boundsMatch) {
    bounds = { lower: parseFloat(boundsMatch[1]), upper: parseFloat(boundsMatch[2]) };
    func = func.replace(/von.*/i, '').trim();
  }

  func = func.replace(/²/g, '^2').replace(/³/g, '^3');

  let steps = [`<div class="solution-step"><strong>Integral:</strong> ∫ ${escapeHtml(func)} dx</div>`];
  let terms = [];

  func = func.replace(/-/g, '+-');
  const parts = func.split('+').filter(p => p);

  steps.push('<div class="solution-step"><strong>Stammfunktion bilden:</strong></div>');

  parts.forEach(term => {
    term = term.trim();
    if (!term) return;

    if (!term.includes('x')) {
      const c = parseFloat(term);
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ${c}x</div>`);
      terms.push(`${c}x`);
      return;
    }

    const powerMatch = term.match(/^(-?\d*\.?\d*)x\^?(\d*)$/);
    if (powerMatch) {
      const coef = parseFloat(powerMatch[1] || 1) || 1;
      const exp = parseFloat(powerMatch[2] || 1) || 1;
      const newCoef = coef / (exp + 1);
      const newExp = exp + 1;

      const formattedCoef = Number.isInteger(newCoef) ? newCoef : newCoef.toFixed(4);
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ${formattedCoef}x^${newExp}</div>`);
      terms.push(`${formattedCoef}x^${newExp}`);
      return;
    }

    if (term.includes('sin')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → -cos(x)</div>`);
      terms.push('-cos(x)');
      return;
    }

    if (term.includes('cos')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → sin(x)</div>`);
      terms.push('sin(x)');
      return;
    }

    if (term.includes('e^x')) {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → e^x</div>`);
      terms.push('e^x');
      return;
    }

    if (term === '1/x') {
      steps.push(`<div class="solution-step">• ${escapeHtml(term)} → ln|x|</div>`);
      terms.push('ln|x|');
      return;
    }
  });

  const antiderivative = terms.join(' + ').replace(/\+ -/g, '- ') + ' + C';
  steps.push(`<div class="solution-step"><strong>Stammfunktion:</strong> F(x) = ${antiderivative}</div>`);

  if (bounds) {
    steps.push(`<div class="solution-step"><strong>Bestimmtes Integral von ${bounds.lower} bis ${bounds.upper}:</strong></div>`);
    steps.push(`<div class="solution-step">F(${bounds.upper}) - F(${bounds.lower})</div>`);

    let result = 0;
    terms.forEach(term => {
      const match = term.match(/(-?\d*\.?\d*)x\^(\d+)/);
      if (match) {
        const coef = parseFloat(match[1]) || 1;
        const exp = parseInt(match[2]);
        result += coef * (Math.pow(bounds.upper, exp) - Math.pow(bounds.lower, exp));
      }
    });

    steps.push(`<div class="solution-final"><strong>= ${result.toFixed(4)}</strong></div>`);
  } else {
    steps.push(`<div class="solution-final"><strong>F(x) = ${antiderivative}</strong></div>`);
  }

  return steps.join('');
}

export function solveVector(input) {
  const inp = input.toLowerCase();

  const parseVector = (str) => {
    const match = str.match(/\((-?\d+\.?\d*),\s*(-?\d+\.?\d*),?\s*(-?\d+\.?\d*)?\)/);
    if (match) {
      return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3] || 0)];
    }
    return null;
  };

  if (inp.includes('betrag')) {
    const vec = parseVector(input);
    if (vec) {
      const mag = Math.sqrt(vec[0]**2 + vec[1]**2 + vec[2]**2);
      return `
        <div class="solution-step"><strong>Vektor:</strong> (${vec.join(', ')})</div>
        <div class="solution-step">|v| = √(${vec[0]}² + ${vec[1]}² + ${vec[2]}²)</div>
        <div class="solution-step">|v| = √(${vec[0]**2} + ${vec[1]**2} + ${vec[2]**2})</div>
        <div class="solution-step">|v| = √${vec[0]**2 + vec[1]**2 + vec[2]**2}</div>
        <div class="solution-final"><strong>|v| = ${mag.toFixed(4)}</strong></div>
      `;
    }
  }

  if (inp.includes('·') || inp.includes('skalar')) {
    const vectors = input.match(/\((-?\d+\.?\d*),\s*(-?\d+\.?\d*),?\s*(-?\d+\.?\d*)?\)/g);
    if (vectors && vectors.length >= 2) {
      const v1 = parseVector(vectors[0]);
      const v2 = parseVector(vectors[1]);
      const dot = v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2];
      return `
        <div class="solution-step"><strong>Vektoren:</strong> a = (${v1.join(', ')}), b = (${v2.join(', ')})</div>
        <div class="solution-step">a · b = ${v1[0]}·${v2[0]} + ${v1[1]}·${v2[1]} + ${v1[2]}·${v2[2]}</div>
        <div class="solution-step">a · b = ${v1[0]*v2[0]} + ${v1[1]*v2[1]} + ${v1[2]*v2[2]}</div>
        <div class="solution-final"><strong>a · b = ${dot}</strong></div>
      `;
    }
  }

  if (inp.includes('×') || inp.includes('kreuz')) {
    const vectors = input.match(/\((-?\d+\.?\d*),\s*(-?\d+\.?\d*),?\s*(-?\d+\.?\d*)?\)/g);
    if (vectors && vectors.length >= 2) {
      const v1 = parseVector(vectors[0]);
      const v2 = parseVector(vectors[1]);
      const cross = [
        v1[1]*v2[2] - v1[2]*v2[1],
        v1[2]*v2[0] - v1[0]*v2[2],
        v1[0]*v2[1] - v1[1]*v2[0]
      ];
      return `
        <div class="solution-step"><strong>Vektoren:</strong> a = (${v1.join(', ')}), b = (${v2.join(', ')})</div>
        <div class="solution-step"><strong>Kreuzprodukt:</strong></div>
        <div class="solution-step">x: ${v1[1]}·${v2[2]} - ${v1[2]}·${v2[1]} = ${cross[0]}</div>
        <div class="solution-step">y: ${v1[2]}·${v2[0]} - ${v1[0]}·${v2[2]} = ${cross[1]}</div>
        <div class="solution-step">z: ${v1[0]}·${v2[1]} - ${v1[1]}·${v2[0]} = ${cross[2]}</div>
        <div class="solution-final"><strong>a × b = (${cross.join(', ')})</strong></div>
      `;
    }
  }

  return '<p>Vektor-Operationen: Betrag von (x,y,z), Skalarprodukt (·), Kreuzprodukt (×)</p>';
}

export function solveMatrix(input) {
  const inp = input.toLowerCase();

  const parse2x2 = (str) => {
    const match = str.match(/\[\[(-?\d+),(-?\d+)\],\[(-?\d+),(-?\d+)\]\]/);
    if (match) {
      return [[parseFloat(match[1]), parseFloat(match[2])], [parseFloat(match[3]), parseFloat(match[4])]];
    }
    return null;
  };

  if (inp.includes('det')) {
    const matrix = parse2x2(input.replace(/\s/g, ''));
    if (matrix) {
      const det = matrix[0][0]*matrix[1][1] - matrix[0][1]*matrix[1][0];
      return `
        <div class="solution-step"><strong>Matrix:</strong></div>
        <div class="solution-step matrix-display">| ${matrix[0][0]}  ${matrix[0][1]} |<br>| ${matrix[1][0]}  ${matrix[1][1]} |</div>
        <div class="solution-step">det(A) = ${matrix[0][0]}·${matrix[1][1]} - ${matrix[0][1]}·${matrix[1][0]}</div>
        <div class="solution-step">det(A) = ${matrix[0][0]*matrix[1][1]} - ${matrix[0][1]*matrix[1][0]}</div>
        <div class="solution-final"><strong>det(A) = ${det}</strong></div>
      `;
    }
  }

  if (inp.includes('inv')) {
    const matrix = parse2x2(input.replace(/\s/g, ''));
    if (matrix) {
      const det = matrix[0][0]*matrix[1][1] - matrix[0][1]*matrix[1][0];
      if (det === 0) {
        return '<p class="error">Matrix ist nicht invertierbar (det = 0)</p>';
      }
      const inv = [
        [matrix[1][1]/det, -matrix[0][1]/det],
        [-matrix[1][0]/det, matrix[0][0]/det]
      ];
      return `
        <div class="solution-step"><strong>Matrix:</strong></div>
        <div class="solution-step matrix-display">| ${matrix[0][0]}  ${matrix[0][1]} |<br>| ${matrix[1][0]}  ${matrix[1][1]} |</div>
        <div class="solution-step">det(A) = ${det}</div>
        <div class="solution-step"><strong>Inverse: A⁻¹ = 1/det · adj(A)</strong></div>
        <div class="solution-final matrix-display">| ${inv[0][0].toFixed(4)}  ${inv[0][1].toFixed(4)} |<br>| ${inv[1][0].toFixed(4)}  ${inv[1][1].toFixed(4)} |</div>
      `;
    }
  }

  if (inp.includes('*')) {
    const matrices = input.replace(/\s/g, '').match(/\[\[.+?\]\]/g);
    if (matrices && matrices.length >= 2) {
      const A = parse2x2(matrices[0]);
      const B = parse2x2(matrices[1]);
      if (A && B) {
        const C = [
          [A[0][0]*B[0][0] + A[0][1]*B[1][0], A[0][0]*B[0][1] + A[0][1]*B[1][1]],
          [A[1][0]*B[0][0] + A[1][1]*B[1][0], A[1][0]*B[0][1] + A[1][1]*B[1][1]]
        ];
        return `
          <div class="solution-step"><strong>A × B:</strong></div>
          <div class="solution-final matrix-display">| ${C[0][0]}  ${C[0][1]} |<br>| ${C[1][0]}  ${C[1][1]} |</div>
        `;
      }
    }
  }

  return '<p>Matrix-Operationen: det [[a,b],[c,d]], inv [[a,b],[c,d]], Multiplikation mit *</p>';
}

export function solveProbability(input) {
  const inp = input.toLowerCase();

  const binomCoef = (n, k) => {
    if (k > n) return 0;
    if (k === 0 || k === n) return 1;
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = result * (n - i) / (i + 1);
    }
    return Math.round(result);
  };

  const binomMatch = inp.match(/b\((\d+),\s*([\d.]+),\s*(\d+)\)/);
  if (binomMatch) {
    const n = parseInt(binomMatch[1]);
    const p = parseFloat(binomMatch[2]);
    const k = parseInt(binomMatch[3]);
    const q = 1 - p;
    const binom = binomCoef(n, k);
    const prob = binom * Math.pow(p, k) * Math.pow(q, n - k);

    return `
      <div class="solution-step"><strong>Binomialverteilung:</strong> B(${n}, ${p})</div>
      <div class="solution-step">P(X = ${k}) = C(${n}, ${k}) · ${p}^${k} · ${q.toFixed(2)}^${n - k}</div>
      <div class="solution-step">= ${binom} · ${Math.pow(p, k).toFixed(6)} · ${Math.pow(q, n - k).toFixed(6)}</div>
      <div class="solution-final"><strong>P(X = ${k}) = ${prob.toFixed(6)} ≈ ${(prob * 100).toFixed(2)}%</strong></div>
    `;
  }

  const expMatch = inp.match(/e\(x\).*b\((\d+),\s*([\d.]+)\)/);
  if (expMatch) {
    const n = parseInt(expMatch[1]);
    const p = parseFloat(expMatch[2]);
    const ex = n * p;
    const variance = n * p * (1 - p);
    const stddev = Math.sqrt(variance);

    return `
      <div class="solution-step"><strong>Binomialverteilung:</strong> B(${n}, ${p})</div>
      <div class="solution-step"><strong>Erwartungswert:</strong> E(X) = n · p = ${n} · ${p}</div>
      <div class="solution-final"><strong>E(X) = ${ex}</strong></div>
      <div class="solution-step"><strong>Varianz:</strong> Var(X) = n · p · (1-p) = ${variance.toFixed(4)}</div>
      <div class="solution-step"><strong>Standardabweichung:</strong> σ = ${stddev.toFixed(4)}</div>
    `;
  }

  const normMatch = inp.match(/p\(x\s*<\s*([\d.]+)\).*n\(([\d.]+),\s*([\d.]+)\)/);
  if (normMatch) {
    const x = parseFloat(normMatch[1]);
    const mu = parseFloat(normMatch[2]);
    const sigma = parseFloat(normMatch[3]);
    const z = (x - mu) / sigma;

    const erf = (x) => {
      const t = 1 / (1 + 0.5 * Math.abs(x));
      const tau = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
        t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
        t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
      return x >= 0 ? 1 - tau : tau - 1;
    };
    const phi = (z) => 0.5 * (1 + erf(z / Math.sqrt(2)));
    const prob = phi(z);

    return `
      <div class="solution-step"><strong>Normalverteilung:</strong> N(${mu}, ${sigma})</div>
      <div class="solution-step">z = (x - μ) / σ = (${x} - ${mu}) / ${sigma} = ${z.toFixed(4)}</div>
      <div class="solution-step">P(X < ${x}) = Φ(${z.toFixed(4)})</div>
      <div class="solution-final"><strong>P(X < ${x}) = ${prob.toFixed(6)} ≈ ${(prob * 100).toFixed(2)}%</strong></div>
    `;
  }

  return `<p>Stochastik-Formeln:</p>
    <ul>
      <li>Binomial: B(n, p, k), zum Beispiel B(10, 0.5, 3)</li>
      <li>Erwartungswert: E(X) für B(n, p)</li>
      <li>Normalverteilung: P(X < x) für N(μ, σ)</li>
    </ul>`;
}

export function formatMathResponse(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}
