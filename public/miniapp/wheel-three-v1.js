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

  const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
  camera.position.set(0, 0, 8.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
  renderer.setSize(100, 100, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
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

  // Dark circular stage plates: these stay circular (never a gray canvas rectangle)
  // and give the transparent WebGL canvas a premium floating surface.
  const stageGlow = new THREE.Mesh(
    new THREE.CircleGeometry(3.48, 128),
    new THREE.MeshBasicMaterial({
      color: 0x22324c,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  stageGlow.position.z = -0.55;
  wheel.add(stageGlow);

  const stagePlate = new THREE.Mesh(
    new THREE.CircleGeometry(3.30, 128),
    new THREE.MeshStandardMaterial({
      color: 0x081224,
      metalness: 0.68,
      roughness: 0.34,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    })
  );
  stagePlate.position.z = -0.45;
  wheel.add(stagePlate);

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
    new THREE.TorusGeometry(2.34, 0.028, 12, 112),
    new THREE.MeshStandardMaterial({
      color: 0xc7d2ff, metalness: 0.75, roughness: 0.28,
      emissive: 0x233b7c, emissiveIntensity: 0.22
    })
  );
  innerTrack.position.z = 0.34;
  wheel.add(innerTrack);

  const innerGlow = new THREE.Mesh(
    new THREE.TorusGeometry(2.52, 0.035, 10, 112),
    new THREE.MeshBasicMaterial({
      color: 0x58eaff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  innerGlow.position.z = 0.31;
  wheel.add(innerGlow);

  const segmentGroup = new THREE.Group();
  wheel.add(segmentGroup);

  const labelGroup = new THREE.Group();
  wheel.add(labelGroup);

  // Jewel-like radial separators: these catch the key light and give every
  // slice a crisp, manufactured 3D edge instead of a flat CSS-pie look.
  const dividerGroup = new THREE.Group();
  wheel.add(dividerGroup);
  const dividerMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffd86a,
    metalness: 0.96,
    roughness: 0.16,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    emissive: 0x5a2e00,
    emissiveIntensity: 0.22
  });

  const gemColors = [0xff3fbf, 0x41e6ff, 0x7a57ff, 0xffd75a];
  const wheelGems = [];
  const ledColors = [0xfff4ac,0x58efff,0xff6edc,0xfff4ac];

  const ledGeo = new THREE.SphereGeometry(0.062, 12, 12);
  const ledRadius = 3.02;

  const countForDecor = Math.max(1, Array.isArray(inputSegments) ? inputSegments.length : 10);
  const decorStep = Math.PI * 2 / countForDecor;
  for (let i = 0; i < countForDecor; i += 1) {
    const angle = Math.PI / 2 + i * decorStep;
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 2.55, 0.065),
      dividerMaterial
    );
    divider.position.set(Math.cos(angle) * 1.30, Math.sin(angle) * 1.30, 0.32);
    divider.rotation.z = angle - Math.PI / 2;
    dividerGroup.add(divider);
  }

  // Faceted "gem" studs around the premium rim.
  const gemGeo = new THREE.OctahedronGeometry(0.13, 1);
  for (let i = 0; i < 10; i += 1) {
    const angle = Math.PI / 2 + i * Math.PI * 2 / 10 + Math.PI / 10;
    const material = new THREE.MeshPhysicalMaterial({
      color: gemColors[i % gemColors.length],
      metalness: 0.48,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: gemColors[i % gemColors.length],
      emissiveIntensity: 0.38
    });
    const gem = new THREE.Mesh(gemGeo, material);
    gem.position.set(Math.cos(angle) * 2.83, Math.sin(angle) * 2.83, 0.36);
    gem.rotation.set(0.18, 0.28, angle);
    wheel.add(gem);
    wheelGems.push(gem);
  }
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

  // Small faceted gems float around the wheel like a game-show prize halo.
  const prizeGems = [];
  const prizeGemGeo = new THREE.OctahedronGeometry(0.17, 1);
  for (let i = 0; i < 6; i += 1) {
    const angle = i / 6 * Math.PI * 2 + 0.36;
    const material = new THREE.MeshPhysicalMaterial({
      color: gemColors[(i + 1) % gemColors.length],
      metalness: 0.42,
      roughness: 0.14,
      clearcoat: 0.95,
      emissive: gemColors[(i + 1) % gemColors.length],
      emissiveIntensity: 0.30
    });
    const gem = new THREE.Mesh(prizeGemGeo, material);
    gem.position.set(Math.cos(angle) * (3.45 + (i % 2) * 0.16), Math.sin(angle) * (3.45 + (i % 2) * 0.16), 0.10 + (i % 2) * 0.10);
    gem.userData.phase = i * 0.55;
    gem.userData.spin = 0.004 + (i % 3) * 0.001;
    scene.add(gem);
    prizeGems.push(gem);
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
      if (x.shadowMesh) {
        segmentGroup.remove(x.shadowMesh);
        x.shadowMesh.geometry.dispose();
        x.shadowMesh.material.dispose();
      }
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
        emissiveIntensity: 0.10,
        side: THREE.DoubleSide,
        flatShading: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      segmentGroup.add(mesh);

      // A slightly offset shadow duplicate makes the wheel read as a real 3D object
      // even on low-power mobile WebViews where specular highlights are subtle.
      const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x030713,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const shadowMesh = new THREE.Mesh(geometry.clone(), shadowMaterial);
      shadowMesh.position.z = -0.12;
      shadowMesh.scale.setScalar(1.008);
      segmentGroup.add(shadowMesh);
      built.push({ mesh, shadowMesh });

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
    const minTurns = 5.5;
    const minEnd = current + twoPi * minTurns;
    const laps = Math.ceil((minEnd - target) / twoPi);
    spin = {
      from: current,
      to: target + Math.max(0, laps) * twoPi,
      started: performance.now(),
      duration: Math.max(2600, Number(duration || 5200))
    };
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
    // Orthographic framing keeps the full circular wheel visible on Telegram's
    // narrow WebView instead of letting the perspective camera crop the rim.
    const fitRadius = 3.72;
    const halfHeight = Math.max(fitRadius, fitRadius / Math.max(0.45, aspect));
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.near = 0.1;
    camera.far = 100;
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
    wheelGems.forEach((gem, i) => {
      gem.rotation.x += 0.004 * (i % 2 ? -1 : 1);
      gem.rotation.y += 0.007;
      const pulse = 0.96 + Math.sin(t * 2.4 + i) * 0.05;
      gem.scale.setScalar(pulse);
    });
    prizeGems.forEach((gem) => {
      gem.rotation.x += gem.userData.spin * (spin ? 2.8 : 1);
      gem.rotation.y += 0.005;
      gem.position.z = 0.10 + Math.sin(t * 1.35 + gem.userData.phase) * 0.07;
    });

    // Explicit clear every frame prevents WebView backbuffer residue / gray canvases.
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
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
    dividerMaterial.dispose();
    gemGeo.dispose();
    wheelGems.forEach((gem) => gem.material.dispose());
    prizeGemGeo.dispose();
    prizeGems.forEach((gem) => gem.material.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  }

  build(segments);
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  resize();
  window.addEventListener('resize', resize, { passive: true });
  container.addEventListener('pointermove', onPointerMove, { passive: true });
  raf = requestAnimationFrame(tick);

  return { spinTo, refresh, resize, destroy };
}
