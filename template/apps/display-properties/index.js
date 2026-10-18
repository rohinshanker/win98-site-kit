// Display Properties: pick a wallpaper or solid color from the choices in
// site.config.js (background.choices), or enter a custom color. The pick is
// saved per visitor in localStorage.

import {
  backgroundChoices,
  escapeHtml,
  getBackground,
  onBackgroundChange,
  resetBackground,
  setBackground,
} from "../../kit/index.js";

const swatchStyle = (choice) =>
  choice.image ? `background-image: url('${escapeHtml(choice.image)}')` : `background-color: ${escapeHtml(choice.color)}`;

export default {
  id: "display-properties",
  title: "Display Properties",
  label: "Display",
  icon: "assets/app-icons/ico/display_properties.ico",
  styles: ["apps/display-properties/display-properties.css"],
  window: { width: 420, controls: ["close"], dialog: true },
  render: ({ config }) => `
    <fieldset>
      <legend>Wallpaper</legend>
      <div class="display-choices" role="radiogroup" aria-label="Wallpaper">
        ${backgroundChoices()
          .map(
            (choice, index) => `
          <button type="button" class="display-choice" role="radio" aria-checked="false" data-choice-index="${index}">
            <span class="display-swatch" style="${swatchStyle(choice)}"></span>
            <span class="display-choice-label">${escapeHtml(choice.label)}</span>
          </button>`
          )
          .join("")}
      </div>
    </fieldset>
    ${
      config.background.allowCustom
        ? `
    <fieldset>
      <legend>Custom color</legend>
      <div class="field-row">
        <label for="display-custom-color">Color</label>
        <input id="display-custom-color" type="color" value="#008080" />
        <button type="button" data-display-apply-color>Apply</button>
      </div>
    </fieldset>`
        : ""
    }
    <div class="display-actions">
      <button type="button" data-display-reset>Use site default</button>
    </div>`,
  mount({ window: win }) {
    const choices = backgroundChoices();
    const buttons = [...win.querySelectorAll("[data-choice-index]")];
    const sync = () => {
      const current = getBackground();
      buttons.forEach((button) => {
        const choice = choices[Number(button.dataset.choiceIndex)];
        const active = choice.image === current.image && (choice.image || choice.color === current.color);
        button.setAttribute("aria-checked", String(Boolean(active)));
      });
    };
    buttons.forEach((button) => {
      button.addEventListener("click", () => setBackground(choices[Number(button.dataset.choiceIndex)]));
    });
    win.querySelector("[data-display-apply-color]")?.addEventListener("click", () => {
      setBackground({ label: "Custom color", color: win.querySelector("#display-custom-color").value });
    });
    win.querySelector("[data-display-reset]").addEventListener("click", resetBackground);
    onBackgroundChange(sync);
    sync();
  },
};
