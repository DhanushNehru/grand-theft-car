import { Game } from './game.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot'); // demo/screenshot mode: foot | drive | mission

const canvas = document.getElementById('game');
const game = new Game(canvas, { shot, fast: parseInt(params.get('fast') || '0', 10) });

if (shot) {
  game.startDemo();
} else {
  document.getElementById('start-btn').addEventListener('click', () => game.start());
}

// Expose for debugging in devtools.
window.__game = game;
