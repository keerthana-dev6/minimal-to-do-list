(function () {
  "use strict";

  /* =====================================================
     1. CONSTANTS
  ===================================================== */
  var STORAGE_KEY = "workbench_state_v1";
  var THEME_KEY = "workbench_theme";
  var WARNING_DISMISS_KEY = "workbench_storage_warning_dismissed";
  var PROJECT_COLORS = ["#2F6F4E", "#C9622A", "#3B6EA5", "#8B5FBF", "#B23A48", "#D9A441"];
  var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var TOAST_DURATION = 3200;
  var UNDO_DURATION = 5500;

  var CHECK_SVG =
    '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 5.5L4.2 8.2L9.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var TOAST_ICONS = {
    success: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M4.8 8.2L6.8 10.2L11.2 5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    danger: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.2" r="0.9" fill="currentColor"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2V11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.8" r="0.9" fill="currentColor"/></svg>'
  };

  /* =====================================================
     2. STATE
  ===================================================== */
  var state = {
    tasks: [],
    projects: [],
    filter: "all",
    search: "",
    sort: "manual",
    pendingDue: null,
    pendingPriority: null,
    pendingProjectId: null,
    completedCollapsed: true
  };

  var deletedStash = null;   // { task, index, timeoutId } — enables undo after delete
  var activeModal = null;    // { onClose } — tracks currently open modal for focus trap / Esc
  var lastFocusedEl = null;  // element to restore focus to after a modal closes

  /* =====================================================
     3. PERSISTENCE
  ===================================================== */
  // Only warn about storage problems when a *real* save or load actually
  // fails (see the catch blocks in loadState/saveState below). An earlier
  // version pre-tested with a throwaway key before touching real data, but
  // some browser privacy features/extensions treat synthetic "test" writes
  // differently from real ones, which produced false-positive warnings even
  // when the app's actual data was saving and loading correctly.
  var storageWarningShown = false;
  function warnStorageUnavailable() {
    if (wasWarningDismissed()) return;
    var banner = document.getElementById("storageBanner");
    banner.hidden = false;
    if (storageWarningShown) return;
    storageWarningShown = true;
    showToast({
      type: "danger",
      message: "This browser is blocking local storage, so tasks won't be saved after you refresh.",
      duration: 9000
    });
  }

  // Best-effort: if localStorage is unusable, this simply fails quietly and
  // the banner will show again next time — which is the correct fallback.
  function wasWarningDismissed() {
    try { return localStorage.getItem(WARNING_DISMISS_KEY) === "1"; } catch (e) { return false; }
  }
  function dismissWarning() {
    document.getElementById("storageBanner").hidden = true;
    try { localStorage.setItem(WARNING_DISMISS_KEY, "1"); } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tasks)) {
        state.tasks = parsed.tasks.map(migrateTask);
      }
      if (parsed && Array.isArray(parsed.projects)) state.projects = parsed.projects;
    } catch (e) {
      console.warn("Could not load saved tasks:", e);
      warnStorageUnavailable();
    }
  }

  // Defensive migration: older saved data used `notes`; current schema uses `description`.
  function migrateTask(t) {
    if (t.description === undefined) t.description = t.notes || "";
    if (t.subtasks === undefined) t.subtasks = [];
    if (t.priority === undefined) t.priority = "";
    return t;
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ tasks: state.tasks, projects: state.projects })
      );
    } catch (e) {
      console.warn("Could not save tasks:", e);
      warnStorageUnavailable();
    }
  }

  /* =====================================================
     4. THEME
  ===================================================== */
  function initTheme() {
    var toggle = document.getElementById("themeToggle");
    toggle.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      var next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
    syncThemeButton();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    syncThemeButton();
  }

  function syncThemeButton() {
    var theme = document.documentElement.getAttribute("data-theme");
    var toggle = document.getElementById("themeToggle");
    var isDark = theme === "dark";
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  /* =====================================================
     5. UTILITIES
  ===================================================== */
  function uid(prefix) {
    return (prefix || "t") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function todayISO() { return dateToISO(new Date()); }
  function dateToISO(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return dateToISO(d);
  }
  function isoToDate(iso) { return new Date(iso + "T00:00:00"); }
  function formatPillDate(iso) {
    return isoToDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function nextWeekday(targetIdx) {
    var d = new Date();
    var diff = (targetIdx - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    d.setDate(d.getDate() + diff);
    return dateToISO(d);
  }

  /* =====================================================
     6. PROJECTS / CATEGORIES
  ===================================================== */
  function getProject(id) {
    if (!id) return null;
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === id) return state.projects[i];
    }
    return null;
  }
  function findProjectByName(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].name.toLowerCase() === lower) return state.projects[i];
    }
    return null;
  }
  function createProject(name, color) {
    var project = {
      id: uid("p"),
      name: name.trim(),
      color: color || PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length]
    };
    state.projects.push(project);
    saveState();
    return project;
  }

  /* =====================================================
     7. SMART QUICK-ADD PARSING
     Supports: #category  !high/!medium/!low (or !h/!m/!l)
     today / tomorrow / next week / mon..sun
  ===================================================== */
  function parseQuickAdd(raw) {
    var title = raw;
    var due = null, priority = null, projectName = null;

    var projMatch = title.match(/#(\S+)/);
    if (projMatch) {
      projectName = projMatch[1].replace(/[_-]/g, " ");
      title = title.replace(projMatch[0], "");
    }

    var prMatch = title.match(/!(\bhigh\b|\bmedium\b|\bmed\b|\blow\b|h\b|m\b|l\b)/i);
    if (prMatch) {
      var token = prMatch[1].toLowerCase();
      if (token === "high" || token === "h") priority = "high";
      else if (token === "medium" || token === "med" || token === "m") priority = "medium";
      else if (token === "low" || token === "l") priority = "low";
      title = title.replace(prMatch[0], "");
    }

    var lower = title.toLowerCase();
    if (/\btomorrow\b/.test(lower)) {
      due = addDays(todayISO(), 1);
      title = title.replace(/\btomorrow\b/i, "");
    } else if (/\bnext week\b/.test(lower)) {
      due = addDays(todayISO(), 7);
      title = title.replace(/\bnext week\b/i, "");
    } else if (/\btoday\b/.test(lower)) {
      due = todayISO();
      title = title.replace(/\btoday\b/i, "");
    } else {
      for (var i = 0; i < WEEKDAYS.length; i++) {
        var re = new RegExp("\\b" + WEEKDAYS[i] + "\\b", "i");
        if (re.test(lower)) { due = nextWeekday(i); title = title.replace(re, ""); break; }
      }
    }

    title = title.replace(/\s{2,}/g, " ").trim();
    return { title: title, due: due, priority: priority, projectName: projectName };
  }

  /* =====================================================
     8. TASK CRUD
  ===================================================== */
  function addTask(rawText) {
    var text = rawText.trim();
    if (!text) return;

    var parsed = parseQuickAdd(text);
    var title = parsed.title || text;

    var due = state.pendingDue || parsed.due || null;
    var priority = state.pendingPriority !== null ? state.pendingPriority : parsed.priority || null;

    var projectId = state.pendingProjectId || null;
    if (!projectId && parsed.projectName) {
      var existing = findProjectByName(parsed.projectName);
      var project = existing || createProject(parsed.projectName);
      projectId = project.id;
    }

    var maxOrder = state.tasks.reduce(function (m, t) { return Math.max(m, t.order || 0); }, 0);

    var task = {
      id: uid(),
      title: title,
      description: "",
      projectId: projectId,
      priority: priority || "",
      due: due,
      completed: false,
      completedAt: null,
      createdAt: Date.now(),
      order: maxOrder + 1,
      subtasks: []
    };

    state.tasks.unshift(task);
    saveState();

    state.pendingDue = null;
    state.pendingPriority = null;
    state.pendingProjectId = null;
    updateChipLabels();

    render();
    flagNewTask(task.id);
    showToast({ type: "success", message: "Task added." });
  }

  function getTask(id) {
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i];
    return null;
  }

  function toggleComplete(id) {
    var task = getTask(id);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    saveState();
    render();
    if (task.completed) {
      flagJustCompleted(id);
      showToast({ type: "success", message: "Task completed." });
    }
  }

  function updateTaskTitle(id, newTitle) {
    var task = getTask(id);
    if (!task) return;
    var trimmed = newTitle.trim();
    if (trimmed) task.title = trimmed;
    saveState();
    render();
  }

  // Full edit (title, description, due date, priority, category) via the Edit modal.
  function applyTaskEdits(id, edits) {
    var task = getTask(id);
    if (!task) return;
    if (edits.title !== undefined) {
      var trimmed = edits.title.trim();
      if (trimmed) task.title = trimmed;
    }
    if (edits.description !== undefined) task.description = edits.description;
    if (edits.due !== undefined) task.due = edits.due || null;
    if (edits.priority !== undefined) task.priority = edits.priority || "";
    if (edits.projectId !== undefined) task.projectId = edits.projectId || null;
    saveState();
    render();
    showToast({ type: "success", message: "Task updated." });
  }

  function updateTaskDescription(id, description) {
    var task = getTask(id);
    if (!task) return;
    task.description = description;
    saveState();
  }

  // Deletion is a two-step flow: an exit animation plays first, then the task
  // is actually removed from state and an undo toast is shown.
  function requestDeleteTask(id) {
    var li = document.querySelector('.task[data-id="' + id + '"]');
    if (li) {
      li.classList.add("exiting");
      setTimeout(function () { commitDeleteTask(id); }, 200);
    } else {
      commitDeleteTask(id);
    }
  }

  function commitDeleteTask(id) {
    var idx = state.tasks.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    var removed = state.tasks.splice(idx, 1)[0];
    saveState();
    render();
    showToast({
      type: "danger",
      message: "Task deleted.",
      actionLabel: "Undo",
      onAction: function () { undoDelete(removed, idx); },
      duration: UNDO_DURATION
    });
  }

  function undoDelete(task, atIndex) {
    var idx = Math.min(atIndex, state.tasks.length);
    state.tasks.splice(idx, 0, task);
    saveState();
    render();
    showToast({ type: "success", message: "Task restored." });
  }

  function addSubtask(taskId, text) {
    var task = getTask(taskId);
    if (!task || !text.trim()) return;
    task.subtasks.push({ id: uid("s"), text: text.trim(), done: false });
    saveState();
    render();
  }
  function toggleSubtask(taskId, subtaskId) {
    var task = getTask(taskId);
    if (!task) return;
    var sub = task.subtasks.find(function (s) { return s.id === subtaskId; });
    if (!sub) return;
    sub.done = !sub.done;
    saveState();
    render();
  }
  function removeSubtask(taskId, subtaskId) {
    var task = getTask(taskId);
    if (!task) return;
    task.subtasks = task.subtasks.filter(function (s) { return s.id !== subtaskId; });
    saveState();
    render();
  }

  /* =====================================================
     9. TOASTS (generic, stacking, auto-dismiss)
  ===================================================== */
  function showToast(opts) {
    var container = document.getElementById("toastContainer");
    var toast = document.createElement("div");
    toast.className = "toast type-" + (opts.type || "info");
    toast.setAttribute("role", opts.type === "danger" ? "alert" : "status");

    var icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.innerHTML = TOAST_ICONS[opts.type] || TOAST_ICONS.info;
    toast.appendChild(icon);

    var msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = opts.message;
    toast.appendChild(msg);

    var timeoutId;
    function dismiss() {
      clearTimeout(timeoutId);
      toast.classList.add("leaving");
      setTimeout(function () { toast.remove(); }, 200);
    }

    if (opts.actionLabel && opts.onAction) {
      var actionBtn = document.createElement("button");
      actionBtn.className = "toast-action";
      actionBtn.type = "button";
      actionBtn.textContent = opts.actionLabel;
      actionBtn.addEventListener("click", function () {
        opts.onAction();
        dismiss();
      });
      toast.appendChild(actionBtn);
    }

    var closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", dismiss);
    toast.appendChild(closeBtn);

    container.appendChild(toast);
    timeoutId = setTimeout(dismiss, opts.duration || TOAST_DURATION);
  }

  /* =====================================================
     10. MODALS (Edit task / Delete confirmation)
     Shared overlay + focus trap.
  ===================================================== */
  function openModal(titleText, bodyEl) {
    var overlay = document.getElementById("modalOverlay");
    var root = document.getElementById("modalRoot");
    root.innerHTML = "";

    var header = document.createElement("div");
    header.className = "modal-header";
    header.innerHTML = '<h2 class="modal-title">' + escapeHtml(titleText) + '</h2>';

    var closeBtn = document.createElement("button");
    closeBtn.className = "modal-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close dialog");
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", closeModal);
    header.appendChild(closeBtn);

    root.appendChild(header);
    root.appendChild(bodyEl);

    lastFocusedEl = document.activeElement;
    overlay.hidden = false;
    root.setAttribute("aria-label", titleText);

    var focusables = getFocusable(root);
    if (focusables.length) focusables[0].focus();

    activeModal = { onClose: null };

    overlay.addEventListener("mousedown", onOverlayMouseDown);
    document.addEventListener("keydown", onModalKeydown);
  }

  function onOverlayMouseDown(e) {
    if (e.target.id === "modalOverlay") closeModal();
  }

  function onModalKeydown(e) {
    if (!activeModal) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key === "Tab") {
      var root = document.getElementById("modalRoot");
      var focusables = getFocusable(root);
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function getFocusable(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function closeModal() {
    var overlay = document.getElementById("modalOverlay");
    overlay.hidden = true;
    overlay.removeEventListener("mousedown", onOverlayMouseDown);
    document.removeEventListener("keydown", onModalKeydown);
    activeModal = null;
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") lastFocusedEl.focus();
  }

  // ---------- Edit task modal ----------
  function openEditModal(taskId) {
    var task = getTask(taskId);
    if (!task) return;

    var body = document.createElement("form");
    body.className = "edit-form";
    body.noValidate = true;

    body.innerHTML =
      '<div class="field"><label for="editTitle">Title</label>' +
      '<input type="text" id="editTitle" required maxlength="140" /></div>' +

      '<div class="field"><label for="editDescription">Description</label>' +
      '<textarea id="editDescription" placeholder="Add more detail…"></textarea></div>' +

      '<div class="field"><label for="editDue">Due date</label>' +
      '<input type="date" id="editDue" /></div>' +

      '<div class="field"><label>Priority</label>' +
      '<div class="priority-radio-group" id="editPriorityGroup"></div></div>' +

      '<div class="field"><label for="editProject">Category</label>' +
      '<select id="editProject"></select></div>' +

      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="editCancelBtn">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">Save changes</button>' +
      '</div>';

    openModal("Edit task", body);

    body.querySelector("#editTitle").value = task.title;
    body.querySelector("#editDescription").value = task.description || "";
    body.querySelector("#editDue").value = task.due || "";

    var priorityGroup = body.querySelector("#editPriorityGroup");
    [["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].forEach(function (pair) {
      var value = pair[0], label = pair[1];
      var wrap = document.createElement("label");
      wrap.className = "priority-radio " + (value || "none");
      wrap.innerHTML =
        '<input type="radio" name="editPriority" value="' + value + '"' + (task.priority === value ? " checked" : "") + ' />' +
        "<span>" + label + "</span>";
      priorityGroup.appendChild(wrap);
    });

    var projectSelect = body.querySelector("#editProject");
    var noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "No category";
    projectSelect.appendChild(noneOpt);
    state.projects.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.id; opt.textContent = p.name;
      if (task.projectId === p.id) opt.selected = true;
      projectSelect.appendChild(opt);
    });

    body.querySelector("#editCancelBtn").addEventListener("click", closeModal);
    body.addEventListener("submit", function (e) {
      e.preventDefault();
      var priorityInput = body.querySelector('input[name="editPriority"]:checked');
      applyTaskEdits(taskId, {
        title: body.querySelector("#editTitle").value,
        description: body.querySelector("#editDescription").value,
        due: body.querySelector("#editDue").value,
        priority: priorityInput ? priorityInput.value : "",
        projectId: projectSelect.value
      });
      closeModal();
    });
  }

  // ---------- Delete confirmation modal ----------
  function openDeleteConfirm(taskId) {
    var task = getTask(taskId);
    if (!task) return;

    var body = document.createElement("div");
    body.innerHTML =
      '<p class="confirm-body">Delete <strong>' + escapeHtml(task.title) + '</strong>? You can undo this right after.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost" id="deleteCancelBtn">Cancel</button>' +
      '<button type="button" class="btn btn-danger" id="deleteConfirmBtn">Delete task</button>' +
      '</div>';

    openModal("Delete task", body);

    body.querySelector("#deleteCancelBtn").addEventListener("click", closeModal);
    body.querySelector("#deleteConfirmBtn").addEventListener("click", function () {
      closeModal();
      requestDeleteTask(taskId);
    });
  }

  /* =====================================================
     11. BUCKETING / GROUPING / SORTING
  ===================================================== */
  function getBucketKey(task) {
    if (!task.due) return "nodate";
    var today = todayISO(), tomorrow = addDays(today, 1), weekEnd = addDays(today, 7);
    if (task.due < today) return "overdue";
    if (task.due === today) return "today";
    if (task.due === tomorrow) return "tomorrow";
    if (task.due < weekEnd) return "week";
    return "later";
  }

  var BUCKET_META = {
    overdue: { title: "Overdue" }, today: { title: "Today" }, tomorrow: { title: "Tomorrow" },
    week: { title: "This week" }, later: { title: "Later" }, nodate: { title: "No date" }
  };
  var BUCKET_ORDER = ["overdue", "today", "tomorrow", "week", "later", "nodate"];
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2, "": 3 };

  function sortTasks(list) {
    var copy = list.slice();
    if (state.sort === "priority") {
      copy.sort(function (a, b) { return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; });
    } else if (state.sort === "due") {
      copy.sort(function (a, b) {
        var ad = a.due || "9999-99-99", bd = b.due || "9999-99-99";
        return ad < bd ? -1 : ad > bd ? 1 : 0;
      });
    } else if (state.sort === "created") {
      copy.sort(function (a, b) { return b.createdAt - a.createdAt; });
    } else {
      copy.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    }
    return copy;
  }

  function getFilteredTasks() {
    var list = state.tasks.slice();

    if (state.filter === "active") list = list.filter(function (t) { return !t.completed; });
    else if (state.filter === "completed") list = list.filter(function (t) { return t.completed; });
    else if (state.filter === "high") list = list.filter(function (t) { return !t.completed && t.priority === "high"; });
    else if (state.filter.indexOf("project:") === 0) {
      var pid = state.filter.slice(8);
      list = list.filter(function (t) { return !t.completed && t.projectId === pid; });
    }

    if (state.search.trim()) {
      var q = state.search.trim().toLowerCase();
      list = list.filter(function (t) {
        var project = getProject(t.projectId);
        return (
          t.title.toLowerCase().indexOf(q) !== -1 ||
          (t.description && t.description.toLowerCase().indexOf(q) !== -1) ||
          (project && project.name.toLowerCase().indexOf(q) !== -1)
        );
      });
    }
    return list;
  }

  /* =====================================================
     12. RENDERING
  ===================================================== */
  function render() {
    renderHeader();
    renderRail();
    renderProjectChips();
    renderProjectPopoverList();
    renderList();
  }

  function renderHeader() {
    var now = new Date();
    document.getElementById("headerDate").textContent = now.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric"
    });

    var total = state.tasks.length;
    var completed = state.tasks.filter(function (t) { return t.completed; }).length;
    var active = total - completed;
    var today = todayISO();
    var overdue = state.tasks.filter(function (t) { return !t.completed && t.due && t.due < today; }).length;
    var dueToday = state.tasks.filter(function (t) { return !t.completed && t.due === today; }).length;
    var completedToday = state.tasks.filter(function (t) {
      return t.completed && t.completedAt && dateToISO(new Date(t.completedAt)) === today;
    }).length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statActive").textContent = active;
    document.getElementById("statCompleted").textContent = completed;
    document.getElementById("statOverdue").textContent = overdue;
    document.getElementById("statDueToday").textContent = dueToday + " due today";
    document.getElementById("statCompletedToday").textContent = completedToday + " completed today";

    var pct = total === 0 ? 0 : Math.round((completed / total) * 100);
    document.getElementById("progressBarFill").style.width = pct + "%";
    document.getElementById("progressLabel").textContent = pct + "% complete";
    document.getElementById("progressBar").setAttribute("aria-valuenow", String(pct));
  }

  function renderRail() {
    var total = state.tasks.length;
    var done = state.tasks.filter(function (t) { return t.completed; }).length;
    var pct = total === 0 ? 0 : done / total;

    document.getElementById("railDone").textContent = done;
    document.getElementById("railTotal").textContent = total;

    var ticksEl = document.getElementById("railTicks");
    ticksEl.innerHTML = "";
    var TICK_COUNT = 20;
    var filledTicks = Math.round(pct * TICK_COUNT);
    for (var i = 0; i < TICK_COUNT; i++) {
      var tick = document.createElement("div");
      tick.className = "tick" + (i < filledTicks ? " filled" : "") + ((i + 1) % 5 === 0 ? " major" : "");
      ticksEl.appendChild(tick);
    }
  }

  function renderProjectChips() {
    var container = document.getElementById("filterChips");
    container.querySelectorAll(".is-project").forEach(function (el) { el.remove(); });

    state.projects.forEach(function (p) {
      var btn = document.createElement("button");
      btn.className = "filter-chip is-project" + (state.filter === "project:" + p.id ? " active" : "");
      btn.setAttribute("data-filter", "project:" + p.id);
      btn.innerHTML = '<span class="dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name);
      container.appendChild(btn);
    });
  }

  function renderProjectPopoverList() {
    var list = document.getElementById("projectList");
    list.innerHTML = "";

    var noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = "project-opt none-opt";
    noneBtn.textContent = "No category";
    noneBtn.addEventListener("click", function () {
      state.pendingProjectId = null;
      updateChipLabels();
      closeAllPopovers();
    });
    list.appendChild(noneBtn);

    state.projects.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "project-opt";
      btn.innerHTML = '<span class="dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name);
      btn.addEventListener("click", function () {
        state.pendingProjectId = p.id;
        updateChipLabels();
        closeAllPopovers();
      });
      list.appendChild(btn);
    });
  }

  function renderList() {
    var listWrap = document.getElementById("listWrap");
    listWrap.innerHTML = "";

    var filtered = getFilteredTasks();

    if (state.tasks.length === 0) {
      listWrap.appendChild(buildEmptyState());
      return;
    }
    if (filtered.length === 0) {
      listWrap.appendChild(buildEmptyState(
        "No matching tasks",
        "Try a different filter or search term."
      ));
      return;
    }

    if (state.filter === "completed") {
      var completedList = sortTasks(filtered.filter(function (t) { return t.completed; }));
      completedList.sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
      listWrap.appendChild(buildSection("completed", "Completed", completedList, false));
      return;
    }

    var incomplete = filtered.filter(function (t) { return !t.completed; });
    var completed = filtered.filter(function (t) { return t.completed; });

    var buckets = {};
    BUCKET_ORDER.forEach(function (k) { buckets[k] = []; });
    incomplete.forEach(function (t) { buckets[getBucketKey(t)].push(t); });

    var any = false;
    BUCKET_ORDER.forEach(function (key) {
      if (buckets[key].length === 0) return;
      any = true;
      listWrap.appendChild(buildSection(key, BUCKET_META[key].title, sortTasks(buckets[key]), true));
    });

    if (completed.length > 0 && (state.filter === "all" || state.filter === "high" || state.filter.indexOf("project:") === 0)) {
      any = true;
      var sortedCompleted = completed.slice().sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
      listWrap.appendChild(buildSection("completed", "Completed", sortedCompleted, false, true));
    }

    if (!any) listWrap.appendChild(buildEmptyState("All clear", "Nothing matches this view right now."));
  }

  function buildEmptyState(title, body) {
    var div = document.createElement("div");
    div.className = "empty-state";
    var illustration =
      '<svg width="120" height="88" viewBox="0 0 120 88" fill="none">' +
      '<rect x="16" y="14" width="88" height="62" rx="10" fill="var(--surface-alt)" stroke="var(--line-strong)" stroke-width="1.5"/>' +
      '<path d="M32 34H80M32 46H68M32 58H74" stroke="var(--line-strong)" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="92" cy="66" r="16" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5"/>' +
      '<path d="M85.5 66.5L90 71L98.5 61" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>";
    div.innerHTML = illustration +
      "<h3>" + escapeHtml(title || "Nothing on the bench yet") + "</h3>" +
      "<p>" + escapeHtml(body || "Add your first task above to get started.") + "</p>";
    return div;
  }

  function buildSection(key, title, tasks, draggable, collapsible) {
    var section = document.createElement("section");
    section.className = "section " + key + (collapsible && state.completedCollapsed ? " collapsed" : "");

    var header = document.createElement("div");
    header.className = "section-header";
    header.innerHTML =
      (collapsible ? '<svg class="chev" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3L5 6.5L8 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : "") +
      '<span class="section-title">' + escapeHtml(title) + '</span>' +
      '<span class="section-count">' + tasks.length + '</span>' +
      '<span class="section-line"></span>';

    if (collapsible) {
      header.addEventListener("click", function () {
        state.completedCollapsed = !state.completedCollapsed;
        render();
      });
    }
    section.appendChild(header);

    var ul = document.createElement("ul");
    ul.className = "task-list";
    tasks.forEach(function (task) {
      ul.appendChild(buildTaskElement(task, key, draggable && state.sort === "manual"));
    });
    section.appendChild(ul);

    return section;
  }

  function buildTaskElement(task, bucketKey, draggable) {
    var li = document.createElement("li");
    li.className = "task" + (task.completed ? " completed" : "") + (task.priority ? " pr-" + task.priority : "");
    li.dataset.id = task.id;
    li.dataset.bucket = bucketKey;

    var row = document.createElement("div");
    row.className = "task-row";

    // Checkbox
    var checkbox = document.createElement("button");
    checkbox.className = "task-checkbox";
    checkbox.type = "button";
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", String(task.completed));
    checkbox.setAttribute("aria-label", task.completed ? "Mark \u201c" + task.title + "\u201d as not done" : "Mark \u201c" + task.title + "\u201d as done");
    checkbox.innerHTML = CHECK_SVG;
    checkbox.addEventListener("click", function () { toggleComplete(task.id); });
    row.appendChild(checkbox);

    // Body
    var body = document.createElement("div");
    body.className = "task-body";

    var titleRow = document.createElement("div");
    titleRow.className = "task-title-row";

    var titleEl = document.createElement("span");
    titleEl.className = "task-title";
    titleEl.textContent = task.title;
    titleEl.tabIndex = 0;
    titleEl.setAttribute("role", "textbox");
    titleEl.setAttribute("aria-label", "Task title, click to rename");
    titleEl.addEventListener("click", function () { enterEditMode(titleEl, task.id); });
    titleEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); enterEditMode(titleEl, task.id); }
    });
    titleRow.appendChild(titleEl);

    if (task.subtasks.length > 0) {
      var doneCount = task.subtasks.filter(function (s) { return s.done; }).length;
      var badge = document.createElement("span");
      badge.className = "subtask-badge";
      badge.textContent = doneCount + "/" + task.subtasks.length;
      titleRow.appendChild(badge);
    }
    body.appendChild(titleRow);

    if (task.description) {
      var descPreview = document.createElement("div");
      descPreview.className = "task-desc-preview";
      descPreview.textContent = task.description;
      body.appendChild(descPreview);
    }

    // Meta pills
    var meta = document.createElement("div");
    meta.className = "task-meta";
    var hasMeta = false;

    if (task.due) {
      hasMeta = true;
      var duePill = document.createElement("span");
      var dueClass = task.due < todayISO() && !task.completed ? "overdue" : task.due === todayISO() ? "today" : "";
      duePill.className = "pill pill-due " + dueClass;
      duePill.textContent = (dueClass === "overdue" ? "Overdue \u00b7 " : "") + formatPillDate(task.due);
      meta.appendChild(duePill);
    }
    if (task.priority) {
      hasMeta = true;
      var prPill = document.createElement("span");
      prPill.className = "pill pill-priority " + task.priority;
      prPill.innerHTML = '<span class="dot" style="background:currentColor"></span>' + task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
      meta.appendChild(prPill);
    }
    var project = getProject(task.projectId);
    if (project) {
      hasMeta = true;
      var prjPill = document.createElement("span");
      prjPill.className = "pill pill-project";
      prjPill.innerHTML = '<span class="dot" style="background:' + project.color + '"></span>' + escapeHtml(project.name);
      meta.appendChild(prjPill);
    }
    if (hasMeta) body.appendChild(meta);

    row.appendChild(body);

    // Actions
    var actions = document.createElement("div");
    actions.className = "task-actions";

    if (draggable) {
      var handle = document.createElement("button");
      handle.type = "button";
      handle.className = "icon-btn drag-handle";
      handle.setAttribute("aria-label", "Drag to reorder");
      handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="4" cy="3" r="1.1" fill="currentColor"/><circle cx="8" cy="3" r="1.1" fill="currentColor"/><circle cx="4" cy="6" r="1.1" fill="currentColor"/><circle cx="8" cy="6" r="1.1" fill="currentColor"/><circle cx="4" cy="9" r="1.1" fill="currentColor"/><circle cx="8" cy="9" r="1.1" fill="currentColor"/></svg>';
      attachDragHandle(handle, li);
      actions.appendChild(handle);
    }

    var editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.type = "button";
    editBtn.setAttribute("aria-label", "Edit task");
    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.2 1.8L11.2 4.8L4.3 11.7H1.3V8.7L8.2 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    editBtn.addEventListener("click", function () { openEditModal(task.id); });
    actions.appendChild(editBtn);

    var expandBtn = document.createElement("button");
    expandBtn.className = "icon-btn";
    expandBtn.type = "button";
    expandBtn.setAttribute("aria-label", "Show details");
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M3 5L6.5 8.5L10 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    expandBtn.addEventListener("click", function () {
      var isOpen = li.classList.toggle("expanded");
      expandBtn.setAttribute("aria-expanded", String(isOpen));
    });
    actions.appendChild(expandBtn);

    var deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn danger";
    deleteBtn.type = "button";
    deleteBtn.setAttribute("aria-label", "Delete task");
    deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 3.5H10.5M5.2 3.5V2.2C5.2 1.9 5.4 1.7 5.7 1.7H7.3C7.6 1.7 7.8 1.9 7.8 2.2V3.5M4.3 3.5L4.8 10.3C4.8 10.6 5.1 10.8 5.4 10.8H7.6C7.9 10.8 8.2 10.6 8.2 10.3L8.7 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.addEventListener("click", function () { openDeleteConfirm(task.id); });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    li.appendChild(row);

    // Expand panel: description + subtasks
    var expand = document.createElement("div");
    expand.className = "task-expand";

    var descArea = document.createElement("textarea");
    descArea.className = "task-notes";
    descArea.placeholder = "Add a description…";
    descArea.setAttribute("aria-label", "Task description");
    descArea.value = task.description || "";
    var descTimer = null;
    descArea.addEventListener("input", function () {
      clearTimeout(descTimer);
      var val = descArea.value;
      descTimer = setTimeout(function () { updateTaskDescription(task.id, val); }, 400);
    });
    expand.appendChild(descArea);

    var subUl = document.createElement("ul");
    subUl.className = "subtasks";
    task.subtasks.forEach(function (sub) {
      var subLi = document.createElement("li");
      subLi.className = "subtask" + (sub.done ? " done" : "");

      var subCheck = document.createElement("button");
      subCheck.className = "subtask-checkbox";
      subCheck.type = "button";
      subCheck.setAttribute("role", "checkbox");
      subCheck.setAttribute("aria-checked", String(sub.done));
      subCheck.setAttribute("aria-label", sub.text);
      subCheck.innerHTML = sub.done ? CHECK_SVG.replace('width="11" height="11"', 'width="9" height="9"') : "";
      subCheck.addEventListener("click", function () { toggleSubtask(task.id, sub.id); });
      subLi.appendChild(subCheck);

      var subText = document.createElement("span");
      subText.className = "subtask-text";
      subText.textContent = sub.text;
      subLi.appendChild(subText);

      var subRemove = document.createElement("button");
      subRemove.className = "subtask-remove";
      subRemove.type = "button";
      subRemove.setAttribute("aria-label", "Remove subtask " + sub.text);
      subRemove.textContent = "\u00d7";
      subRemove.addEventListener("click", function () { removeSubtask(task.id, sub.id); });
      subLi.appendChild(subRemove);

      subUl.appendChild(subLi);
    });
    expand.appendChild(subUl);

    var subAddForm = document.createElement("form");
    subAddForm.className = "subtask-add";
    subAddForm.innerHTML = '<input type="text" placeholder="Add a subtask…" aria-label="Add subtask" /><button type="submit">Add</button>';
    subAddForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = subAddForm.querySelector("input");
      addSubtask(task.id, input.value);
      input.value = "";
    });
    expand.appendChild(subAddForm);

    li.appendChild(expand);
    return li;
  }

  function enterEditMode(titleEl, taskId) {
    titleEl.contentEditable = "true";
    titleEl.focus();
    var range = document.createRange();
    range.selectNodeContents(titleEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function finish(commit) {
      titleEl.contentEditable = "false";
      titleEl.removeEventListener("blur", onBlur);
      titleEl.removeEventListener("keydown", onKeydown);
      if (commit) updateTaskTitle(taskId, titleEl.textContent);
      else render();
    }
    function onBlur() { finish(true); }
    function onKeydown(e) {
      if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    }
    titleEl.addEventListener("blur", onBlur);
    titleEl.addEventListener("keydown", onKeydown);
  }

  // Briefly mark a freshly-added task so it plays its entrance animation
  // (the CSS class .task already includes taskIn, this just brings it into view).
  function flagNewTask(id) {
    var li = document.querySelector('.task[data-id="' + id + '"]');
    if (li) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function flagJustCompleted(id) {
    var li = document.querySelector('.task[data-id="' + id + '"]');
    if (!li) return;
    li.classList.add("just-completed");
    setTimeout(function () { li.classList.remove("just-completed"); }, 650);
  }

  /* =====================================================
     13. DRAG & DROP REORDERING (Pointer Events — works for
     mouse, touch, and pen; only active in "Manual order" sort)
  ===================================================== */
  function attachDragHandle(handle, li) {
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();

      var list = li.parentElement;
      var startY = e.clientY;
      var startRect = li.getBoundingClientRect();

      li.classList.add("dragging-active");
      document.body.style.userSelect = "none";
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      function onMove(ev) {
        var deltaY = ev.clientY - startY;
        li.style.transform = "translateY(" + deltaY + "px)";

        var siblings = Array.prototype.slice.call(list.children).filter(function (c) { return c !== li; });
        for (var i = 0; i < siblings.length; i++) {
          var rect = siblings[i].getBoundingClientRect();
          var mid = rect.top + rect.height / 2;
          if (ev.clientY < mid) { list.insertBefore(li, siblings[i]); break; }
          if (i === siblings.length - 1) list.appendChild(li);
        }
      }

      function onUp(ev) {
        try { handle.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        li.style.transform = "";
        li.classList.remove("dragging-active");
        commitOrderFromDom(list);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  // After a manual drag, re-derive the `order` field for every task in that
  // bucket from the new DOM order, then persist and re-render.
  function commitOrderFromDom(list) {
    var ids = Array.prototype.slice.call(list.children).map(function (li) { return li.dataset.id; });
    ids.forEach(function (id, index) {
      var task = getTask(id);
      if (task) task.order = index * 10;
    });
    saveState();
    render();
  }

  /* =====================================================
     14. POPOVERS (quick-add: due / priority / category)
  ===================================================== */
  function closeAllPopovers() {
    ["duePopover", "priorityPopover", "projectPopover"].forEach(function (id) {
      document.getElementById(id).hidden = true;
    });
    ["dueBtn", "priorityBtn", "projectBtn"].forEach(function (id) {
      document.getElementById(id).setAttribute("aria-expanded", "false");
    });
  }

  function togglePopover(popoverId, btnId) {
    var popover = document.getElementById(popoverId);
    var isOpen = !popover.hidden;
    closeAllPopovers();
    if (!isOpen) {
      popover.hidden = false;
      document.getElementById(btnId).setAttribute("aria-expanded", "true");
    }
  }

  function updateChipLabels() {
    var dueBtn = document.getElementById("dueBtn");
    var dueLabel = document.getElementById("dueBtnLabel");
    if (state.pendingDue) { dueLabel.textContent = formatPillDate(state.pendingDue); dueBtn.classList.add("is-set"); }
    else { dueLabel.textContent = "Due date"; dueBtn.classList.remove("is-set"); }

    var prBtn = document.getElementById("priorityBtn");
    var prLabel = document.getElementById("priorityBtnLabel");
    if (state.pendingPriority) {
      prLabel.textContent = state.pendingPriority.charAt(0).toUpperCase() + state.pendingPriority.slice(1);
      prBtn.classList.add("is-set");
    } else { prLabel.textContent = "Priority"; prBtn.classList.remove("is-set"); }

    var pjBtn = document.getElementById("projectBtn");
    var pjLabel = document.getElementById("projectBtnLabel");
    var project = getProject(state.pendingProjectId);
    if (project) { pjLabel.textContent = project.name; pjBtn.classList.add("is-set"); }
    else { pjLabel.textContent = "Category"; pjBtn.classList.remove("is-set"); }
  }

  /* =====================================================
     15. INIT & EVENT WIRING
  ===================================================== */
  function init() {
    loadState();
    initTheme();
    buildColorSwatches();
    wireEvents();
    updateChipLabels();
    render();

    var bannerClose = document.getElementById("storageBannerClose");
    if (bannerClose) {
      bannerClose.addEventListener("click", dismissWarning);
    }
  }

  function buildColorSwatches() {
    var wrap = document.getElementById("colorSwatches");
    var selected = PROJECT_COLORS[0];
    PROJECT_COLORS.forEach(function (color, i) {
      var span = document.createElement("span");
      span.className = "swatch" + (i === 0 ? " selected" : "");
      span.style.background = color;
      span.dataset.color = color;
      span.addEventListener("click", function () {
        wrap.querySelectorAll(".swatch").forEach(function (s) { s.classList.remove("selected"); });
        span.classList.add("selected");
        selected = color;
      });
      wrap.appendChild(span);
    });
    wrap.getSelectedColor = function () { return selected; };
  }

  function wireEvents() {
    var addForm = document.getElementById("addForm");
    var addInput = document.getElementById("addInput");

    addForm.addEventListener("submit", function (e) {
      e.preventDefault();
      addTask(addInput.value);
      addInput.value = "";
      addInput.focus();
    });

    // Escape clears the quick-add input if it has focus and content.
    addInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && addInput.value) { addInput.value = ""; }
    });

    // Due popover
    document.getElementById("dueBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePopover("duePopover", "dueBtn");
    });
    var dueInput = document.getElementById("dueInput");
    dueInput.addEventListener("change", function () {
      state.pendingDue = dueInput.value || null;
      updateChipLabels();
    });
    document.querySelectorAll("#duePopover [data-quick]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var q = btn.dataset.quick;
        if (q === "today") state.pendingDue = todayISO();
        else if (q === "tomorrow") state.pendingDue = addDays(todayISO(), 1);
        else if (q === "week") state.pendingDue = addDays(todayISO(), 7);
        else state.pendingDue = null;
        dueInput.value = state.pendingDue || "";
        updateChipLabels();
        closeAllPopovers();
      });
    });

    // Priority popover
    document.getElementById("priorityBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePopover("priorityPopover", "priorityBtn");
    });
    document.querySelectorAll("#priorityPopover [data-priority]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.pendingPriority = btn.dataset.priority || null;
        updateChipLabels();
        closeAllPopovers();
      });
    });

    // Category (project) popover
    document.getElementById("projectBtn").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePopover("projectPopover", "projectBtn");
    });
    function submitNewProject() {
      var input = document.getElementById("newProjectInput");
      var name = input.value.trim();
      if (!name) return;
      var color = document.getElementById("colorSwatches").getSelectedColor();
      var project = createProject(name, color);
      state.pendingProjectId = project.id;
      input.value = "";
      updateChipLabels();
      renderProjectPopoverList();
      renderProjectChips();
      closeAllPopovers();
    }
    document.getElementById("newProjectSubmit").addEventListener("click", submitNewProject);
    document.getElementById("newProjectInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitNewProject(); }
    });

    document.addEventListener("click", function (e) {
      var isInsidePopover = e.target.closest(".popover") || e.target.closest(".chip-btn");
      if (!isInsidePopover) closeAllPopovers();
    });

    // Toolbar: filters
    document.getElementById("filterChips").addEventListener("click", function (e) {
      var btn = e.target.closest(".filter-chip");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach(function (c) { c.classList.remove("active"); });
      btn.classList.add("active");
      render();
    });

    document.getElementById("searchInput").addEventListener("input", function (e) {
      state.search = e.target.value;
      renderList();
    });

    document.getElementById("sortSelect").addEventListener("change", function (e) {
      state.sort = e.target.value;
      renderList();
    });

    // Global keyboard shortcuts
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      var isTyping = tag === "input" || tag === "textarea" || e.target.isContentEditable;

      if (e.key === "Escape") {
        closeAllPopovers();
        if (isTyping) e.target.blur();
        return;
      }
      if (isTyping || activeModal) return;

      if (e.key === "n" || e.key === "N") { e.preventDefault(); addInput.focus(); }
      else if (e.key === "/") { e.preventDefault(); document.getElementById("searchInput").focus(); }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
