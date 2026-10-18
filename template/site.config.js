// site.config.js — the one file to edit to make this desktop yours.
// Every key is optional; kit/config.js documents the defaults and validates
// the shape at boot (a typo in an app id throws a readable error).

export default {
  // Browser tab title. `awayTitle` replaces it while the tab is hidden; "" disables that.
  title: "My Desktop",
  awayTitle: "come back :(",

  // Prefix for everything the kit stores in localStorage (background choice, cursor mode…).
  storagePrefix: "myDesktop",

  // Which installed apps appear, and in what order. "*" expands to every app
  // from apps/installed.js that is not named explicitly.
  desktop: ["about", "projects", "socials", "*"],
  dock: ["about", "projects", "socials", "*"],

  background: {
    // "image" | "color" | "time-of-day"
    mode: "image",
    image: "assets/backgrounds/background-2200.jpg",
    color: "#008080",
    // Used when mode is "time-of-day": sunrise 5–7, day 7–18, sunset 18–20, night otherwise.
    timeOfDay: {
      sunrise: "assets/backgrounds/sunrise.png",
      day: "assets/backgrounds/day.png",
      sunset: "assets/backgrounds/sunset.png",
      night: "assets/backgrounds/night.png",
    },
    // Extra wallpapers offered by the Display Properties app.
    choices: [
      { label: "Blue sky", image: "assets/backgrounds/mountain-and-sky.png" },
      { label: "Teal (classic)", color: "#008080" },
    ],
  },

  calendar: {
    enabled: true,
    // "MM-DD" repeats every year; "YYYY-MM-DD" marks one date. Clicking a
    // marked day opens the photo in a popup.
    photos: {
      "01-01": { title: "New Year's Day", image: "assets/backgrounds/sunrise.png" },
      "12-25": { title: "Happy holidays", image: "assets/backgrounds/night.png" },
    },
    // Optional per-month quote (0 = January) shown under the clock.
    quotes: {
      0: "\"The gentle yield of water will cut obstinate stone\"<br>—Lao Tzu",
    },
    // Optional per-month photo behind the grid.
    monthBackgrounds: {},
  },

  cursor: {
    // Set to true once you add a cursor pack to assets/cursors/ (see its README).
    enabled: false,
    defaultMode: "light",
  },

  clock: { hour12: true },
};
