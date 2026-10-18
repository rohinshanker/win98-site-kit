// The Date & Time popout behind the taskbar clock: a month grid with a
// digital clock. Config (`calendar` in site.config.js):
//   photos: { "10-31": { title, image }, "2026-01-01": "assets/x.jpg" }  — marks
//           those days; clicking one opens an alert with the photo.
//   quotes: { 0: "January quote", … }            — shown under the clock per month
//   monthBackgrounds: { 0: "assets/…jpg", … }    — photo behind the month grid
//   clockScenes: { sunrise, day, sunset, night } — picture next to the clock

import { pad2, escapeHtml } from "./util.js";
import { showAlert } from "./alerts.js";
import { onCloseAll } from "./windows.js";
import { timeOfDayPhase } from "./background.js";

let config = null;
let popout = null;
let elements = null;
let calendarDate = new Date();
let clockTimer = 0;
let hour12 = true;

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const render = () => `
  <div class="window calendar-popout" id="calendar-popout" aria-hidden="true" data-no-drag>
    <div class="title-bar">
      <div class="title-bar-text">Date &amp; Time</div>
      <div class="title-bar-controls">
        <button type="button" aria-label="Close" id="calendar-close"></button>
      </div>
    </div>
    <div class="window-body">
      <div class="calendar-panel">
        <div class="calendar-section" id="calendar-section">
          <div class="calendar-header">
            <button type="button" class="calendar-month" id="calendar-header" title="Back to today">Month YYYY</button>
            <span class="calendar-nav">
              <button type="button" id="calendar-prev" aria-label="Previous month">&lsaquo;</button>
              <button type="button" id="calendar-next" aria-label="Next month">&rsaquo;</button>
            </span>
          </div>
          <div class="calendar-grid" id="calendar-grid" role="grid" aria-label="Calendar"></div>
        </div>
      </div>
      <div class="calendar-divider" aria-hidden="true"></div>
      <div class="clock-panel">
        <div class="clock-section">
          <div class="clock-frame clock-slot-frame">
            <div class="clock-slot"><img id="clock-scene" alt="" width="190" height="110" /></div>
          </div>
          <div class="clock-frame">
            <div class="clock-display" id="calendar-clock" aria-live="off">
              <span data-clock-hours>--</span><span class="clock-colon">:</span><span data-clock-minutes>--</span><span class="clock-colon">:</span><span data-clock-seconds>--</span>
            </div>
          </div>
          <p class="clock-quote" id="clock-quote"></p>
        </div>
      </div>
    </div>
  </div>`;

const photoFor = (year, month, day) => {
  const monthDay = `${pad2(month + 1)}-${pad2(day)}`;
  return config.photos[`${year}-${monthDay}`] ?? config.photos[monthDay] ?? null;
};

const isOpen = () => popout?.classList.contains("is-open");

const updateClock = () => {
  if (!isOpen()) return;
  const now = new Date();
  const hours = now.getHours();
  elements.hours.textContent = pad2(hour12 ? hours % 12 || 12 : hours);
  elements.minutes.textContent = pad2(now.getMinutes());
  elements.seconds.textContent = pad2(now.getSeconds());
  const blinkOn = Math.floor(Date.now() / 500) % 2 === 0;
  elements.colons.forEach((colon) => colon.classList.toggle("is-off", !blinkOn));
  const scene = config.clockScenes[timeOfDayPhase(now)];
  if (scene && elements.scene.getAttribute("src") !== scene) {
    elements.scene.setAttribute("src", scene);
    elements.scene.setAttribute("alt", `${timeOfDayPhase(now)} scene`);
  }
};

const clampDate = (date) => {
  const now = new Date();
  const min = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const max = new Date(now.getFullYear() + 1, now.getMonth(), 1);
  if (date < min) return min;
  if (date > max) return max;
  return date;
};

const appendCell = (text, className = "calendar-day") => {
  const cell = document.createElement("div");
  cell.className = className;
  cell.setAttribute("role", "gridcell");
  cell.textContent = String(text);
  elements.grid.appendChild(cell);
  return cell;
};

const buildMonth = (date) => {
  calendarDate = clampDate(date);
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  elements.header.textContent = calendarDate.toLocaleDateString([], { month: "long", year: "numeric" });
  elements.grid.replaceChildren();
  const background = config.monthBackgrounds[month];
  elements.section.style.backgroundImage = background ? `url("${background}")` : "none";
  elements.section.classList.toggle("has-background", Boolean(background));
  elements.quote.innerHTML = config.quotes[month] ?? "";

  DAY_LABELS.forEach((label) => appendCell(label, "calendar-day calendar-day-label"));
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  for (let i = startDay - 1; i >= 0; i -= 1) appendCell(daysInPrevMonth - i, "calendar-day is-muted");
  for (let day = 1; day <= daysInMonth; day += 1) {
    const photo = photoFor(year, month, day);
    const isToday = isCurrentMonth && day === now.getDate();
    const cell = appendCell(day, `calendar-day${isToday ? " is-today" : ""}${photo ? " is-event-day" : ""}`);
    if (photo) {
      cell.setAttribute("role", "button");
      cell.tabIndex = 0;
      cell.title = photo.title || "Photo";
      cell.dataset.calendarPhoto = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    }
  }
  const total = DAY_LABELS.length + startDay + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i += 1) appendCell(i, "calendar-day is-muted");
};

const openPhoto = (cell) => {
  const [year, month, day] = cell.dataset.calendarPhoto.split("-").map(Number);
  const photo = photoFor(year, month - 1, day);
  if (!photo) return;
  void showAlert({
    id: "calendar-photo",
    title: photo.title || new Date(year, month - 1, day).toLocaleDateString([], { dateStyle: "long" }),
    icon: "assets/app-icons/ico/calendar.ico",
    body: `<p>${escapeHtml(new Date(year, month - 1, day).toLocaleDateString([], { dateStyle: "long" }))}</p>`,
    image: { src: photo.image, alt: photo.alt },
    width: 420,
    className: "calendar-photo-window",
  });
};

export const openCalendar = () => {
  if (!popout) return;
  popout.classList.add("is-open");
  popout.setAttribute("aria-hidden", "false");
  elements.button.setAttribute("aria-expanded", "true");
  buildMonth(new Date());
  updateClock();
  window.clearInterval(clockTimer);
  clockTimer = window.setInterval(updateClock, 500);
};

export const closeCalendar = () => {
  if (!popout || !isOpen()) return;
  popout.classList.remove("is-open");
  popout.setAttribute("aria-hidden", "true");
  elements.button.setAttribute("aria-expanded", "false");
  elements.section.style.backgroundImage = "none";
  elements.scene.removeAttribute("src");
  window.clearInterval(clockTimer);
  clockTimer = 0;
};

export const toggleCalendar = () => (isOpen() ? closeCalendar() : openCalendar());

export const isCalendarOpen = () => Boolean(isOpen());

/** Creates the popout and wires the taskbar clock button. boot.js calls this. */
export const initCalendar = (calendarConfig, clockButton, { hour12: twelveHour = true } = {}) => {
  config = calendarConfig;
  hour12 = twelveHour;
  if (!config.enabled || !clockButton) return;
  const template = document.createElement("template");
  template.innerHTML = render();
  popout = template.content.firstElementChild;
  document.body.appendChild(popout);
  elements = {
    button: clockButton,
    section: popout.querySelector("#calendar-section"),
    header: popout.querySelector("#calendar-header"),
    grid: popout.querySelector("#calendar-grid"),
    scene: popout.querySelector("#clock-scene"),
    quote: popout.querySelector("#clock-quote"),
    hours: popout.querySelector("[data-clock-hours]"),
    minutes: popout.querySelector("[data-clock-minutes]"),
    seconds: popout.querySelector("[data-clock-seconds]"),
    colons: [...popout.querySelectorAll(".clock-colon")],
  };
  clockButton.setAttribute("aria-haspopup", "dialog");
  clockButton.setAttribute("aria-controls", "calendar-popout");
  clockButton.setAttribute("aria-expanded", "false");
  clockButton.addEventListener("click", toggleCalendar);
  popout.querySelector("#calendar-close").addEventListener("click", closeCalendar);
  popout.querySelector("#calendar-prev").addEventListener("click", () => {
    buildMonth(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
  });
  popout.querySelector("#calendar-next").addEventListener("click", () => {
    buildMonth(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1));
  });
  elements.header.addEventListener("click", () => buildMonth(new Date()));
  elements.grid.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-calendar-photo]");
    if (cell) openPhoto(cell);
  });
  elements.grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = event.target.closest("[data-calendar-photo]");
    if (!cell) return;
    event.preventDefault();
    openPhoto(cell);
  });
  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (popout.contains(event.target) || clockButton.contains(event.target)) return;
    if (event.target.closest(".system-alert-window")) return;
    closeCalendar();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen() && !document.querySelector('.system-alert-window:not(.is-hidden)')) {
      closeCalendar();
    }
  });
  onCloseAll(closeCalendar);
};
