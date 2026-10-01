/* dot-play.js — живое скалярное произведение: .dot-play с шестью input[type=range]
   (первые три — вектор a, вторые три — вектор b; значение /10) и span.dot-out. */
document.querySelectorAll('.dot-play').forEach(dp => {
  const ins = [...dp.querySelectorAll('input[type=range]')];
  const out = dp.querySelector('.dot-out');
  if (!out || ins.length < 6) return;
  const calc = () => {
    const v = ins.map(i => +i.value / 10);
    out.textContent = (v[0] * v[3] + v[1] * v[4] + v[2] * v[5]).toFixed(2);
  };
  ins.forEach(i => i.addEventListener('input', calc));
  calc();
});
