// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => import(pathToFileURL(resolve(here, `../../app/static/app/js/${name}`)).href);
const { readExpression, evaluateExpression, solveEquation, solveDerivative, solveIntegral, solveVector, solveMatrix, solveProbability } = await load("chat-math.js");
const { formatMessage, stripActionBlocks, escapeHtml } = await load("chat-format.js");

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const tests = {
  "the reader follows the usual order of operations"() {
    assert.equal(readExpression("1+2*3"), 7);
    assert.equal(readExpression("(1+2)*3"), 9);
    assert.equal(readExpression("2**3**2"), 512);
    assert.equal(readExpression("-(2)**2"), -4);
    assert.equal(readExpression("2**-1"), 0.5);
    assert.equal(readExpression("Math.sqrt(16)+Math.pow(2,10)"), 1028);
    assert.equal(readExpression("Math.PI"), Math.PI);
    assert.equal(readExpression("(1e-8)*2"), 2e-8);
    assert.equal(readExpression("(-1.5e+21)/3"), -5e20);
  },
  "the reader refuses everything that is not arithmetic"() {
    for (const input of ["alert(1)", "Math.constructor", "1+", "(1", "1)", "Math.sin", "2 3", "x", "", "Math.sin(1)(2)", "[1]"]) {
      assert.throws(() => readExpression(input), SyntaxError, input);
    }
  },
  "an expression in x is worked out without turning text into code"() {
    assert.equal(evaluateExpression("x^2-4x+3", 1), 0);
    assert.equal(evaluateExpression("x²", 3), 9);
    assert.equal(evaluateExpression("2x+5", 5), 15);
    assert.equal(evaluateExpression("sin(x)", 0), 0);
    assert.equal(evaluateExpression("sqrt(x)", 16), 4);
    assert.ok(Number.isNaN(evaluateExpression("x;fetch('/')", 1)));
    assert.ok(Number.isNaN(evaluateExpression("constructor", 1)));
  },
  "the equation helper finds the roots again"() {
    const quadratic = text(solveEquation("x² - 4x + 3 = 0"));
    assert.match(quadratic, /x₁ = \(-b \+ √D\) \/ 2a = 3\.000000/);
    assert.match(quadratic, /x₂ = \(-b - √D\) \/ 2a = 1\.000000/);
    assert.match(text(solveEquation("2x + 5 = 15")), /x ≈ 5\.000000/);
    const cubic = text(solveEquation("x³ - 6x² + 11x - 6 = 0"));
    for (const root of ["1.000000", "2.000000", "3.000000"]) assert.ok(cubic.includes(root), cubic);
    assert.doesNotMatch(cubic, /Keine reellen Lösungen/);
  },
  "the other helpers answer as before"() {
    assert.match(text(solveDerivative("f(x) = 3x³ + 2x²")), /f'\(x\) = 9x\^2 \+ 4x/);
    assert.match(text(solveIntegral("∫ x² dx von 0 bis 2")), /F\(x\) = 0\.3333x\^3 \+ C .* = 2\.6664/);
    assert.match(text(solveVector("(1,2,3) · (4,5,6)")), /a · b = 32/);
    assert.match(text(solveMatrix("det [[1,2],[3,4]]")), /det\(A\) = -2/);
    assert.match(text(solveProbability("B(10, 0.5, 3)")), /P\(X = 3\) = 0\.117188/);
  },
  "chat answers are escaped before they are formatted"() {
    assert.equal(escapeHtml('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    assert.equal(formatMessage("**fett** und *schräg*\n<script>"), "<strong>fett</strong> und <em>schräg</em><br>&lt;script&gt;");
    assert.match(formatMessage("$x^2$"), /class="math-inline">x<sup>2<\/sup>/);
    assert.equal(stripActionBlocks('Erledigt.\n[ACTION]{"type":"task","title":"Mathe"}[/ACTION]'), "Erledigt.");
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
