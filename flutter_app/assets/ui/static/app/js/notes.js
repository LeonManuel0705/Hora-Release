import { data, esc, icon, glue, isoDate, parseDate, shortDate, now, storage } from "./core.js";
import { exitInPlace, enterInPlace } from "./motion.js";
import { toast } from "./shell.js";
import { notes as noteApi } from "./api.js";

const $ = (id) => document.getElementById(id);
const WORDS = { note: "Notiz", idea: "Idee" };
const OPEN_KEY = "app-notes-open";
const state = { notes: [], open: true, editing: null, draft: null };
// Undo puts a note back under a new id from the server. Whatever happens to that note next waits for the id.
const arriving = new WeakMap();
let makeTask = null;

const byId = (id) => state.notes.find((note) => note.id === id);
const rowOf = (id) => document.querySelector(`#notesList [data-note="${CSS.escape(id)}"]`);
const count = (number, one, many) => `${number} ${number === 1 ? one : many}`;
const settled = (note) => arriving.get(note) || Promise.resolve();

function whenText(note) {
  const day = String(note.created || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return day === isoDate(now()) ? "heute" : shortDate(parseDate(day));
}

function labelText() {
  const ideas = state.notes.filter((note) => note.type === "idea").length;
  const plain = state.notes.length - ideas;
  return [plain ? count(plain, "Notiz", "Notizen") : "", ideas ? count(ideas, "Idee", "Ideen") : ""].filter(Boolean).join(" und ");
}

function formHtml(note) {
  const draft = state.draft;
  const kinds = Object.entries(WORDS)
    .map(([key, word]) => `<button type="button" class="pill" data-note-type="${key}" aria-pressed="${draft.type === key}">${word}</button>`)
    .join("");
  return `<li class="row note is-editing" data-note="${esc(note.id)}">
    <form class="note-form" data-note-form novalidate autocomplete="off">
      <div class="note-form-kind" role="group" aria-label="Art">${kinds}</div>
      <input class="input" name="title" value="${esc(draft.title)}" maxlength="300" aria-label="Titel" required>
      <textarea class="textarea" name="details" rows="2" maxlength="5000" aria-label="Details" placeholder="Details">${esc(draft.details)}</textarea>
      <div class="note-form-actions">
        <button class="icon-button" type="button" data-note-act="task" aria-label="Zur Aufgabe machen" data-tip="Zur Aufgabe machen">${icon("list-plus")}</button>
        <button class="icon-button is-danger" type="button" data-note-act="delete" aria-label="Löschen" data-tip="Löschen">${icon("trash-2")}</button>
        <button type="button" class="btn btn-quiet" data-note-cancel>Abbrechen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
  </li>`;
}

function rowHtml(note) {
  if (state.editing === note.id && state.draft) return formHtml(note);
  const title = esc(note.title);
  const detail = note.details ? esc(note.details.split("\n")[0]) : "";
  const meta = [WORDS[note.type], whenText(note), detail].filter(Boolean).join(", ");
  return `<li class="row note is-interactive" data-note="${esc(note.id)}" tabindex="-1">
    <span class="note-kind is-${note.type}" aria-hidden="true">${icon(note.type === "idea" ? "lightbulb" : "pen-tool")}</span>
    <div class="row-main">
      <p class="row-title"><button type="button" class="row-open" data-note-edit aria-label="Bearbeiten: ${title}">${glue(title)}</button></p>
      <p class="row-meta">${meta}</p>
    </div>
    <div class="row-trailing">
      <div class="row-actions">
        <button class="icon-button" type="button" data-note-act="task" aria-label="Zur Aufgabe machen: ${title}" data-tip="Zur Aufgabe machen">${icon("list-plus")}</button>
        <button class="icon-button" type="button" data-note-act="delete" aria-label="Löschen: ${title}" data-tip="Löschen">${icon("trash-2")}</button>
      </div>
    </div>
  </li>`;
}

function render() {
  const toggle = $("notesToggle");
  const list = $("notesList");
  const shown = state.notes.length > 0;
  const typing = document.activeElement?.closest?.("#notesList [data-note-form]") ? document.activeElement : null;
  const caret = typing?.name ? [typing.name, typing.selectionStart, typing.selectionEnd] : null;
  toggle.hidden = !shown;
  $("notesLabel").textContent = labelText();
  toggle.setAttribute("aria-expanded", String(state.open && shown));
  list.hidden = !(state.open && shown);
  list.innerHTML = state.notes.map(rowHtml).join("");
  if (!caret) return;
  const field = list.querySelector(`[data-note-form] [name="${caret[0]}"]`);
  field?.focus({ preventScroll: true });
  field?.setSelectionRange(caret[1], caret[2]);
}

function put(note, index, { create = true } = {}) {
  state.notes.splice(Math.min(index, state.notes.length), 0, note);
  render();
  enterInPlace(rowOf(note.id));
  if (!create) return;
  arriving.set(note, noteApi.create(note).then((saved) => {
    if (!saved?.id) return;
    if (state.editing === note.id) state.editing = saved.id;
    note.id = saved.id;
    if (state.notes.includes(note)) render();
  }, () => {}));
}

// The note leaves the server once whatever replaces it is saved. Undo creates it again only if it really left.
function take(id, { after = Promise.resolve() } = {}) {
  const index = state.notes.findIndex((note) => note.id === id);
  if (index < 0) return null;
  const [note] = state.notes.splice(index, 1);
  if (state.editing === id) {
    state.editing = null;
    state.draft = null;
  }
  const gone = Promise.all([settled(note), after]).then(() => noteApi.remove(note.id)).then(() => true, () => false);
  exitInPlace(rowOf(id)).then(render);
  return { note, back: () => gone.then((removed) => put(note, index, { create: removed })) };
}

function removeNote(id) {
  const taken = take(id);
  if (!taken) return;
  toast(`${WORDS[taken.note.type]} gelöscht: „${esc(taken.note.title)}“`, { icon: "trash-2", action: { label: "Rückgängig", undo: true, run: taken.back } });
}

function turnIntoTask(id) {
  if (!makeTask || !byId(id)) return;
  if (state.editing === id) saveEdit({ refocus: false });
  const made = makeTask(byId(id));
  const taken = take(id, { after: made.saved });
  toast(`Als Aufgabe angelegt: „${esc(taken.note.title)}“`, {
    icon: "list-plus",
    action: { label: "Rückgängig", undo: true, run: () => {
      made.undo();
      taken.back();
    } },
  });
}

function startEdit(id) {
  if (state.editing && state.editing !== id) saveEdit({ refocus: false });
  const note = byId(id);
  if (!note) return;
  state.editing = id;
  state.draft = { title: note.title, details: note.details || "", type: note.type };
  render();
  const input = rowOf(id)?.querySelector('[name="title"]');
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function stopEdit({ refocus = true } = {}) {
  const id = state.editing;
  state.editing = null;
  state.draft = null;
  render();
  if (refocus && id) rowOf(id)?.querySelector("[data-note-edit]")?.focus({ preventScroll: true });
}

function saveEdit({ refocus = true } = {}) {
  const note = byId(state.editing);
  const draft = state.draft;
  if (!note || !draft) return;
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (!title) {
    if (refocus) rowOf(note.id)?.querySelector('[name="title"]')?.focus();
    return;
  }
  const changes = { title, details: draft.details.trim(), type: draft.type };
  const before = { title: note.title, details: note.details || "", type: note.type };
  const changed = Object.keys(changes).some((key) => changes[key] !== before[key]);
  Object.assign(note, changes);
  stopEdit({ refocus });
  if (!changed) return;
  settled(note).then(() => noteApi.update(note.id, changes)).catch(() => {
    Object.assign(note, before);
    render();
  });
}

function bind() {
  const list = $("notesList");
  $("notesToggle").addEventListener("click", () => {
    state.open = !state.open;
    storage.set(OPEN_KEY, state.open);
    render();
  });
  list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-note]");
    if (!row) return;
    const act = event.target.closest("[data-note-act]")?.dataset.noteAct;
    const kind = event.target.closest("[data-note-type]");
    if (act === "delete") removeNote(row.dataset.note);
    else if (act === "task") turnIntoTask(row.dataset.note);
    else if (event.target.closest("[data-note-edit]")) startEdit(row.dataset.note);
    else if (event.target.closest("[data-note-cancel]")) stopEdit();
    else if (kind && state.draft) {
      state.draft.type = kind.dataset.noteType;
      kind.parentElement.querySelectorAll("[data-note-type]").forEach((button) => button.setAttribute("aria-pressed", String(button === kind)));
    }
  });
  list.addEventListener("input", (event) => {
    const field = event.target;
    if (state.draft && field.closest("[data-note-form]") && (field.name === "title" || field.name === "details")) state.draft[field.name] = field.value;
  });
  list.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEdit();
  });
  list.addEventListener("keydown", (event) => {
    if (!event.target.closest("[data-note-form]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopEdit();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEdit();
    }
  });
  document.addEventListener("app:note-created", (event) => {
    const note = event.detail;
    if (!note?.id || !note.title || byId(note.id)) return;
    state.notes.unshift({ ...note });
    state.open = true;
    render();
    enterInPlace(rowOf(note.id));
  });
}

export function initNoteList({ toTask } = {}) {
  if (!$("notesList")) return;
  makeTask = toTask || null;
  state.notes = (data.page?.notes || []).map((note) => ({ ...note }));
  state.open = storage.get(OPEN_KEY) !== false || location.hash === "#notizen";
  bind();
  render();
  if (location.hash === "#notizen" && state.notes.length) $("notesToggle").scrollIntoView({ block: "center" });
}
