/* BIKA GAME — Rocket Crash V1
 * PixiJS v8 WebGL scene: sharp rocket, neon flight curve, starfield,
 * particles and crash burst. No emoji/low-resolution artwork.
 */
const PIXI_URL = 'https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.mjs';

export async function createBikaRocketScene(container, options = {}) {
  if (!container) throw new Error('Rocket scene container not found');
  const PIXI = await import(PIXI_URL);
  const app = new PIXI.Application();

  await app.init({
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5),
    preference: 'webgl',
    powerPreference: 'high-performance',
    clearBeforeRender: true
  });

  container.innerHTML = '';
  container.appendChild(app.canvas);
  app.canvas.className = 'rocket-pixi-canvas';
  app.canvas.setAttribute('aria-hidden', 'true');

  const root = new PIXI.Container();
  const bg = new PIXI.Container();
  const graphLayer = new PIXI.Container();
  const particleLayer = new PIXI.Container();
  const rocketLayer = new PIXI.Container();
  const fxLayer = new PIXI.Container();
  root.addChild(bg, graphLayer, particleLayer, rocketLayer, fxLayer);
  app.stage.addChild(root);

  let width = 800;
  let height = 430;
  let state = 'betting';
  let progress = 0.04;
  let multiplier = 1;
  let frame = 0;
  let destroyed = false;
  let crashBurst = 0;
  let resizeObserver = null;

  const stars = [];
  const exhaust = [];
  const rocket = new PIXI.Container();
  rocketLayer.addChild(rocket);

  function color(hex) { return Number.parseInt(hex.replace('#',''), 16); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function point(t) {
    const x0 = width * 0.075;
    const y0 = height * 0.86;
    const x1 = width * 0.86;
    const y1 = height * 0.15;
    const cx = width * 0.48;
    const cy = height * 0.63;
    const u = clamp(t,0,1);
    const inv = 1-u;
    return {
      x: inv*inv*x0 + 2*inv*u*cx + u*u*x1,
      y: inv*inv*y0 + 2*inv*u*cy + u*u*y1
    };
  }

  function rebuildBackground() {
    bg.removeChildren();
    const base = new PIXI.Graphics()
      .rect(0,0,width,height)
      .fill({ color:0x030815, alpha:0.98 });
    bg.addChild(base);

    const nebulae = [
      {x:0.18,y:0.78,r:0.32,c:0x0d61d8,a:0.10},
      {x:0.80,y:0.18,r:0.28,c:0x9b26ff,a:0.10},
      {x:0.56,y:0.46,r:0.30,c:0x1646a8,a:0.08},
      {x:0.82,y:0.70,r:0.25,c:0xff2baf,a:0.07}
    ];
    nebulae.forEach(n=>{
      bg.addChild(new PIXI.Graphics().circle(width*n.x,height*n.y,Math.max(28,width*n.r)).fill({color:n.c,alpha:n.a}));
    });

    // Sparse space field with drifting stars; no chart grid in the reference-style scene.
    const starLayer = new PIXI.Container();
    bg.addChild(starLayer);
    const total = Math.round(clamp(width*height/3600, 48, 130));
    stars.length = 0;
    for(let i=0;i<total;i++){
      const radius = Math.random()*1.45+0.35;
      const s = new PIXI.Graphics().circle(0,0,radius).fill({
        color:[0x9defff,0xffffff,0xb78bff,0xff9ddb][i%4],
        alpha:0.22+Math.random()*0.65
      });
      s.x=Math.random()*width;
      s.y=Math.random()*height*0.95;
      s.userData={phase:Math.random()*Math.PI*2,speed:0.5+Math.random()*1.7};
      starLayer.addChild(s);
      stars.push(s);
    }

  }

  function buildGraph() {
    graphLayer.removeChildren();
    // One restrained neon flight trail, revealed only as the server-backed
    // round progresses. The path is visual-only and never controls outcomes.
    const glow = new PIXI.Graphics();
    const crisp = new PIXI.Graphics();
    const pts = [];
    for(let i=0;i<=60;i++) pts.push(point(i/60));
    glow.moveTo(pts[0].x,pts[0].y);
    crisp.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>{glow.lineTo(p.x,p.y);crisp.lineTo(p.x,p.y);});
    glow.stroke({color:0xff42be,width:12,alpha:0.12});
    graphLayer.addChild(glow);
    const cyanGlow = new PIXI.Graphics();
    cyanGlow.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>cyanGlow.lineTo(p.x,p.y));
    cyanGlow.stroke({color:0x3be7ff,width:7,alpha:0.12});
    graphLayer.addChild(cyanGlow);
    const crispTrail = new PIXI.Graphics();
    crispTrail.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>crispTrail.lineTo(p.x,p.y));
    crispTrail.stroke({color:0x83f1ff,width:2.4,alpha:0.82});
    graphLayer.addChild(crispTrail);
    const origin = pts[0];
    graphLayer.addChild(new PIXI.Graphics().circle(origin.x,origin.y,5).fill({color:0x54e8ff,alpha:0.72}));
    graphLayer.children.forEach((layer)=>{ layer.alpha = progress; });
  }

  function addFlame() {
    const flameGlow = new PIXI.Graphics()
      .poly([-58,-12,-112,0,-58,12,-28,0])
      .fill({color:0xff5a2d,alpha:0.26});
    const flame = new PIXI.Graphics()
      .poly([-40,-8,-86,0,-40,8,-12,0])
      .fill({color:0xffde57,alpha:0.98});
    const core = new PIXI.Graphics()
      .poly([-31,-4,-64,0,-31,4,-9,0])
      .fill({color:0xffffff,alpha:0.98});
    rocket.addChild(flameGlow,flame,core);
  }

  function buildRocket() {
    rocket.removeChildren();
    rocket.pivot.set(0,0);
    const glow = new PIXI.Graphics()
      .ellipse(0,0,64,27)
      .fill({color:0xff3fae,alpha:0.10});
    rocket.addChild(glow);

    const flameLayer = new PIXI.Container();
    rocket.addChild(flameLayer);
    flameLayer.x=-44;
    addFlame();

    const finBack = new PIXI.Graphics()
      .poly([22,10,50,28,20,33,6,13])
      .fill({color:0xff365b,alpha:1})
      .stroke({width:2,color:0xff6885,alpha:0.5});
    rocket.addChild(finBack);

    const body = new PIXI.Graphics()
      .ellipse(0,0,56,30)
      .fill({color:0xe9f3f9})
      .stroke({width:2,color:0xffffff,alpha:0.75});
    body.scale.x=1.24;
    rocket.addChild(body);

    const bodyShade = new PIXI.Graphics()
      .ellipse(5,5,49,24)
      .fill({color:0x586e80,alpha:0.40});
    bodyShade.scale.x=1.20;
    rocket.addChild(bodyShade);

    const nose = new PIXI.Graphics()
      .poly([61,0,36,-12,36,12])
      .fill({color:0xffffff,alpha:0.97});
    rocket.addChild(nose);

    const windowOuter = new PIXI.Graphics()
      .circle(23,-2,12)
      .fill({color:0x142749,alpha:1})
      .stroke({width:2,color:0x9eeeff,alpha:0.8});
    rocket.addChild(windowOuter);
    const windowInner = new PIXI.Graphics()
      .circle(23,-2,7)
      .fill({color:0x35c9ff,alpha:0.92});
    rocket.addChild(windowInner);
    const windowShine = new PIXI.Graphics()
      .circle(20,-6,3)
      .fill({color:0xffffff,alpha:0.95});
    rocket.addChild(windowShine);

    const finFront = new PIXI.Graphics()
      .poly([5,-16,29,-36,37,-14,17,-5])
      .fill({color:0xff3d70,alpha:1})
      .stroke({width:2,color:0xff9caf,alpha:0.55});
    rocket.addChild(finFront);

    const finBottom = new PIXI.Graphics()
      .poly([5,16,29,35,36,14,17,5])
      .fill({color:0xd92d62,alpha:0.92});
    rocket.addChild(finBottom);

    const noseGlow = new PIXI.Graphics()
      .circle(62,0,5.5)
      .fill({color:0xff4fc7,alpha:0.8});
    rocket.addChild(noseGlow);

    for(let i=0;i<8;i++){
      const p=new PIXI.Graphics().circle(0,0,Math.random()*3+1).fill({
        color:[0xff6a2e,0xffd55a,0x67edff][i%3],
        alpha:0.78
      });
      p.userData={phase:Math.random()*Math.PI*2,seed:Math.random()};
      particleLayer.addChild(p);
      exhaust.push(p);
    }
  }

  function updateRocket() {
    const p=point(progress);
    rocket.position.set(p.x,p.y);
    rocket.rotation=-0.55;
    rocket.scale.set(clamp(width/500,0.90,1.45));
    const pulse=1+Math.sin(frame*0.15)*0.025;
    rocket.alpha = state==='crashed' ? 0.35 : 1;
    rocket.scale.x*=pulse;
    rocket.scale.y*=pulse;
  }

  function updateParticles() {
    stars.forEach(s=>{
      const u=s.userData;
      s.alpha=0.35+0.35*Math.sin(frame*0.035*u.speed+u.phase);
    });
    const p=point(progress);
    exhaust.forEach((s,i)=>{
      const u=s.userData;
      const t=(frame*0.045*u.seed + u.phase) % 1;
      const spread=(1-t)*16;
      s.x=p.x-30-t*55+Math.sin(frame*0.08+u.phase)*spread;
      s.y=p.y+Math.sin(frame*0.06+u.phase)*spread;
      s.alpha=state==='running' ? (1-t)*0.9 : 0.15;
      s.scale.set((1-t)*1.15+0.25);
    });
  }

  function spawnCrashBurst() {
    fxLayer.removeChildren();
    crashBurst=1;
    for(let i=0;i<26;i++){
      const q=new PIXI.Graphics().circle(0,0,Math.random()*4+1.4).fill({
        color:[0xff3d72,0xffc64b,0x63ecff,0xb64cff][i%4],
        alpha:0.92
      });
      q.x=rocket.x;q.y=rocket.y;
      q.userData={vx:(Math.random()*2-1)*7,vy:(Math.random()*2-1)*7,life:0};
      fxLayer.addChild(q);
    }
  }

  function updateCrashBurst(){
    if(!crashBurst) return;
    fxLayer.children.forEach(q=>{
      const u=q.userData; u.life+=0.035;
      q.x+=u.vx;q.y+=u.vy;u.vx*=0.975;u.vy*=0.975;
      q.alpha=Math.max(0,1-u.life);q.scale.set(Math.max(0.12,1-u.life));
    });
    crashBurst=Math.max(0,crashBurst-0.035);
  }

  function resize(){
    const r=container.getBoundingClientRect();
    width=Math.max(320,r.width||320);
    height=Math.max(300,r.height||300);
    rebuildBackground();
    buildGraph();
    updateRocket();
    app.renderer.resize(width,height);
  }

  function setFrame(nextProgress,nextMultiplier,nextState){
    progress=clamp(Number(nextProgress)||0.04,0.02,1);
    multiplier=Math.max(1,Number(nextMultiplier)||1);
    const next=String(nextState||state);
    if(next!==state && next==='crashed') spawnCrashBurst();
    state=next;
    updateRocket();
  }

  app.ticker.add(()=>{
    if(destroyed) return;
    frame+=1;
    updateParticles();
    updateRocket();
    updateCrashBurst();
  });

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  buildRocket();

  return {
    setFrame(nextProgress,nextMultiplier,nextState){ setFrame(nextProgress,nextMultiplier,nextState); },
    resize(){ resize(); },
    destroy(){
      destroyed=true;
      resizeObserver?.disconnect();
      app.destroy(true,{children:true,texture:true,textureSource:true});
    }
  };
}
