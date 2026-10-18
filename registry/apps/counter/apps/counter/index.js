// Counter: a multi-player life counter with seven-segment totals, step
// buttons, a "set value" field, optional initiative rolling and a window
// that widens one player column at a time from its title bar. State lives
// in localStorage under win98SiteKit.counter.*; the rules are in model.js.

import { clampIntoViewport, storage } from "../../kit/index.js";
import * as model from "./model.js";

const STATE_KEY = "win98SiteKit.counter.state";
const COLUMNS_KEY = "win98SiteKit.counter.columns";
const DICE_ICON = "assets/app-icons/ico/charmap_w2k.ico";
const CHECK_ICON = "assets/app-icons/ico/check.ico";

const DIGIT_SOURCES = Object.freeze({
  0: "assets/counter/digits/digital_0.png",
  1: "assets/counter/digits/digital_1.png",
  2: "assets/counter/digits/digital_2.png",
  3: "assets/counter/digits/digital_3.png",
  4: "assets/counter/digits/digital_4.png",
  5: "assets/counter/digits/digital_5.png",
  6: "assets/counter/digits/digital_6.png",
  7: "assets/counter/digits/digital_7.png",
  8: "assets/counter/digits/digital_8.png",
  9: "assets/counter/digits/digital_9.png",
  "-": "assets/counter/digits/digital_minus.png",
  " ": "assets/counter/digits/digital_unlit.png",
});

const element = (tag, className, attributes = {}) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

const iconButton = (className, label, iconSrc) => {
  const button = element("button", className, { type: "button", "aria-label": label });
  const icon = element("img", "", { src: iconSrc, alt: "" });
  button.append(icon);
  return button;
};

/** Everything the mounted window owns; created once in mount(). */
const createController = (win, body) => {
  const playersRoot = body.querySelector("[data-counter-players]");
  const addButton = body.querySelector("[data-counter-add]");
  const resetButton = body.querySelector("[data-counter-reset]");
  const initiativeActions = body.querySelector("[data-counter-initiative-actions]");
  const rollAllButton = body.querySelector("[data-counter-roll-all]");
  const initiativeToggle = body.querySelector("[data-counter-initiative-toggle]");

  let state = model.normalizeState(storage.readJson(STATE_KEY, null));
  const rollTimers = new Map();
  const rollingIds = new Set();
  let leaderIds = new Set();
  let leaderUpdatePending = false;

  const save = () => storage.writeJson(STATE_KEY, state);

  /** The rendered width; a style width wider than the viewport cap does not count. */
  const windowWidth = () => {
    const styleWidth = Number.parseFloat(win.style.width);
    const rectWidth = win.getBoundingClientRect().width;
    const rendered = rectWidth || styleWidth || model.WINDOW_DEFAULT_WIDTH;
    return Math.round(styleWidth ? Math.min(styleWidth, rendered) : rendered);
  };

  const maxWidthAtPosition = () => {
    if (win.classList.contains("is-hidden")) return model.maxWidthAtPosition(window.innerWidth);
    return model.maxWidthAtPosition(window.innerWidth, win.getBoundingClientRect().left);
  };

  const syncInitiativeToolbar = () => {
    const compactRollAll = model.columnsForWidth(windowWidth()) <= 2;
    const enabled = state.initiativeEnabled;
    initiativeActions.classList.toggle("is-split", enabled);
    initiativeActions.classList.toggle("is-compact-roll-all", enabled && compactRollAll);
    rollAllButton.hidden = !enabled;
    rollAllButton.classList.toggle("is-icon-only", compactRollAll);
    rollAllButton.title = compactRollAll ? "Roll all initiatives" : "";
    initiativeToggle.setAttribute("aria-pressed", String(enabled));
    initiativeToggle.textContent = enabled ? "Hide Initiative" : "Show Initiative";
  };

  const decreaseButton = element("button", "counter-title-control", {
    type: "button",
    "aria-label": "Decrease Counter width",
  });
  decreaseButton.textContent = "-";
  const increaseButton = element("button", "counter-title-control", {
    type: "button",
    "aria-label": "Increase Counter width",
  });
  increaseButton.textContent = "+";

  const updateWidthControls = () => {
    syncInitiativeToolbar();
    const currentColumns = model.columnsForWidth(windowWidth());
    decreaseButton.disabled = currentColumns <= 1;
    increaseButton.disabled = model.widthForColumns(currentColumns + 1) > maxWidthAtPosition();
  };

  const setWindowColumns = (direction) => {
    const nextColumns = model.columnsForWidth(windowWidth()) + direction;
    const nextWidth = model.widthForColumns(nextColumns);
    if (nextColumns < 1 || nextWidth > maxWidthAtPosition()) {
      updateWidthControls();
      return;
    }
    win.style.width = `${nextWidth}px`;
    storage.writeJson(COLUMNS_KEY, nextColumns);
    updateWidthControls();
  };

  /**
   * On open, widen to the saved column count when the viewport can hold it,
   * sliding the window left when its opening spot would push it off screen.
   */
  const applySavedColumns = () => {
    const saved = storage.readJson(COLUMNS_KEY, null);
    if (!Number.isInteger(saved) || saved < 1) return;
    const viewportMax = model.maxWidthAtPosition(window.innerWidth);
    let columns = saved;
    while (columns > 1 && model.widthForColumns(columns) > viewportMax) columns -= 1;
    if (columns === model.columnsForWidth(windowWidth())) return;
    win.style.width = `${model.widthForColumns(columns)}px`;
    clampIntoViewport(win);
    updateWidthControls();
  };

  const clearRoll = (playerId) => {
    const timerId = rollTimers.get(playerId);
    if (timerId !== undefined) window.clearTimeout(timerId);
    rollTimers.delete(playerId);
    rollingIds.delete(playerId);
  };

  const clearAllRolls = () => {
    for (const playerId of [...rollTimers.keys()]) clearRoll(playerId);
    rollingIds.clear();
  };

  const updateLeaders = ({ force = false } = {}) => {
    if (!force && !leaderUpdatePending) return;
    if (!state.initiativeEnabled || rollingIds.size) return;
    leaderIds = new Set(model.initiativeLeaders(state.players));
    leaderUpdatePending = false;
  };

  const commit = (nextState) => {
    state = nextState;
    save();
    render();
  };

  const selectInitiative = (playerId, value) => {
    if (model.normalizeInitiative(value) === null || !model.getPlayer(state, playerId)) return;
    clearRoll(playerId);
    leaderUpdatePending = false;
    leaderIds = new Set();
    commit(model.setInitiative(state, playerId, value));
  };

  const startRoll = (playerId) => {
    if (!state.initiativeEnabled || !model.getPlayer(state, playerId)) return;
    clearRoll(playerId);
    leaderUpdatePending = true;
    const sequence = model.createRollSequence();
    rollingIds.add(playerId);

    const advance = (index) => {
      if (!model.getPlayer(state, playerId)) {
        clearRoll(playerId);
        return;
      }
      const isFinalFrame = index >= sequence.length - 1;
      state = model.setInitiative(state, playerId, sequence[index]);
      if (isFinalFrame) {
        rollTimers.delete(playerId);
        rollingIds.delete(playerId);
        updateLeaders();
        save();
        render();
        return;
      }
      render();
      rollTimers.set(
        playerId,
        window.setTimeout(() => advance(index + 1), model.rollDelay(index))
      );
    };
    advance(0);
  };

  const startAllRolls = () => {
    if (!state.initiativeEnabled) return;
    for (const player of state.players) startRoll(player.id);
  };

  const removePlayer = (playerId) => {
    clearRoll(playerId);
    state = model.removePlayer(state, playerId);
    if (leaderIds.size) updateLeaders({ force: true });
    save();
    render();
  };

  const setInitiativeEnabled = (enabled) => {
    state = model.setInitiativeEnabled(state, enabled);
    if (!state.initiativeEnabled) {
      clearAllRolls();
      leaderUpdatePending = false;
      leaderIds = new Set();
    }
    save();
    syncInitiativeToolbar();
    render();
  };

  const appendDigits = (container, value) => {
    for (const digit of model.formatDigits(value)) {
      const image = element("img", "counter-digit", { src: DIGIT_SOURCES[digit] ?? DIGIT_SOURCES[" "], alt: "" });
      container.append(image);
    }
  };

  const submitValue = (player, input, submitButton) => {
    const value = model.parseSubmitValue(input.value);
    if (value === null) {
      submitButton.disabled = true;
      return;
    }
    commit(model.setLife(state, player.id, value, player.life));
  };

  const renderPlayer = (player) => {
    const playerName = player.name || "player";
    const selectedStep = model.normalizeStep(player.selectedStep);
    const rolling = rollingIds.has(player.id);

    const card = element("section", "counter-player", { "data-player-id": String(player.id) });
    card.classList.toggle("is-initiative-leader", leaderIds.has(player.id));

    const header = element("div", "counter-player-header");
    const nameInput = element("input", "counter-name", { type: "text", "aria-label": "Player name" });
    nameInput.value = player.name;
    nameInput.addEventListener("input", () => {
      state = model.renamePlayer(state, player.id, nameInput.value);
      save();
    });
    const removeButton = element("button", "counter-remove", { type: "button", "aria-label": `Delete ${playerName}` });
    removeButton.textContent = "X";
    removeButton.addEventListener("click", () => removePlayer(player.id));
    header.append(nameInput, removeButton);

    const total = element("div", "counter-total", {
      role: "img",
      "aria-live": "polite",
      "aria-label": String(player.life),
    });
    appendDigits(total, player.life);

    const setRow = element("div", "counter-set-row");
    const valueInput = element("input", "counter-value-input", {
      type: "number",
      inputmode: "numeric",
      min: String(model.MIN_VALUE),
      max: String(model.MAX_VALUE),
      step: "1",
      placeholder: "Set value",
      "aria-label": `Set value for ${playerName}`,
    });
    const submitButton = iconButton("counter-submit", `Submit value for ${playerName}`, CHECK_ICON);
    submitButton.disabled = true;
    valueInput.addEventListener("input", () => {
      submitButton.disabled = model.parseSubmitValue(valueInput.value) === null;
    });
    valueInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submitValue(player, valueInput, submitButton);
    });
    submitButton.addEventListener("click", () => submitValue(player, valueInput, submitButton));
    setRow.append(valueInput, submitButton);

    const controls = element("div", "counter-controls");
    const stepGrid = element("div", "counter-step-grid");
    for (const step of model.STEP_VALUES) {
      const isSelected = step === selectedStep;
      const stepButton = element("button", "", {
        type: "button",
        "aria-pressed": String(isSelected),
        "aria-label": `Select ${step}`,
      });
      stepButton.textContent = String(step);
      stepButton.classList.toggle("is-selected", isSelected);
      stepButton.addEventListener("click", () => commit(model.selectStep(state, player.id, step)));
      stepGrid.append(stepButton);
    }
    const adjustRow = element("div", "counter-adjust-row");
    for (const { label, direction, action } of [
      { label: "-", direction: -1, action: "Subtract" },
      { label: "+", direction: 1, action: "Add" },
    ]) {
      const adjustButton = element("button", "", { type: "button", "aria-label": `${action} selected value` });
      adjustButton.textContent = label;
      adjustButton.addEventListener("click", () => commit(model.adjustLife(state, player.id, direction)));
      adjustRow.append(adjustButton);
    }
    controls.append(stepGrid, adjustRow);

    card.append(header, total, setRow, controls);
    if (!state.initiativeEnabled) return card;

    const initiative = element("div", "counter-initiative");
    const initiativeHeader = element("div", "counter-initiative-header");
    const initiativeLabel = element("span", "counter-initiative-label");
    initiativeLabel.textContent = "Initiative";
    const rollButton = iconButton("counter-initiative-roll", `Roll initiative for ${playerName}`, DICE_ICON);
    rollButton.disabled = rolling;
    rollButton.addEventListener("click", () => startRoll(player.id));
    initiativeHeader.append(initiativeLabel, rollButton);

    const initiativeGrid = element("div", "counter-initiative-grid");
    for (const value of model.INITIATIVE_VALUES) {
      const isSelected = player.initiative === value;
      const initiativeButton = element("button", "", {
        type: "button",
        "aria-pressed": String(isSelected),
        "aria-label": `Set initiative to ${value}`,
      });
      initiativeButton.textContent = String(value);
      initiativeButton.classList.toggle("is-selected", isSelected);
      initiativeButton.classList.toggle("is-rolling", rolling && isSelected);
      initiativeButton.addEventListener("click", () => selectInitiative(player.id, value));
      initiativeGrid.append(initiativeButton);
    }
    initiative.append(initiativeHeader, initiativeGrid);
    card.append(initiative);
    return card;
  };

  const render = () => {
    const { scrollTop, scrollLeft } = playersRoot;
    const restoreScroll = () => {
      playersRoot.scrollTop = scrollTop;
      playersRoot.scrollLeft = scrollLeft;
    };
    playersRoot.replaceChildren(...state.players.map(renderPlayer));
    restoreScroll();
    window.requestAnimationFrame(restoreScroll);
  };

  const bindTitleControls = () => {
    const controls = win.querySelector(".title-bar-controls");
    const closeButton = controls.querySelector('[data-window-control="close"]');
    controls.insertBefore(decreaseButton, closeButton);
    controls.insertBefore(increaseButton, closeButton);
    for (const [button, direction] of [
      [decreaseButton, -1],
      [increaseButton, 1],
    ]) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setWindowColumns(direction);
      });
    }
  };

  addButton.addEventListener("click", () => commit(model.addPlayer(state)));
  resetButton.addEventListener("click", () => commit(model.resetLife(state)));
  initiativeToggle.addEventListener("click", () => setInitiativeEnabled(!state.initiativeEnabled));
  rollAllButton.addEventListener("click", startAllRolls);
  bindTitleControls();
  render();
  updateWidthControls();

  return Object.freeze({
    onOpen() {
      applySavedColumns();
      updateWidthControls();
    },
    updateWidthControls,
  });
};

let controller = null;

export default {
  id: "counter",
  title: "Counter",
  icon: "assets/app-icons/ico/charmap_w2k.ico",
  styles: ["apps/counter/counter.css"],
  window: {
    className: "counter-window",
    controls: ["close"],
  },
  render: () => `
    <div class="counter-app" aria-label="Life counter">
      <div class="counter-toolbar">
        <div class="counter-toolbar-actions">
          <button type="button" data-counter-add>Add Player</button>
          <button type="button" data-counter-reset>Reset to 20</button>
          <div class="counter-initiative-actions" data-counter-initiative-actions>
            <button
              class="counter-roll-all"
              type="button"
              data-counter-roll-all
              aria-label="Roll all initiatives"
              hidden
            >
              <img src="${DICE_ICON}" width="16" height="16" alt="" />
              <span>Roll All</span>
            </button>
            <button class="counter-toggle" type="button" data-counter-initiative-toggle aria-pressed="false">
              Show Initiative
            </button>
          </div>
        </div>
      </div>
      <div class="counter-players" data-counter-players aria-live="polite"></div>
    </div>`,
  mount({ window: win, body }) {
    controller = createController(win, body);
  },
  onOpen() {
    controller?.onOpen();
  },
  onDragEnd() {
    controller?.updateWidthControls();
  },
  onResize() {
    controller?.updateWidthControls();
  },
};
