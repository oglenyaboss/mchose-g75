#!/usr/bin/env node
// Коллектор нажатий: keytap → скраббинг → corpus/personal.log (ADR 0003).
// Пауза: ⌃⌥K. Серии цифр ≥2 → <num>. Cmd/Ctrl-комбинации не пишутся (Alt —
// пишется: на macOS ⌥+буква это осмысленные символы).
// ponytail: буфер — одна строка без курсорной логики; стрелки/F-клавиши
// обрывают строку как есть. Апгрейд: курсорная модель или фреймы по сессиям.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TAP_BIN = process.env.KEYTAP_BIN || path.join(__dirname, 'keytap');
const LOG_PATH = process.env.MCHOSE_LOG || path.join(__dirname, 'corpus', 'personal.log');
const LOCK_PATH = LOG_PATH + '.lock';
const PAUSE_CODE = 40; // K
const PAUSE_MOD = 6;   // ctrl(2) | alt(4)
const MAX_LINE = 4096;

let paused = false;
let buf = '';
let shuttingDown = false;
let backoff = 500;

const lockHeld = (() => {
  try {
    const pid = +fs.readFileSync(LOCK_PATH, 'utf8');
    process.kill(pid, 0); // throws ESRCH если мёртв — лок протух
    return pid;
  } catch { return 0; }
})();
if (lockHeld) {
  console.error(`keylog: уже запущен (pid ${lockHeld}), выходим`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOCK_PATH, String(process.pid));
const log = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function flushLine() {
  if (!buf) return;
  log.write(buf.replace(/\d{2,}/g, '<num>') + '\n');
  buf = '';
}

function handleTapLine(raw) {
  backoff = 500; // тап живой
  let line = raw;
  let mod = 0;
  const mm = line.match(/ M:(\d+)$/);
  if (mm) { mod = +mm[1]; line = line.slice(0, mm.index); }
  const km = /^KEY:(\d+)(?: (.*))?$/.exec(line);
  if (!km) return;
  const code = +km[1];
  const ch = km[2] || '';

  if (code === PAUSE_CODE && mod === PAUSE_MOD) {
    flushLine();
    paused = !paused;
    process.stderr.write(paused ? 'keylog: пауза (⌃⌥K)\n' : 'keylog: запись возобновлена\n');
    return;
  }
  if (paused) return;
  if (mod & 3) return; // cmd | ctrl — шорткаты, не текст

  if (code === 36) { flushLine(); return; }          // return
  if (code === 51) {                                  // backspace
    buf = Array.from(buf).slice(0, -1).join('');
    return;
  }
  if (code === 48) { buf += ' '; return; }            // tab → разделитель
  if (ch === '') { flushLine(); return; }             // стрелки/Esc/F — обрыв строки
  buf += ch;
  if (buf.length >= MAX_LINE) flushLine();
}

function startTap() {
  const tap = spawn(TAP_BIN, [], { stdio: ['ignore', 'pipe', 'inherit'] });
  readline.createInterface({ input: tap.stdout }).on('line', handleTapLine);
  tap.on('exit', () => {
    if (shuttingDown) return;
    setTimeout(startTap, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  flushLine();
  log.end();
  try { fs.unlinkSync(LOCK_PATH); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startTap();
