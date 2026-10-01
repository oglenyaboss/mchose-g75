/* quiz.js — переиспользуемый квиз: <div class="quiz" data-correct="N" data-why="...">
   <p class="q">…</p> <button class="a">…</button>×N — мгновенный фидбек */
document.querySelectorAll('.quiz').forEach(qz => {
  const correct = +qz.dataset.correct;
  const why = qz.dataset.why || '';
  const fb = document.createElement('p');
  fb.className = 'fb';
  qz.appendChild(fb);
  qz.querySelectorAll('button.a').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (qz.classList.contains('done')) return;
      qz.classList.add('done');
      qz.querySelectorAll('button.a').forEach((b, j) => {
        b.disabled = true;
        if (j === correct) b.classList.add('right');
      });
      const ok = i === correct;
      btn.classList.add(ok ? 'right' : 'wrong');
      fb.textContent = (ok ? '✔ Верно. ' : '✘ Мимо. ') + why;
      fb.classList.add(ok ? 'ok' : 'bad');
    });
  });
});
