/* tokenizer-demo.js — живой токенизатор: .tok-demo > input.tok-in + .tok-chips.
   Печатает строку → чипы «буква номер», словарь строится по частоте прямо в браузере. */
document.querySelectorAll('.tok-demo').forEach(td => {
  const input = td.querySelector('.tok-in');
  const chips = td.querySelector('.tok-chips');
  const esc = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const render = () => {
    const text = input.value;
    chips.innerHTML = '';
    if (!text) { chips.innerHTML = '<span class="chip">печатай…</span>'; return; }
    const freq = new Map();
    for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
    const vocab = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b));
    const stoi = new Map(vocab.map((c, i) => [c, i]));
    for (const ch of text) {
      const sp = document.createElement('span');
      sp.className = 'chip';
      sp.innerHTML = `${esc(ch === ' ' ? '␣' : ch)} <b>${stoi.get(ch)}</b>`;
      chips.appendChild(sp);
    }
  };
  input.addEventListener('input', render);
  render();
});
