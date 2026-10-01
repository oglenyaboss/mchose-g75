/* matmul.js — кликабельное умножение: .matmul > table.mm-a / .mm-b / .mm-c + .mm-shape + .mm-work.
   Значения A и B лежат в data-v каждой td; C заполняется и оживляется кликами:
   клетка C[i][j] подсвечивает строку i матрицы A и столбец j матрицы B и печатает вычисление. */
document.querySelectorAll('.matmul').forEach(mm => {
  const grid = t => [...t.tBodies[0].rows].map(r => [...r.cells].filter(c => c.tagName === 'TD'));
  const A = grid(mm.querySelector('.mm-a'));
  const B = grid(mm.querySelector('.mm-b'));
  const C = grid(mm.querySelector('.mm-c'));
  const rows = A.length, inner = B.length, cols = B[0].length;
  const work = mm.querySelector('.mm-work');
  const num = n => n.toFixed(2).replace('-', '−');

  const sums = [];
  for (let i = 0; i < rows; i++) {
    sums.push([]);
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let k = 0; k < inner; k++) s += +A[i][k].dataset.v * +B[k][j].dataset.v;
      sums[i].push(s);
    }
  }

  const show = (i, j) => {
    mm.querySelectorAll('.hl, .sel').forEach(el => el.classList.remove('hl', 'sel'));
    for (let k = 0; k < inner; k++) { A[i][k].classList.add('hl'); B[k][j].classList.add('hl'); }
    C[i][j].classList.add('sel');
    const terms = [];
    for (let k = 0; k < inner; k++) terms.push(`${num(+A[i][k].dataset.v)}·${num(+B[k][j].dataset.v)}`);
    work.textContent = `C[${i}][${j}] = ${terms.join(' + ')} = ${num(sums[i][j])}`;
  };

  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    C[i][j].textContent = num(sums[i][j]);
    C[i][j].classList.add('cell');
    C[i][j].addEventListener('click', () => show(i, j));
  }
  const shape = mm.querySelector('.mm-shape');
  if (shape) shape.textContent = `(${rows}×${inner}) @ (${inner}×${cols}) → (${rows}×${cols})   внутренние размеры обязаны совпасть`;
  show(0, 0);
});
