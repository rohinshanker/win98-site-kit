// Sudoku puzzle generation, off the main thread. Carving re-solves the grid
// after every removed clue, which would freeze the window if it ran there.
// This is a module worker so it shares the solver in rules.js.
//
// Protocol: post `{ requestId, difficulty, targetClues, maxAttempts }`;
// receive `{ requestId, difficulty, puzzle, solution, clues }`, or
// `{ requestId, difficulty, error }` if generation threw.

import { generatePuzzle } from "./rules.js";

self.addEventListener("message", (event) => {
  const { requestId, difficulty, targetClues, maxAttempts } = event.data || {};
  try {
    const generated = generatePuzzle(targetClues, maxAttempts);
    self.postMessage({ requestId, difficulty, ...generated });
  } catch (error) {
    self.postMessage({ requestId, difficulty, error: String(error?.message || error) });
  }
});
