const serverIds = new Map();
const creations = new Map();
const queues = new Map();

async function send(method, url, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: text === undefined ? {} : { "Content-Type": "application/json" },
    body: text,
    credentials: "same-origin",
    // A request that may outlive the page must stay small: browsers refuse more than 64 KB of them at once.
    keepalive: (text?.length || 0) < 20000,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok || payload?.success === false) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.server = payload?.message || null;
    throw error;
  }
  return payload;
}

function failed(error) {
  window.dispatchEvent(new CustomEvent("app:save-failed", { detail: { message: error?.message || "" } }));
}

// A caller that tells about a failure itself asks for quiet, so the general warning does not come on top.
function queue(key, job, { quiet = false } = {}) {
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(job);
  queues.set(key, next);
  next.catch(quiet ? () => {} : failed);
  return next;
}

async function resolved(id) {
  if (creations.has(id)) {
    try {
      await creations.get(id);
    } catch {}
  }
  return serverIds.get(id) || id;
}

function create(key, url, body, pick) {
  const job = send("POST", url, body).then((payload) => {
    const saved = pick(payload);
    serverIds.set(key, String(saved.id));
    return saved;
  });
  creations.set(key, job);
  return queue(key, () => job);
}

export const serverId = (id) => serverIds.get(id) || null;

const clean = (value) => (value === undefined ? null : value);

function taskBody(task) {
  return {
    title: task.title,
    subject: clean(task.subject),
    date: task.someday ? null : clean(task.date),
    someday: !!task.someday,
    dueTime: clean(task.dueTime),
    minutes: task.minutes || null,
    priority: !!task.priority,
    repeat: clean(task.repeat),
    notes: task.notes || "",
    deadline: clean(task.deadline),
    source: task.source === "iserv" ? "iserv" : "own",
    done: !!task.done,
  };
}

const homeworkRef = (id) => (String(id).startsWith("iserv-") ? String(id).slice(6) : null);

export const tasks = {
  create(task) {
    return create(task.id, "/api/ui/tasks", taskBody(task), (payload) => payload.task);
  },
  update(id, changes) {
    const ref = homeworkRef(id);
    if (ref) {
      const body = {};
      if ("done" in changes) body.status = changes.done ? "abgegeben" : "offen";
      if ("date" in changes && changes.date) body.date = changes.date;
      if ("title" in changes) body.title = changes.title;
      if ("subject" in changes) body.subject = clean(changes.subject);
      if ("notes" in changes) body.detail = changes.notes || "";
      return Object.keys(body).length ? deadlines.update(ref, body) : Promise.resolve();
    }
    const body = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, clean(value)]));
    return queue(id, async () => send("PATCH", `/api/ui/tasks/${encodeURIComponent(await resolved(id))}`, body));
  },
  done(id, done) {
    return tasks.update(id, { done });
  },
  remove(id) {
    const ref = homeworkRef(id);
    if (ref) return deadlines.remove(ref);
    return queue(id, async () => send("DELETE", `/api/ui/tasks/${encodeURIComponent(await resolved(id))}`));
  },
  restore(task) {
    const ref = homeworkRef(task.id);
    if (ref) {
      const status = task.done ? "abgegeben" : "offen";
      if (task.source === "iserv") return deadlines.update(ref, { hidden: false, status });
      serverIds.delete(ref);
      creations.delete(ref);
      const saved = deadlines.create({ id: ref, kind: "Hausaufgabe", title: task.title, subject: task.subject, date: task.date, detail: task.notes ?? task.detail ?? "" });
      if (task.done) deadlines.update(ref, { status });
      return saved;
    }
    serverIds.delete(task.id);
    creations.delete(task.id);
    return tasks.create(task);
  },
};

export const deadlines = {
  create(item) {
    return create(item.id, "/api/ui/deadlines", { kind: item.kind, title: item.title, subject: clean(item.subject), date: item.date, detail: item.detail || "" }, (payload) => payload.deadline);
  },
  update(id, changes) {
    return queue(id, async () => send("PATCH", `/api/ui/deadlines/${encodeURIComponent(await resolved(id))}`, changes));
  },
  remove(id) {
    return queue(id, async () => send("DELETE", `/api/ui/deadlines/${encodeURIComponent(await resolved(id))}`));
  },
};

function eventBody(item) {
  return {
    title: item.title,
    date: item.date,
    endDate: clean(item.endDate),
    start: clean(item.start),
    end: clean(item.end),
    place: item.place || "",
    kind: item.kind || "private",
    notes: item.notes || "",
    ...(item.recurrence ? { recurrence: item.recurrence } : {}),
    ...(item.reminderMinutes != null ? { reminderMinutes: item.reminderMinutes } : {}),
  };
}

export const events = {
  create(item) {
    return create(item.id, "/api/ui/events", eventBody(item), (payload) => payload.event);
  },
  update(id, changes, options) {
    const body = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, clean(value)]));
    return queue(id, async () => send("PATCH", `/api/ui/events/${encodeURIComponent(await resolved(id))}`, body), options);
  },
  remove(id, options) {
    return queue(id, async () => send("DELETE", `/api/ui/events/${encodeURIComponent(await resolved(id))}`), options);
  },
  restore(item) {
    serverIds.delete(item.id);
    creations.delete(item.id);
    return events.create(item);
  },
};

export const grades = {
  create(item) {
    return create(item.id, "/api/ui/grades", { subject: item.subject, points: item.points, type: item.type, semester: item.semester, date: item.date, title: item.title || "" }, (payload) => payload.grade);
  },
  remove(id) {
    return queue(id, async () => send("DELETE", `/api/ui/grades/${encodeURIComponent(await resolved(id))}`));
  },
};

export const notes = {
  create(item) {
    const body = { type: item.type, title: item.title, details: item.details || "", ...(item.created ? { created: item.created } : {}) };
    return queue(`note-${Date.now()}`, async () => (await send("POST", "/api/ui/notes", body)).note);
  },
  update(id, changes) {
    return queue(`note-${id}`, () => send("PATCH", `/api/ui/notes/${encodeURIComponent(id)}`, changes));
  },
  remove(id) {
    return queue(`note-${id}`, () => send("DELETE", `/api/ui/notes/${encodeURIComponent(id)}`));
  },
};

const flushers = new Set();

addEventListener("pagehide", () => flushers.forEach((flush) => flush()));

export function debounced(delay, run) {
  const waiting = new Map();
  const flush = () => {
    waiting.forEach(({ timer, args }, key) => {
      clearTimeout(timer);
      run(key, ...args);
    });
    waiting.clear();
  };
  flushers.add(flush);
  const schedule = (key, ...args) => {
    clearTimeout(waiting.get(key)?.timer);
    const timer = setTimeout(() => {
      waiting.delete(key);
      run(key, ...args);
    }, delay);
    waiting.set(key, { timer, args });
  };
  schedule.cancel = (key) => {
    clearTimeout(waiting.get(key)?.timer);
    waiting.delete(key);
  };
  return schedule;
}
