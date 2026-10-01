/* temp-play.js — температура softmax: .temp-play > input.temp-t (range) + .temp-val
   + .temp-bars. Логиты — data-logits="2.1,1.3,..." корня, метки — data-labels="п,н,..." */
document.querySelectorAll('.temp-play').forEach(tp => {
  const logits = tp.dataset.logits.split(',').map(Number);
  const labels = tp.dataset.labels.split(',');
  const slider = tp.querySelector('.temp-t');
  const out = tp.querySelector('.temp-bars');
  const val = tp.querySelector('.temp-val');
  const render = () => {
    const T = +slider.value;
    const m = Math.max(...logits.map(l => l / T));
    const ex = logits.map(l => Math.exp(l / T - m));
    const s = ex.reduce((a, b) => a + b, 0);
    out.innerHTML = labels.map((lb, i) =>
      `<div class="bar"><span>${lb}</span><span class="tr"><span class="fl" style="width:${ex[i] / s * 100}%"></span></span><span>${(ex[i] / s * 100).toFixed(1)}%</span></div>`).join('');
    val.textContent = 'T = ' + T.toFixed(1);
  };
  slider.addEventListener('input', render);
  render();
});
