// Showcase config: every registry package installed, demo ordering, and the
// calendar/background features switched on so they can be reviewed.
export default {
  title: "win98-site-kit showcase",
  awayTitle: "come back :(",
  storagePrefix: "win98SiteKitShowcase",
  desktop: ["about", "projects", "writing", "creative-work", "study-resources", "socials", "*"],
  dock: ["about", "projects", "writing", "creative-work", "socials", "*"],
  background: {
    mode: "image",
    image: "assets/backgrounds/background-2200.jpg",
    color: "#008080",
    timeOfDay: {
      sunrise: "assets/backgrounds/sunrise.png",
      day: "assets/backgrounds/day.png",
      sunset: "assets/backgrounds/sunset.png",
      night: "assets/backgrounds/night.png",
    },
    choices: [
      { label: "Blue sky", image: "assets/backgrounds/mountain-and-sky.png" },
      { label: "Teal (classic)", color: "#008080" },
      { label: "Night", image: "assets/backgrounds/night.png" },
    ],
  },
  calendar: {
    enabled: true,
    photos: {
      "01-01": { title: "New Year's Day", image: "assets/backgrounds/sunrise.png" },
      "07-04": { title: "Fourth of July", image: "assets/backgrounds/day.png" },
      "10-31": { title: "Halloween", image: "assets/backgrounds/night.png" },
      "12-25": { title: "Happy holidays", image: "assets/backgrounds/sunset.png" },
    },
    quotes: {
      0: "\"The gentle yield of water will cut obstinate stone\"<br>—Lao Tzu",
      9: "\"I have no special talents. I am only passionately curious.\"<br>—Albert Einstein",
    },
    monthBackgrounds: { 9: "assets/backgrounds/mountain-and-sky.png" },
  },
  cursor: { enabled: false, defaultMode: "light" },
  clock: { hour12: true },
};
