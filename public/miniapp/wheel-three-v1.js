/* BIKA GAME — Three.js Lucky Wheel V1
   Premium 3D wheel renderer for the Telegram Mini App.
   Three.js is pinned to an exact version for deterministic browser loading.
*/
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js';

export async function createBikaWheel3D(container, segments, options = {}) {
  const THREE = await import(THREE_URL);
  const state = createScene(THREE, container, segments, options);
  return {
    spinTo(degrees, duration = 5200) { state.spinTo(degrees, duration); },
    refresh(nextSegments) { state.refresh(nextSegments); },
    resize() { state.resize(); },
    destroy() { state.destroy(); }
  };
}

function createScene(THREE, container, inputSegments, options) {
  if (!container) throw new Error('Wheel container not found');
  container.innerHTML = '';
  container.classList.add('wheel-3d-host');

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  camera.position.set(0, 0.72, 8.2);
  camera.lookAt(0, 0.05, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
  renderer.setSize(100, 100, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = false;
  renderer.domElement.className = 'bika-wheel3d-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.pointerEvents = 'none';
  container.appendChild(renderer.domElement);

  const root = new THREE.Group();
  root.rotation.x = -0.045;
  root.rotation.y = 0.012;
  scene.add(root);

  const wheel = new THREE.Group();
  root.add(wheel);

  // High quality materials.
  const gold = new THREE.MeshStandardMaterial({
    color: 0xffcf55, metalness: 0.92, roughness: 0.22
  });
  const goldBright = new THREE.MeshStandardMaterial({
    color: 0xffe89b, metalness: 0.9, roughness: 0.18,
    emissive: 0x5a3700, emissiveIntensity: 0.28
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x12182b, metalness: 0.9, roughness: 0.23
  });
  const hubDark = new THREE.MeshStandardMaterial({
    color: 0x080d1d, metalness: 0.84, roughness: 0.20
  });

  const backing = new THREE.Mesh(
    new THREE.CylinderGeometry(2.88, 2.98, 0.30, 96),
    darkMetal
  );
  backing.rotation.x = Math.PI / 2;
  backing.position.z = -0.11;
  wheel.add(backing);

  const outerRim = new THREE.Mesh(new THREE.TorusGeometry(2.94, 0.13, 20, 128), gold);
  wheel.add(outerRim);

  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.045, 12, 96), goldBright);
  innerRim.position.z = 0.17;
  wheel.add(innerRim);

  const innerTrack = new THREE.Mesh(
    new THREE.TorusGeometry(2.28, 0.022, 10, 96),
    new THREE.MeshStandardMaterial({
      color: 0xc7d2ff, metalness: 0.75, roughness: 0.28,
      emissive: 0x233b7c, emissiveIntensity: 0.22
    })
  );
  innerTrack.position.z = 0.18;
  wheel.add(innerTrack);

  const segmentGroup = new THREE.Group();
  wheel.add(segmentGroup);

  const labelGroup = new THREE.Group();
  wheel.add(labelGroup);

  const leds = [];
  const ledColors = [0xfff4ac,0x58efff,0xff6edc,0xfff4ac];

  const ledGeo = new THREE.SphereGeometry(0.052, 10, 10);
  const ledRadius = 3.02;
  for (let i = 0; i < 28; i += 1) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 28;
    const mat = new THREE.MeshStandardMaterial({
      color: ledColors[i % ledColors.length],
      emissive: ledColors[i % ledColors.length],
      emissiveIntensity: 1.25,
      metalness: 0.15,
      roughness: 0.2
    });
    const led = new THREE.Mesh(ledGeo, mat);
    led.position.set(Math.cos(a) * ledRadius, Math.sin(a) * ledRadius, 0.24);
    led.userData.phase = i * 0.19;
    wheel.add(led);
    leds.push(led);
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.94, 0.34, 72), goldBright);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.23;
  wheel.add(hub);

  const hubInner = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.73, 0.28, 72), hubDark);
  hubInner.rotation.x = Math.PI / 2;
  hubInner.position.z = 0.42;
  wheel.add(hubInner);

  const crown = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.16, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffeea9, metalness: 0.95, roughness: 0.14,
      emissive: 0x8e5900, emissiveIntensity: 0.45
    })
  );
  crown.position.set(0, 0.27, 0.47);
  crown.rotation.z = Math.PI / 4;
  wheel.add(crown);

  // Floating gold chips for the surrounding depth.
  const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.035, 24);
  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xffc43b, metalness: 0.96, roughness: 0.18,
    emissive: 0x553000, emissiveIntensity: 0.25
  });
  const coins = [];
  for (let i = 0; i < 10; i += 1) {
    const a = i / 10 * Math.PI * 2 + 0.24;
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.rotation.x = Math.PI / 2;
    coin.position.set(Math.cos(a) * (3.25 + (i % 2) * 0.10), Math.sin(a) * (3.25 + (i % 2) * 0.10), 0.28 + (i % 3) * 0.035);
    coin.userData.spin = 0.006 + (i % 3) * 0.002;
    coin.userData.phase = i * 0.34;
    scene.add(coin);
    coins.push(coin);
  }

  // Premium light rig.
  scene.add(new THREE.HemisphereLight(0x9aa7ff, 0x03040a, 1.25));
  const key = new THREE.DirectionalLight(0xffe7a3, 3.2);
  key.position.set(2.5, 3.8, 6.5);
  scene.add(key);
  const cyan = new THREE.PointLight(0x2ee9ff, 18, 8);
  cyan.position.set(-3.6, 1.8, 4.5);
  scene.add(cyan);
  const pink = new THREE.PointLight(0xff2db5, 14, 7);
  pink.position.set(3.6, 0.6, 3.8);
  scene.add(pink);
  const goldGlow = new THREE.PointLight(0xffcf55, 13, 6);
  goldGlow.position.set(0, -2.5, 4.0);
  scene.add(goldGlow);

  let segments = Array.isArray(inputSegments) ? inputSegments.slice() : [];
  let built = [];
  let labels = [];
  let destroyed = false;
  let raf = 0;
  let startTime = performance.now();
  let lastFrame = startTime;
  let baseRotation = 0;
  let spin = null;
  let pointerX = 0;
  let pointerY = 0;

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? String(value) : fallback;
  }

  function makeLabelTexture(text, color, jackpot = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 170;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (jackpot) {
      ctx.shadowColor = '#fff0a1';
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#fff0a1';
      ctx.font = '900 34px Inter, system-ui, sans-serif';
      ctx.fillText('♛ JACKPOT', 210, 58);
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 26px Inter, system-ui, sans-serif';
      ctx.fillText(String(text || ''), 210, 112);
    } else {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff';
      ctx.font = '900 48px Inter, system-ui, sans-serif';
      ctx.fillText(String(text || ''), 210, 86);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const material = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(jackpot ? 1.50 : 1.08, jackpot ? 0.61 : 0.44, 1);
    return sprite;
  }

  function makeSegmentShape(start, end, radius = 2.72) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    const steps = 14;
    shape.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
    for (let i = 1; i <= steps; i += 1) {
      const a = start + (end - start) * (i / steps);
      shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    }
    shape.lineTo(0, 0);
    return shape;
  }

  function build(nextSegments) {
    segments = Array.isArray(nextSegments) ? nextSegments.slice() : [];
    for (const x of built) {
      segmentGroup.remove(x.mesh);
      x.mesh.geometry.dispose();
      x.mesh.material.dispose();
    }
    for (const x of labels) {
      labelGroup.remove(x.sprite);
      x.sprite.material.map?.dispose();
      x.sprite.material.dispose();
    }
    built = [];
    labels = [];

    const count = Math.max(1, segments.length);
    const step = Math.PI * 2 / count;
    const palette = ['#ff3f73','#ff5d3b','#ffd158','#58e64f','#15cfc7','#229be8','#5363ff','#9347ff','#d83bc6','#f24970'];

    segments.forEach((s, i) => {
      const start = Math.PI / 2 + i * step;
      const end = start + step;
      const color = safeColor(s.color, palette[i % palette.length]);
      const shape = makeSegmentShape(start + 0.008, end - 0.008);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.25,
        bevelEnabled: true,
        bevelThickness: 0.035,
        bevelSize: 0.025,
        bevelSegments: 2,
        curveSegments: 3
      });
      geometry.translate(0, 0, 0.02);
      const material = new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.38,
        roughness: 0.22,
        clearcoat: 0.72,
        clearcoatRoughness: 0.18,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.055
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      segmentGroup.add(mesh);
      built.push({ mesh });

      const mid = start + step / 2;
      const labelRadius = count <= 10 ? 1.77 : 1.92;
      const sprite = makeLabelTexture(String(s.label || ''), color, /jack/i.test(String(s.label || '')));
      sprite.position.set(Math.cos(mid) * labelRadius, Math.sin(mid) * labelRadius, 0.38);
      sprite.material.depthTest = false;
      labelGroup.add(sprite);
      labels.push({ sprite });
    });
  }

  function spinTo(degrees, duration) {
    const target = THREE.MathUtils.degToRad(Number(degrees || 0));
    const current = baseRotation;
    const twoPi = Math.PI * 2;
    let delta = target - current;
    if (delta < 0) delta += twoPi;
    // Always keep a clean, cinematic multi-turn motion.
    if (delta < twoPi * 0.35) delta += twoPi;
    const turns = 5.5 + (Math.abs(Number(degrees || 0)) % 2) * 0.05;
    spin = {
      from: current,
      to: target + twoPi * Math.floor(turns),
      started: performance.now(),
      duration: Math.max(2600, Number(duration || 5200))
    };
    // Preserve the requested exact final orientation.
    spin.to = current + Math.max(delta, twoPi * 5.3);
  }

  function onPointerMove(e) {
    const r = container.getBoundingClientRect();
    pointerX = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
    pointerY = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.9 ? 30 : aspect > 1.25 ? 24 : 27;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function tick(now) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (spin) {
      const p = Math.min(1, (now - spin.started) / spin.duration);
      const e = 1 - Math.pow(1 - p, 5);
      baseRotation = THREE.MathUtils.lerp(spin.from, spin.to, e);
      wheel.rotation.z = baseRotation;
      root.rotation.y = 0.012 + pointerX * 0.032;
      root.rotation.x = -0.045 - pointerY * 0.018;
      if (p >= 1) {
        baseRotation = spin.to % (Math.PI * 2);
        wheel.rotation.z = baseRotation;
        spin = null;
      }
    } else {
      wheel.rotation.z = baseRotation;
      root.rotation.y += (0.012 + pointerX * 0.032 - root.rotation.y) * Math.min(1, dt * 3.5);
      root.rotation.x += (-0.045 - pointerY * 0.018 - root.rotation.x) * Math.min(1, dt * 3.5);
    }

    const t = now * 0.001;
    leds.forEach((led, i) => {
      const pulse = 0.66 + 0.55 * (0.5 + 0.5 * Math.sin(t * 5.4 + led.userData.phase));
      led.material.emissiveIntensity = pulse * (spin ? 1.35 : 1);
      led.scale.setScalar(0.92 + pulse * 0.12);
    });
    coins.forEach((coin, i) => {
      coin.rotation.z += coin.userData.spin * (spin ? 2.4 : 1);
      coin.position.z = 0.27 + Math.sin(t * 1.5 + coin.userData.phase) * 0.045;
      coin.position.y += Math.sin(t * 0.9 + coin.userData.phase) * 0.0008;
    });

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  function refresh(nextSegments) {
    build(nextSegments);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    container.removeEventListener('pointermove', onPointerMove);
    renderer.dispose();
    renderer.domElement.remove();
  }

  build(segments);
  resize();
  window.addEventListener('resize', resize, { passive: true });
  container.addEventListener('pointermove', onPointerMove, { passive: true });
  raf = requestAnimationFrame(tick);

  return { spinTo, refresh, resize, destroy };
}
