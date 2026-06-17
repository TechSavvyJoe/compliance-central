/**
 * Fast custom DOB picker.
 *
 * The visible control uses MM/DD/YYYY, while callers can read a normalized
 * YYYY-MM-DD value through getDateInputValue().
 */

import { CONFIG } from "../../lib/config.js";
import { ICONS } from "./icons.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PICKERS = new WeakMap();

export function initDatePickers(inputs) {
  for (const input of inputs) {
    initDatePicker(input);
  }
}

export function initDatePicker(input) {
  if (!input || PICKERS.has(input)) return;

  const shell = input.closest(".date-input-shell");
  if (!shell) return;

  const toggle = shell.querySelector(".date-picker-toggle");
  const popover = document.createElement("div");
  popover.className = "date-picker-popover";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", input.getAttribute("aria-label") || "Choose birth date");
  shell.appendChild(popover);

  // Persistent live region for screen-reader navigation announcements. It must
  // live OUTSIDE the popover (whose innerHTML is replaced on every render) so
  // the region survives re-renders and its text changes are actually announced.
  const liveRegion = document.createElement("div");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("role", "status");
  liveRegion.style.cssText =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;" +
    "overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;";
  shell.appendChild(liveRegion);

  const initial = parseDateValue(input.value);
  const state = {
    input,
    shell,
    toggle,
    popover,
    liveRegion,
    viewDate: initial?.date || defaultViewDate(),
    selectedDate: initial?.date || null,
    isOpen: false,
    mode: "days",
    yearPageStart: getYearPageStart((initial?.date || defaultViewDate()).getFullYear()),
    suppressFocusOpen: false,
    pointerDownInside: false,
  };
  PICKERS.set(input, state);

  input.placeholder = "MM/DD/YYYY";
  input.autocomplete ||= "off";

  toggle?.addEventListener("click", () => {
    if (state.isOpen) {
      closePicker(state);
      toggle.focus();
    } else {
      openPicker(state);
      input.focus();
    }
  });

  input.addEventListener("focus", () => {
    if (state.suppressFocusOpen) {
      state.suppressFocusOpen = false;
      return;
    }
    openPicker(state);
  });
  shell.addEventListener("pointerdown", () => {
    state.pointerDownInside = true;
    window.setTimeout(() => {
      state.pointerDownInside = false;
    }, 150);
  });
  input.addEventListener("input", () => handleInput(state));
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (state.pointerDownInside) return;
      if (!shell.contains(document.activeElement)) closePicker(state);
    }, 0);
  });
  input.addEventListener("keydown", (event) => handleInputKeydown(event, state));

  popover.addEventListener("focusout", () => {
    setTimeout(() => {
      if (state.pointerDownInside) return;
      if (!shell.contains(document.activeElement)) closePicker(state);
    }, 0);
  });

  document.addEventListener("pointerdown", (event) => {
    if (state.isOpen && !shell.contains(event.target)) closePicker(state);
  });

  if (initial) {
    setDateInputValue(input, initial.iso);
  }
  renderPicker(state);
}

export function getDateInputValue(input) {
  if (!input) return "";
  const parsed = parseDateValue(input.dataset.iso || input.value);
  return parsed?.iso || input.value.trim();
}

export function setDateInputValue(input, value) {
  if (!input) return;

  const parsed = parseDateValue(value);
  if (!parsed) {
    input.value = value || "";
    delete input.dataset.iso;
    const invalidState = PICKERS.get(input);
    if (invalidState) {
      invalidState.selectedDate = null;
      renderPicker(invalidState);
    }
    return;
  }

  input.value = formatDisplayDate(parsed.date);
  input.dataset.iso = parsed.iso;

  const state = PICKERS.get(input);
  if (state) {
    state.selectedDate = parsed.date;
    state.viewDate = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), 1);
    renderPicker(state);
  }
}

export function normalizeDateValue(value) {
  return parseDateValue(value)?.iso || value?.trim() || "";
}

function handleInput(state) {
  const masked = maskDateText(state.input.value);
  if (state.input.value !== masked) {
    state.input.value = masked;
  }

  const parsed = parseDateValue(masked);
  if (parsed) {
    state.input.dataset.iso = parsed.iso;
    state.selectedDate = parsed.date;
    state.viewDate = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), 1);
    renderPicker(state);
  } else {
    delete state.input.dataset.iso;
    state.selectedDate = null;
  }
}

function handleInputKeydown(event, state) {
  if (event.key === "Escape") {
    closePicker(state);
    return;
  }

  if (event.key === "Tab") {
    // The picker auto-opens on focus, so a plain Tab would otherwise dive into
    // the calendar's buttons instead of advancing to the next field (DLN/PID).
    // Close the popover synchronously — without preventing default — so its
    // controls leave the tab order before the browser moves focus.
    if (state.isOpen) closePicker(state);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    openPicker(state);
    focusActiveDay(state);
  }
}

function openPicker(state) {
  state.isOpen = true;
  state.input.setAttribute("aria-expanded", "true");
  state.shell.classList.add("date-picker-open");
  state.popover.hidden = false;
  renderPicker(state);
}

function closePicker(state) {
  state.isOpen = false;
  state.input.setAttribute("aria-expanded", "false");
  state.shell.classList.remove("date-picker-open");
  state.popover.hidden = true;

  const parsed = parseDateValue(state.input.value);
  if (parsed) setDateInputValue(state.input, parsed.iso);
}

function renderPicker(state) {
  const bounds = getDateBounds();
  state.viewDate = clampMonth(state.viewDate, bounds.minDate, bounds.maxDate);
  const viewYear = state.viewDate.getFullYear();
  const viewMonth = state.viewDate.getMonth();
  const isYearMode = state.mode === "years";
  if (isYearMode) {
    state.yearPageStart = clampYearPageStart(state.yearPageStart, bounds);
  } else {
    state.yearPageStart = getYearPageStart(viewYear);
  }
  const days = buildMonthDays(viewYear, viewMonth, bounds, state.selectedDate);
  const years = buildYearGrid(state.yearPageStart, viewYear, bounds);
  const rangeLabel = `${state.yearPageStart}-${state.yearPageStart + 15}`;

  state.popover.innerHTML = `
    <div class="date-picker-toolbar">
      <button type="button" class="date-nav-btn" data-action="${isYearMode ? "prev-years" : "prev-month"}" aria-label="${isYearMode ? "Previous years" : "Previous month"}">
        ${ICONS.chevron}
      </button>
      <div class="date-picker-selects${isYearMode ? " is-year-mode" : ""}">
        ${
          isYearMode
            ? `<button type="button" class="date-year-range" data-action="toggle-years">${rangeLabel}</button>`
            : `<select class="date-month-select" aria-label="Month">
                ${MONTHS.map(
                  (month, index) =>
                    `<option value="${index}"${index === viewMonth ? " selected" : ""}>${month}</option>`
                ).join("")}
              </select>`
        }
        <button type="button" class="date-year-trigger${isYearMode ? " is-active" : ""}" data-action="toggle-years" aria-pressed="${isYearMode}">
          ${viewYear}
        </button>
      </div>
      <button type="button" class="date-nav-btn date-nav-next" data-action="${isYearMode ? "next-years" : "next-month"}" aria-label="${isYearMode ? "Next years" : "Next month"}">
        ${ICONS.chevron}
      </button>
    </div>
    ${
      isYearMode
        ? `<div class="date-year-grid" role="grid" aria-label="Birth years">
            ${years.join("")}
          </div>`
        : `<div class="date-picker-weekdays" aria-hidden="true">
            ${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}
          </div>
          <div class="date-picker-grid" role="grid" aria-label="${MONTHS[viewMonth]} ${viewYear}">
            ${days.join("")}
          </div>`
    }
    <div class="date-picker-footer">
      <button type="button" class="date-clear-btn" data-action="clear">Clear</button>
      <button type="button" class="date-done-btn" data-action="done">Done</button>
    </div>
  `;

  bindPopoverEvents(state);
  positionPicker(state);

  // Announce the current view to screen readers on navigation. Guarded by
  // isOpen so the initial render (picker closed) doesn't speak unprompted.
  if (state.isOpen && state.liveRegion) {
    state.liveRegion.textContent = isYearMode
      ? `Years ${rangeLabel}`
      : `${MONTHS[viewMonth]} ${viewYear}`;
  }
}

function positionPicker(state) {
  if (!state.isOpen || state.popover.hidden) return;

  state.popover.classList.remove("date-picker-drop-up");
  state.popover.style.maxHeight = "";

  const inputRect = state.input.getBoundingClientRect();
  const roomBelow = window.innerHeight - inputRect.bottom - 10;
  const roomAbove = inputRect.top - 10;
  const useDropUp = roomBelow < 320 && roomAbove > roomBelow;
  const available = Math.max(180, useDropUp ? roomAbove : roomBelow);

  if (useDropUp) {
    state.popover.classList.add("date-picker-drop-up");
  }
  state.popover.style.maxHeight = `${available}px`;
}

function bindPopoverEvents(state) {
  const monthSelect = state.popover.querySelector(".date-month-select");

  monthSelect?.addEventListener("change", () => {
    state.viewDate = new Date(
      state.viewDate.getFullYear(),
      Number(monthSelect.value),
      1
    );
    renderPicker(state);
  });

  for (const button of state.popover.querySelectorAll("[data-action]")) {
    button.addEventListener("click", () => handleAction(button.dataset.action, state));
  }

  for (const button of state.popover.querySelectorAll("[data-date]")) {
    button.addEventListener("click", () => {
      setDateInputValue(state.input, button.dataset.date);
      state.input.dispatchEvent(new Event("input", { bubbles: true }));
      state.input.dispatchEvent(new Event("change", { bubbles: true }));
      closePicker(state);
      focusInputWithoutOpening(state);
    });
    button.addEventListener("keydown", (event) => handleDayKeydown(event, state));
  }

  for (const button of state.popover.querySelectorAll("[data-year]")) {
    button.addEventListener("click", () => {
      state.viewDate = new Date(Number(button.dataset.year), state.viewDate.getMonth(), 1);
      state.mode = "days";
      renderPicker(state);
    });
    button.addEventListener("keydown", (event) => handleYearKeydown(event, state));
  }
}

function handleAction(action, state) {
  if (action === "prev-month") {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    renderPicker(state);
  } else if (action === "next-month") {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    renderPicker(state);
  } else if (action === "toggle-years") {
    state.mode = state.mode === "years" ? "days" : "years";
    state.yearPageStart = getYearPageStart(state.viewDate.getFullYear());
    renderPicker(state);
  } else if (action === "prev-years") {
    state.yearPageStart -= 16;
    renderPicker(state);
  } else if (action === "next-years") {
    state.yearPageStart += 16;
    renderPicker(state);
  } else if (action === "clear") {
    state.input.value = "";
    delete state.input.dataset.iso;
    state.selectedDate = null;
    state.mode = "days";
    state.input.dispatchEvent(new Event("input", { bubbles: true }));
    state.input.dispatchEvent(new Event("change", { bubbles: true }));
    closePicker(state);
    focusInputWithoutOpening(state);
  } else if (action === "done") {
    closePicker(state);
    focusInputWithoutOpening(state);
  }
}

function handleDayKeydown(event, state) {
  const movement = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  }[event.key];

  if (movement == null) {
    if (event.key === "Escape") {
      closePicker(state);
      focusInputWithoutOpening(state);
    }
    return;
  }

  event.preventDefault();
  const days = Array.from(state.popover.querySelectorAll("[data-date]:not(:disabled)"));
  const currentIndex = days.indexOf(document.activeElement);
  const next = days[currentIndex + movement];
  if (next) {
    next.focus();
  } else if (movement < 0) {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
    renderPicker(state);
    focusEdgeDay(state, "last");
  } else {
    state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
    renderPicker(state);
    focusEdgeDay(state, "first");
  }
}

function handleYearKeydown(event, state) {
  const movement = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -4,
    ArrowDown: 4,
  }[event.key];

  if (movement == null) {
    if (event.key === "Escape") {
      state.mode = "days";
      renderPicker(state);
    }
    return;
  }

  event.preventDefault();
  const years = Array.from(state.popover.querySelectorAll("[data-year]:not(:disabled)"));
  const currentIndex = years.indexOf(document.activeElement);
  const next = years[currentIndex + movement];
  if (next) {
    next.focus();
  } else if (movement < 0) {
    state.yearPageStart -= 16;
    renderPicker(state);
    focusEdgeYear(state, "last");
  } else {
    state.yearPageStart += 16;
    renderPicker(state);
    focusEdgeYear(state, "first");
  }
}

function focusActiveDay(state) {
  const selectedIso = state.selectedDate ? toIsoDate(state.selectedDate) : null;
  const selector = selectedIso
    ? `[data-date="${selectedIso}"]`
    : ".date-day:not(:disabled)";
  state.popover.querySelector(selector)?.focus();
}

function focusInputWithoutOpening(state) {
  state.suppressFocusOpen = true;
  state.input.focus();
}

function focusEdgeDay(state, edge) {
  const days = Array.from(state.popover.querySelectorAll("[data-date]:not(:disabled)"));
  const target = edge === "last" ? days[days.length - 1] : days[0];
  target?.focus();
}

function focusEdgeYear(state, edge) {
  const years = Array.from(state.popover.querySelectorAll("[data-year]:not(:disabled)"));
  const target = edge === "last" ? years[years.length - 1] : years[0];
  target?.focus();
}

function buildMonthDays(year, month, bounds, selectedDate) {
  const selectedIso = selectedDate ? toIsoDate(selectedDate) : "";
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let cell = 0; cell < 42; cell += 1) {
    const day = cell - startOffset + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push('<span class="date-day-spacer" aria-hidden="true"></span>');
      continue;
    }

    const date = new Date(year, month, day);
    const iso = toIsoDate(date);
    const disabled = date < bounds.minDate || date > bounds.maxDate;
    const selected = iso === selectedIso;
    const classes = ["date-day"];
    if (selected) classes.push("is-selected");

    cells.push(`
      <button
        type="button"
        class="${classes.join(" ")}"
        data-date="${iso}"
        aria-label="${MONTHS[month]} ${day}, ${year}"
        ${selected ? 'aria-current="date"' : ""}
        ${disabled ? "disabled" : ""}
      >${day}</button>
    `);
  }

  return cells;
}

function buildYearGrid(startYear, viewYear, bounds) {
  const cells = [];
  for (let i = 0; i < 16; i += 1) {
    const year = startYear + i;
    const disabled =
      year < bounds.minDate.getFullYear() || year > bounds.maxDate.getFullYear();
    const selected = year === viewYear;
    const classes = ["date-year-btn"];
    if (selected) classes.push("is-selected");

    cells.push(`
      <button
        type="button"
        class="${classes.join(" ")}"
        data-year="${year}"
        ${selected ? 'aria-current="date"' : ""}
        ${disabled ? "disabled" : ""}
      >${year}</button>
    `);
  }
  return cells;
}

function defaultViewDate() {
  const today = new Date();
  return new Date(today.getFullYear() - 35, today.getMonth(), 1);
}

function getDateBounds() {
  const today = new Date();
  const maxDate = new Date(
    today.getFullYear() - CONFIG.validation.minAge,
    today.getMonth(),
    today.getDate()
  );
  const minDate = new Date(
    today.getFullYear() - CONFIG.validation.maxAge,
    today.getMonth(),
    today.getDate()
  );
  minDate.setHours(0, 0, 0, 0);
  maxDate.setHours(23, 59, 59, 999);
  return { minDate, maxDate };
}

function getYearPageStart(year) {
  return Math.floor(year / 16) * 16;
}

function clampYearPageStart(startYear, bounds) {
  const minStart = getYearPageStart(bounds.minDate.getFullYear());
  const maxStart = getYearPageStart(bounds.maxDate.getFullYear());
  return Math.min(maxStart, Math.max(minStart, startYear));
}

function clampMonth(date, minDate, maxDate) {
  const monthDate = new Date(date.getFullYear(), date.getMonth(), 1);
  const minMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const maxMonth = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
  if (monthDate < minMonth) return minMonth;
  if (monthDate > maxMonth) return maxMonth;
  return monthDate;
}

function maskDateText(value) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  let year, month, day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const compactUs = text.match(/^(\d{2})(\d{2})(\d{4})$/);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else if (compactUs) {
    month = Number(compactUs[1]);
    day = Number(compactUs[2]);
    year = Number(compactUs[3]);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { date, iso: toIsoDate(date) };
}

function toIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDisplayDate(date) {
  return [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
}
