// MCHOSE G75 Pro в реальном времени.
// Геометрия: 82 клавиши из g75-board.json (центры и ширины в u, 1u = 19.05 мм), колпачки лепятся процедурно.
// Свет: цвета и яркость как в candle.cjs — цвет по месту ставки, яркость p^0.4.
import * as THREE from "three";
import { RoomEnvironment } from "../vendor/three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "../vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "../vendor/three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "../vendor/three/addons/postprocessing/OutputPass.js";
import { OrbitControls } from "../vendor/three/addons/OrbitControls.js";

const D = window.MCHOSE;
const MM = 1 / 19.05;

// Арт-дирекция сцены. Колпачки stone black: светлые сверху, к нижнему ряду почти чёрные (как у вендора).
const LOOK = {
  capRows: ["#8f9296", "#85888c", "#6f7276", "#5a5d61", "#404347", "#292b2e"],
  legendDark: "#1b1d20",
  legendLight: "#d7d9dc",
  caseColor: "#191b1e",
  plateColor: "#08090a",
  capRoughness: 0.74,
  envIntensity: 0.55,
  ledGlow: 3.2,      // яркость пятна света под колпачком
  ledLegend: 4.5,    // свечение подписи насквозь
  ledSide: 0.05,     // лёгкое свечение пластика
  ledLight: 0.32,    // точечный свет под колпачком, кд
  bloom: { strength: 0.8, radius: 0.55, threshold: 0.9 },
};

// Профиль рядов: высота по центру (мм) и наклон верха (градусы, плюс — к пользователю).
const ROWS = [
  { h: 11.4, tilt: 9 }, { h: 11.4, tilt: 9 }, { h: 9.8, tilt: 5 },
  { h: 9.1, tilt: 0 }, { h: 9.5, tilt: -5 }, { h: 9.5, tilt: -5 },
];

const FAMILY = [
  [[0, [0, 0, 0]], [0.5, [40, 220, 110]], [1, [225, 255, 225]]],
  [[0, [0, 0, 0]], [0.5, [235, 140, 20]], [1, [255, 215, 150]]],
  [[0, [0, 0, 0]], [0.5, [0, 150, 220]], [1, [160, 220, 255]]],
];

export function ledColor(rank, p) {
  const t = Math.max(0, Math.min(1, Math.pow(p, 0.4)));
  const stops = FAMILY[rank];
  let c = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], k = (t - a[0]) / (b[0] - a[0]);
      c = [0, 1, 2].map(j => a[1][j] + (b[1][j] - a[1][j]) * k);
      break;
    }
  }
  return "#" + c.map(v => Math.round(Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

// ---------- геометрия колпачка ----------

function loop(w, d, r, seg) {
  const pts = [];
  const cx = w / 2 - r, cz = d / 2 - r;
  const corners = [[cx, -cz, -Math.PI / 2], [cx, cz, 0], [-cx, cz, Math.PI / 2], [-cx, -cz, Math.PI]];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([ox + r * Math.cos(a), oz + r * Math.sin(a)]);
    }
  }
  return pts;
}

function capGeometry(wU, row) {
  const prof = ROWS[row];
  const Wb = wU, Db = 0.913;
  const Wt = Wb - 5.4 * MM, Dt = Db - 4.6 * MM;
  const zOff = -0.6 * MM;                  // верх чуть смещён назад
  const hc = prof.h * MM;
  const tan = Math.tan(prof.tilt * Math.PI / 180);
  const dish = 0.55 * MM;
  const seg = 7;

  const B = loop(Wb, Db, 1.1 * MM, seg);
  const E = loop(Wt + 0.8 * MM, Dt + 0.8 * MM, 2.4 * MM, seg);
  const T = loop(Wt, Dt, 2.1 * MM, seg);
  const n = B.length;

  const topY = (x, z) => {
    const zl = z - zOff;
    const hx = Wt / 2, hz = Dt / 2;
    const fx = Math.min(1, (x / hx) ** 2), fz = Math.min(1, (zl / hz) ** 2);
    return hc - zl * tan - dish * (1 - fx) * (1 - 0.35 * fz);
  };

  const pos = [], uv = [], side = [], top = [];
  const push = (x, y, z, u = 0, v = 0) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };

  const ringB = B.map(([x, z]) => push(x, 0, z));
  const ringM = B.map(([x, z], i) => {
    const [tx, tz] = E[i];
    const k = 0.62;
    const mx = x + (tx - x) * k * 0.82, mz = z + (tz + zOff - z) * k * 0.82;
    return push(mx, (hc - mz * tan) * k * 0.98, mz);
  });
  const ringE = E.map(([x, z]) => {
    const zz = z + zOff;
    return push(x, hc - zz * tan - 0.55 * MM, zz);
  });
  const uvOf = (x, z) => [x / Wt + 0.5, 0.5 - (z - zOff) / Dt];
  const rings = [];
  const RINGS = 6;
  for (let r = 0; r < RINGS; r++) {
    const s = 1 - r / RINGS;
    rings.push(T.map(([x, z]) => {
      const xx = x * s, zz = z * s + zOff;
      const [u, v] = uvOf(xx, zz);
      return push(xx, topY(xx, zz), zz, u, v);
    }));
  }
  const [cu, cv] = uvOf(0, zOff);
  const center = push(0, topY(0, zOff), zOff, cu, cv);

  const band = (arr, lo, hi) => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      arr.push(lo[i], hi[i], lo[j], lo[j], hi[i], hi[j]);
    }
  };
  band(side, ringB, ringM);
  band(side, ringM, ringE);
  band(side, ringE, rings[0]);
  for (let r = 0; r < RINGS - 1; r++) {
    const o = rings[r], inn = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      top.push(o[i], inn[i], o[j], o[j], inn[i], inn[j]);
    }
  }
  const last = rings[RINGS - 1];
  for (let i = 0; i < n; i++) top.push(last[i], center, last[(i + 1) % n]);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...side, ...top]);
  g.addGroup(0, side.length, 0);
  g.addGroup(side.length, top.length, 1);
  g.computeVertexNormals();
  return { geometry: g, aspect: Wt / Dt };
}

// ---------- текстуры ----------

function legendCanvases(key, aspect, capHex) {
  const H = 128, W = Math.round(H * Math.max(1, aspect));
  const make = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const map = make(), glow = make();
  const mc = map.getContext("2d"), gc = glow.getContext("2d");
  mc.fillStyle = capHex; mc.fillRect(0, 0, W, H);
  gc.fillStyle = "#000"; gc.fillRect(0, 0, W, H);
  const ink = key.r <= 2 ? LOOK.legendDark : LOOK.legendLight;
  const draw = (ctx, color) => {
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    const big = key.lg.length === 1 ? 34 : 22;
    if (key.sb) {
      ctx.font = `500 26px Geist, system-ui, sans-serif`;
      ctx.fillText(key.sb, 18, 16);
      ctx.fillText(key.lg, 18, 60);
    } else if (key.lg) {
      ctx.font = `500 ${big}px Geist, system-ui, sans-serif`;
      ctx.fillText(key.lg, 18, 18);
    }
  };
  draw(mc, ink);
  draw(gc, "#fff");
  return { map, glow };
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.45, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- корпус ----------

function roundedShape(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// ---------- клавиатура ----------

export class Keyboard {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.keys = new Map();
    this.lights = [];
    this.animating = false;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff4e8, 1.6);
    key.position.set(-6, 11, 5);
    const rim = new THREE.DirectionalLight(0xdbe8ff, 1.1);
    rim.position.set(5, 5, -9);
    const hemi = new THREE.HemisphereLight(0xe8eef0, 0x0a0b0c, 0.25);
    this.scene.add(key, rim, hemi);

    this.buildCase();
    this.buildKeys(renderer);

    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1.4, 2);
      l.visible = false;
      this.scene.add(l);
      this.lights.push(l);
    }
  }

  buildCase() {
    const { w, d, r } = D.deck;
    const xs = D.keys.flatMap(k => [k.u - k.w / 2, k.u + k.w / 2]);
    const zs = D.keys.flatMap(k => [-k.v - 0.4565, -k.v + 0.4565]);
    const x0 = Math.min(...xs) - 0.11, x1 = Math.max(...xs) + 0.11;
    const z0 = Math.min(...zs) - 0.11, z1 = Math.max(...zs) + 0.11;
    this.well = { x0, x1, z0, z1 };

    const outer = roundedShape(w, d, r);
    const hole = new THREE.Path();
    const hw = x1 - x0, hd = z1 - z0, hr = 0.14;
    // отверстие: shape y = -z мира, обход против внешнего контура
    const hx = x0, hy = -z1;
    hole.moveTo(hx + hr, hy);
    hole.lineTo(hx + hw - hr, hy); hole.quadraticCurveTo(hx + hw, hy, hx + hw, hy + hr);
    hole.lineTo(hx + hw, hy + hd - hr); hole.quadraticCurveTo(hx + hw, hy + hd, hx + hw - hr, hy + hd);
    hole.lineTo(hx + hr, hy + hd); hole.quadraticCurveTo(hx, hy + hd, hx, hy + hd - hr);
    hole.lineTo(hx, hy + hr); hole.quadraticCurveTo(hx, hy, hx + hr, hy);
    outer.holes.push(hole);

    const depth = 0.72;
    const geo = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 5, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -0.44, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: LOOK.caseColor, metalness: 0.75, roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.5, envMapIntensity: 0.7 });
    this.scene.add(new THREE.Mesh(geo, mat));

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(hw + 0.02, 0.05, hd + 0.02),
      new THREE.MeshStandardMaterial({ color: LOOK.plateColor, roughness: 0.92, metalness: 0.1 })
    );
    plate.position.set((x0 + x1) / 2, -0.025, (z0 + z1) / 2);
    this.scene.add(plate);
  }

  buildKeys(renderer) {
    const glowTex = glowTexture();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const cache = new Map();
    for (const k of D.keys) {
      const id = k.w + ":" + k.r;
      if (!cache.has(id)) cache.set(id, capGeometry(k.w, k.r));
      const { geometry, aspect } = cache.get(id);
      const capHex = LOOK.capRows[k.r];
      const { map, glow } = legendCanvases(k, aspect, capHex);
      const mapTex = new THREE.CanvasTexture(map);
      mapTex.colorSpace = THREE.SRGBColorSpace; mapTex.anisotropy = aniso;
      const glowMap = new THREE.CanvasTexture(glow);
      glowMap.colorSpace = THREE.SRGBColorSpace; glowMap.anisotropy = aniso;

      const sideMat = new THREE.MeshStandardMaterial({ color: capHex, roughness: LOOK.capRoughness, metalness: 0, envMapIntensity: LOOK.envIntensity, emissive: 0x000000 });
      const topMat = new THREE.MeshStandardMaterial({ map: mapTex, roughness: LOOK.capRoughness - 0.06, metalness: 0, envMapIntensity: LOOK.envIntensity, emissive: 0x000000, emissiveMap: glowMap, emissiveIntensity: 0 });

      const cap = new THREE.Mesh(geometry, [sideMat, topMat]);
      const group = new THREE.Group();
      group.position.set(k.u, 0.24, -k.v);
      group.add(cap);
      this.scene.add(group);

      const gm = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(k.w + 0.62, 0.913 + 0.62), gm);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(k.u, 0.006, -k.v);
      pool.visible = false;
      this.scene.add(pool);

      this.keys.set(k.s, { k, group, sideMat, topMat, pool, cur: 0, target: 0, color: new THREE.Color(0), press: 0, pressTarget: 0 });
    }
  }

  // lit: [{ s, c, p }] — слот, цвет кадра, вероятность
  setLit(lit, { pressed = null, instant = false } = {}) {
    for (const o of this.keys.values()) { o.target = 0; o.pressTarget = 0; }
    (lit || []).forEach(c => {
      const o = this.keys.get(c.s);
      if (!o) return;
      o.target = 1;
      o.color.set(c.c);
    });
    if (pressed != null && this.keys.has(pressed)) this.keys.get(pressed).pressTarget = 1;
    this.lit = (lit || []).slice(0, 3);
    if (instant) for (const o of this.keys.values()) { o.cur = o.target; o.press = o.pressTarget; }
    this.apply();
  }

  press(slot) {
    const o = this.keys.get(slot);
    if (!o) return;
    o.pressStart = performance.now();
  }

  update(now, reduced) {
    let busy = false;
    for (const o of this.keys.values()) {
      if (o.cur !== o.target) {
        const step = o.target > o.cur ? 16 / 160 : 16 / 110;
        o.cur = o.target > o.cur ? Math.min(o.target, o.cur + step) : Math.max(o.target, o.cur - step);
        if (reduced) o.cur = o.target;
        busy = true;
      }
      let dip = o.press;
      if (o.pressStart != null && !reduced) {
        const t = now - o.pressStart;
        if (t < 60) dip = Math.max(dip, t / 60);
        else if (t < 180) dip = Math.max(dip, 1 - (t - 60) / 120);
        else o.pressStart = null;
        busy = true;
      } else if (reduced) o.pressStart = null;
      o.group.position.y = 0.24 - dip * 3.6 * MM;
    }
    this.apply();
    return busy;
  }

  apply() {
    let li = 0;
    for (const l of this.lights) { l.visible = false; l.intensity = 0; }
    for (const o of this.keys.values()) {
      const v = o.cur;
      const on = v > 0.001;
      o.pool.visible = on;
      if (on) {
        o.pool.material.color.copy(o.color).multiplyScalar(LOOK.ledGlow * v);
        o.topMat.emissive.copy(o.color);
        o.topMat.emissiveIntensity = LOOK.ledLegend * v;
        o.sideMat.emissive.copy(o.color).multiplyScalar(LOOK.ledSide * v);
        if (li < this.lights.length) {
          const l = this.lights[li++];
          l.visible = true;
          l.color.copy(o.color);
          l.intensity = LOOK.ledLight * v;
          l.position.set(o.k.u, 0.12, -o.k.v);
        }
      } else {
        o.topMat.emissiveIntensity = 0;
        o.sideMat.emissive.setRGB(0, 0, 0);
      }
    }
    for (const o of this.keys.values()) if (o.pressStart == null) o.group.position.y = 0.24 - o.press * 3.6 * MM;
  }

  // рамка для камеры: вся доска или колпачки выбранных слотов с полем
  box(region, pad = 0.35) {
    const b = new THREE.Box3();
    if (region === "board") {
      const { w, d } = D.deck;
      b.set(new THREE.Vector3(-w / 2 - 0.06, -0.5, -d / 2 - 0.06), new THREE.Vector3(w / 2 + 0.06, 0.8, d / 2 + 0.06));
      return b;
    }
    for (const s of region) {
      const o = this.keys.get(s);
      if (!o) continue;
      const { u, v, w } = o.k;
      b.expandByPoint(new THREE.Vector3(u - w / 2 - pad, 0, -v - 0.46 - pad));
      b.expandByPoint(new THREE.Vector3(u + w / 2 + pad, 0.8, -v + 0.46 + pad));
    }
    return b;
  }
}

// камера смотрит на центр рамки под азимутом и углом, расстояние подбирается так, чтобы рамка влезла
export function fitCamera(camera, box, az, el, margin = 0.06) {
  const center = box.getCenter(new THREE.Vector3());
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  let lo = 0.5, hi = 400;
  const lim = 1 - margin;
  for (let i = 0; i < 28; i++) {
    const d = (lo + hi) / 2;
    camera.position.copy(center).addScaledVector(dir, d);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const fits = corners.every(c => {
      const p = c.clone().project(camera);
      return Math.abs(p.x) <= lim && Math.abs(p.y) <= lim && p.z < 1;
    });
    if (fits) hi = d; else lo = d;
  }
  camera.position.copy(center).addScaledVector(dir, hi);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return { center, distance: hi };
}

// ---------- кадры ----------
// region: "board" или список слотов; az/el в градусах; dof: фокус на слоте
export const SHOTS = {
  hero:  { region: "board", az: -26, el: 31, fov: 24, margin: 0.03 },
  macro: { region: [20, 26, 32, 38, 27, 33, 39, 45], az: -16, el: 17, fov: 20, margin: 0.0, pad: 0.1, dof: { slot: 32, aperture: 0.0028, maxblur: 0.009 } },
  ramp:  { region: [8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 9, 15, 21, 27, 33, 39, 45, 51, 57, 63, 10, 16, 22, 28, 34, 40, 46, 52, 58, 64], az: -24, el: 34, fov: 22, margin: 0.02, pad: 0.15, dof: { slot: 33, aperture: 0.0016, maxblur: 0.006 } },
  miss:  { region: [32, 38, 27, 33, 39, 45, 34, 28, 40], az: 14, el: 19, fov: 20, margin: 0.0, pad: 0.12, dof: { slot: 45, aperture: 0.0026, maxblur: 0.009 } },
  end:   { region: "board", az: 24, el: 17, fov: 22, margin: 0.02, dof: { slot: 35, aperture: 0.0012, maxblur: 0.005 } },
  cover: { region: [20, 26, 32, 38, 27, 33, 39, 45, 21], az: -18, el: 22, fov: 20, margin: -0.08, pad: 0.05, dof: { slot: 32, aperture: 0.0030, maxblur: 0.01 } },
  live:  { region: "board", az: -14, el: 44, fov: 22, margin: 0.03 },
};

function makePipeline(renderer, scene, camera) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.008 });
  bokeh.enabled = false;
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return { composer, bokeh, bloom };
}

function paperColor(el) {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  ctx.fillStyle = getComputedStyle(el).getPropertyValue("--color-paper").trim() || "#0c0e0d";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(`rgb(${r},${g},${b})`);
}

function aimShot(kb, camera, pipe, shot, aspect) {
  camera.aspect = aspect;
  camera.fov = shot.fov;
  camera.near = 0.3;
  camera.far = 400;
  camera.updateProjectionMatrix();
  const box = kb.box(shot.region, shot.pad);
  fitCamera(camera, box, shot.az, shot.el, shot.margin);
  if (shot.dof) {
    const o = kb.keys.get(shot.dof.slot);
    const focusPoint = new THREE.Vector3(o.k.u, 0.7, -o.k.v);
    pipe.bokeh.enabled = true;
    pipe.bokeh.uniforms.focus.value = camera.position.distanceTo(focusPoint);
    pipe.bokeh.uniforms.aperture.value = shot.dof.aperture;
    pipe.bokeh.uniforms.maxblur.value = shot.dof.maxblur;
    pipe.bokeh.uniforms.nearClip.value = camera.near;
    pipe.bokeh.uniforms.farClip.value = camera.far;
  } else {
    pipe.bokeh.enabled = false;
  }
}

// Один невидимый рендерер рисует кадры по очереди и копирует их в канвасы слайдов.
export class Stills {
  constructor(root = document.documentElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.kb = new Keyboard(this.renderer);
    this.renderer.setClearColor(paperColor(root), 1);
    this.camera = new THREE.PerspectiveCamera(24, 1.6, 0.3, 400);
    this.pipe = makePipeline(this.renderer, this.kb.scene, this.camera);
    this.pipe.composer.setPixelRatio(1);
    this.queue = Promise.resolve();
  }

  render(canvas, shotName, { lit = [], pressed = null } = {}) {
    this.queue = this.queue.then(() => new Promise(resolve => {
      requestAnimationFrame(() => {
        const shot = SHOTS[shotName];
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = Math.max(2, Math.min(3840, Math.round(rect.width * dpr)));
        const H = Math.max(2, Math.min(3840, Math.round(rect.height * dpr)));
        this.renderer.setSize(W, H, false);
        this.pipe.composer.setSize(W, H);
        this.kb.setLit(lit, { pressed, instant: true });
        aimShot(this.kb, this.camera, this.pipe, shot, W / H);
        this.pipe.composer.render();
        canvas.width = W;
        canvas.height = H;
        canvas.getContext("2d").drawImage(this.renderer.domElement, 0, 0, W, H);
        canvas.dataset.rendered = "1";
        resolve();
      });
    }));
    return this.queue;
  }
}

// Живая сцена для стенда: свой канвас, вращение мышью в пределах, рисуем только когда что-то меняется.
export class LiveView {
  constructor(canvas, { reduced = false } = {}) {
    this.canvas = canvas;
    this.reduced = reduced;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.kb = new Keyboard(this.renderer);
    this.renderer.setClearColor(paperColor(document.documentElement), 1);
    this.camera = new THREE.PerspectiveCamera(22, 1.6, 0.3, 400);
    this.pipe = makePipeline(this.renderer, this.kb.scene, this.camera);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = !reduced;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.5;
    this.controls.addEventListener("change", () => this.kick());

    this.frame = this.frame.bind(this);
    this.running = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.pipe.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.pipe.composer.setSize(r.width, r.height);
    aimShot(this.kb, this.camera, this.pipe, SHOTS.live, r.width / r.height);
    const box = this.kb.box("board");
    const c = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(c);
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.update();
    const polar = this.controls.getPolarAngle();
    const azim = this.controls.getAzimuthalAngle();
    this.controls.minPolarAngle = Math.max(0.2, polar - 0.5);
    this.controls.maxPolarAngle = Math.min(1.45, polar + 0.35);
    this.controls.minAzimuthAngle = azim - 0.7;
    this.controls.maxAzimuthAngle = azim + 0.7;
    this.controls.update();
    this.kick();
  }

  setLit(lit) { this.kb.setLit(lit, { instant: this.reduced }); this.kick(); }
  press(slot) { this.kb.press(slot); this.kick(); }

  kick() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    const busyKeys = this.kb.update(now, this.reduced);
    const busyCtl = this.controls.update();
    this.pipe.composer.render();
    if (busyKeys || busyCtl) requestAnimationFrame(this.frame);
    else this.running = false;
  }
}
