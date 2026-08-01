/* =========================================================================
   APEX RANGE — Tactical Training Simulator
   Single-file Three.js FPS shooting-range trainer.
   ========================================================================= */
(function(){
"use strict";

/* ---------------------------------------------------------------------
   0. UTIL
--------------------------------------------------------------------- */
function b64ToArrayBuffer(b64){
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function rand(a,b){ return a+Math.random()*(b-a); }
function $(id){ return document.getElementById(id); }

/* Safe audio wrapper: never throws, silently no-ops until real files exist */
const SoundBank = {
  cache:{},
  play(name, vol){
    try{
      let a = this.cache[name];
      if(!a){
        a = new Audio(name);
        a.volume = (vol!==undefined?vol:0.7);
        a.onerror = function(){ /* file not uploaded yet — ignore quietly */ };
        this.cache[name] = a;
      }
      const inst = a.cloneNode ? a.cloneNode(true) : a;
      inst.volume = (vol!==undefined?vol:0.7);
      const p = inst.play();
      if(p && p.catch) p.catch(function(){ /* autoplay/missing file — ignore */ });
    }catch(e){ /* never let audio break gameplay */ }
  }
};

/* ---------------------------------------------------------------------
   1. WEAPON CONFIG
   Position/rotation offsets are best-effort defaults for Sketchfab-style
   export orientation. Use the ` debug panel in-game to fine-tune per gun,
   then read the console-logged values back into these numbers.
--------------------------------------------------------------------- */
const WEAPONS = [
  {
    id:'pistol', name:'Makarov PM', type:'semi', asset:'pistol',
    damage:24, magSize:8, fireRateMs:230, reloadFallbackMs:1400,
    recoil:0.028, spread:0.006, price:'Sidearm',
    desc:'Compact semi-auto sidearm. Low recoil, tight groups at close range.',
    stats:{damage:35,firerate:45,accuracy:70,handling:90},
    offset:{pos:[0.26,-0.28,-0.55], rot:[0,0,0], scale:1.6},
    soundFire:'Makarov AUD.mp4', soundReload:'Makarov Reload AUD.mp4', soundEmpty:'Empty Click AUD.mp4'
  },
  {
    id:'smg', name:'Dual MAC-10', type:'auto', asset:'smg',
    damage:16, magSize:64, fireRateMs:70, reloadFallbackMs:2200,
    recoil:0.02, spread:0.02, price:'Close Quarters',
    desc:'Twin machine pistols. Devastating fire rate, wide spread — control your bursts.',
    stats:{damage:28,firerate:98,accuracy:35,handling:60},
    offset:{pos:[0.15,-0.32,-0.5], rot:[0,0,0], scale:1.0},
    soundFire:'MAC10 AUD.mp4', soundReload:'MAC10 Reload AUD.mp4', soundEmpty:'Empty Click AUD.mp4'
  },
  {
    id:'shotgun', name:'Remington 870', type:'pump', asset:'shotgun',
    damage:90, magSize:6, fireRateMs:850, reloadFallbackMs:1600,
    recoil:0.09, spread:0.05, pellets:6, price:'Heavy Hitter',
    desc:'Pump-action, devastating up close. Cycle the action between every shot.',
    stats:{damage:95,firerate:20,accuracy:40,handling:55},
    offset:{pos:[0.12,-0.24,-0.10], rot:[0,0,0], scale:1.16},
    soundFire:'Remington870 AUD.mp4', soundReload:'Remington870 Reload AUD.mp4', soundEmpty:'Empty Click AUD.mp4', soundPump:'Shotgun Pump AUD.mp4'
  },
  {
    id:'rifle', name:'M16A2', type:'burst', asset:'rifle',
    damage:30, magSize:30, fireRateMs:100, burstCount:3, burstGapMs:340, reloadFallbackMs:2000,
    recoil:0.032, spread:0.012, price:'Standard Issue',
    desc:'3-round burst service rifle. Balanced, disciplined, dependable.',
    stats:{damage:55,firerate:60,accuracy:72,handling:75},
    offset:{pos:[0.24,-0.26,-0.62], rot:[0,0,0], scale:1.3},
    soundFire:'M16 AUD.mp4', soundReload:'M16 Reload AUD.mp4', soundEmpty:'Empty Click AUD.mp4'
  },
  {
    id:'sniper', name:'L96A1', type:'bolt', asset:'sniper',
    damage:100, magSize:5, fireRateMs:1250, reloadFallbackMs:2400,
    recoil:0.13, spread:0.001, scoped:true, zoomFov:20, price:'Precision',
    desc:'Bolt-action, one shot at a time. Right-click to scope in for pinpoint precision.',
    stats:{damage:100,firerate:12,accuracy:98,handling:40},
    offset:{pos:[0.2,-0.24,-0.72], rot:[0,0,0], scale:1.25},
    soundFire:'L96A1 AUD.mp4', soundReload:'L96A1 Reload AUD.mp4', soundBolt:'Bolt Cycle AUD.mp4'
  }
];

/* ---------------------------------------------------------------------
   2. LEVEL CONFIG (progressive difficulty)
--------------------------------------------------------------------- */
const LANES_X = [-6.2,-3.7,-1.2,1.2,3.7,6.2];
const LEVELS = [
  { id:1, name:'Drill 01 — Fundamentals', desc:'Static targets, no clock. Learn your sight picture.',
    timeLimit:9999, targetCount:8, exposureMs:9999, spawnGapMs:1400, moving:false, simultaneous:1 },
  { id:2, name:'Drill 02 — Controlled Pairs', desc:'Static targets in pairs. 50 seconds on the clock.',
    timeLimit:50, targetCount:10, exposureMs:9999, spawnGapMs:900, moving:false, simultaneous:2 },
  { id:3, name:'Drill 03 — Against The Clock', desc:'Targets drop fast if not hit. Stay sharp.',
    timeLimit:45, targetCount:12, exposureMs:2600, spawnGapMs:1000, moving:false, simultaneous:1 },
  { id:4, name:'Drill 04 — Reaction Rush', desc:'Rapid random exposures across all lanes.',
    timeLimit:38, targetCount:14, exposureMs:1700, spawnGapMs:650, moving:false, simultaneous:2 },
  { id:5, name:'Drill 05 — Moving Targets', desc:'Targets sweep laterally. The ultimate test.',
    timeLimit:42, targetCount:14, exposureMs:2400, spawnGapMs:750, moving:true, simultaneous:2 },
];

/* ---------------------------------------------------------------------
   3. GLOBAL STATE
--------------------------------------------------------------------- */
const State = {
  selectedWeapon: WEAPONS[3].id,
  levelProgress: {1:0,2:0,3:0,4:0,5:0}, // stars per level (session only)
  unlocked: {1:true,2:false,3:false,4:false,5:false},
};

let renderer, scene, camera, clock;
let yawObject, pitchObject, weaponMount;
let pointerLocked = false;
let scoped = false;
let boundary = {xMin:-6.6,xMax:6.6,zMin:-6.6,zMax:2.6};
const keys = {};
let velocity = new THREE.Vector3();
let mouseSensitivity = 1.2;

let gunModels = {}; // id -> {scene, gltf}
let rangeModel = null;
let targetTemplate = null;
let assetsLoaded = false;

let currentWeapon = null;
let currentWeaponObj = null; // instanced THREE.Object3D in weaponMount
let ammoInMag = 0;
let isReloading = false;
let reloadEndsAt = 0;
let lastFireAt = 0;
let burstInProgress = false;
let pumpLocked = false;
let boltLocked = false;
let mouseDown = false;

let activeTargets = []; // {obj, alive, lane, spawnedAt, expiresAt, moveDir, box}
let levelRunning = false;
let levelConfig = null;
let levelStartAt = 0;
let levelStats = {hits:0, shotsFired:0, targetsShown:0, score:0};
let nextSpawnAt = 0;
let targetsSpawnedCount = 0;

let recoilPitch = 0, recoilYaw = 0, recoilKick = 0;
let bobPhase = 0;

const raycaster = new THREE.Raycaster();

/* ---------------------------------------------------------------------
   4. BOOT / ASSET LOADING
--------------------------------------------------------------------- */
function bootLog(msg, pct){
  $('bootLog').textContent = msg;
  $('bootBar').style.width = pct+'%';
}

function initThree(){
  const canvas = $('gamecanvas');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0f0c);
  scene.fog = new THREE.Fog(0x0d0f0c, 12, 34);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.05, 200);

  pitchObject = new THREE.Object3D();
  pitchObject.add(camera);
  yawObject = new THREE.Object3D();
  yawObject.position.set(0, 1.72, -5.4);
  yawObject.rotation.y = Math.PI; // face +Z, toward the target end
  yawObject.add(pitchObject);
  scene.add(yawObject);

  weaponMount = new THREE.Object3D();
  camera.add(weaponMount);

  // Lighting: hemi + key directional (sun through a window) + warm fill
  const hemi = new THREE.HemisphereLight(0xcfd9c8, 0x1a1a14, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2d8, 1.15);
  key.position.set(6,10,4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.0015;
  scene.add(key);
  const fill = new THREE.PointLight(0xffcf8a, 0.5, 20);
  fill.position.set(-4,3,3);
  scene.add(fill);
  const rimDown = new THREE.PointLight(0x4d6b6a, 0.35, 25);
  rimDown.position.set(0,2.2,-6);
  scene.add(rimDown);

  clock = new THREE.Clock();

  window.addEventListener('resize', onResize);
  onResize();
}

function onResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function loadAssets(cb){
  const loader = new THREE.GLTFLoader();
  if(typeof MeshoptDecoder !== 'undefined' && loader.setMeshoptDecoder){
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  const manifest = [
    ['range', ASSET_DATA.range],
    ['target', ASSET_DATA.target],
    ['pistol', ASSET_DATA.pistol],
    ['smg', ASSET_DATA.smg],
    ['shotgun', ASSET_DATA.shotgun],
    ['rifle', ASSET_DATA.rifle],
    ['sniper', ASSET_DATA.sniper],
  ];
  let done = 0;
  const total = manifest.length;

  function loadOne(idx){
    if(idx >= manifest.length){ cb(); return; }
    const key = manifest[idx][0];
    const b64 = manifest[idx][1];
    bootLog('loading '+key.toUpperCase()+'…', Math.round((done/total)*100));
    try{
      const buf = b64ToArrayBuffer(b64);
      loader.parse(buf, '', function(gltf){
        try{
          gltf.scene.traverse(function(o){
            if(o.isMesh){
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
        }catch(e){}
        if(key === 'range') rangeModel = gltf.scene;
        else if(key === 'target') targetTemplate = gltf;
        else gunModels[key] = gltf;
        done++;
        bootLog('loaded '+key.toUpperCase(), Math.round((done/total)*100));
        loadOne(idx+1);
      }, function(err){
        console.warn('Failed to parse asset', key, err);
        done++;
        loadOne(idx+1); // continue — never hard-fail the whole boot
      });
    }catch(e){
      console.warn('Asset decode error', key, e);
      done++;
      loadOne(idx+1);
    }
  }
  loadOne(0);
}

function buildScene(){
  if(rangeModel){
    rangeModel.position.set(0,0,0);
    scene.add(rangeModel);
  } else {
    // fallback floor if range failed to load, so game never breaks
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.MeshStandardMaterial({color:0x2a2f26}));
    floor.rotation.x = -Math.PI/2;
    floor.receiveShadow = true;
    scene.add(floor);
  }
}

/* ---------------------------------------------------------------------
   5. WEAPON HANDLING
--------------------------------------------------------------------- */
function equipWeapon(id){
  currentWeapon = WEAPONS.find(w=>w.id===id) || WEAPONS[0];
  // clear mount
  while(weaponMount.children.length) weaponMount.remove(weaponMount.children[0]);

  const src = gunModels[currentWeapon.asset];
  let obj;
  if(src && src.scene){
    obj = src.scene.clone(true);
  } else {
    // fallback placeholder box gun so the game never hard-errors
    obj = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.12,0.55), new THREE.MeshStandardMaterial({color:0x1c1c1c}));
  }
  const off = currentWeapon.offset;
  obj.position.set(off.pos[0], off.pos[1], off.pos[2]);
  obj.rotation.set(off.rot[0], off.rot[1], off.rot[2]);
  obj.scale.setScalar(off.scale);
  weaponMount.add(obj);
  currentWeaponObj = obj;

  // animation mixer (single baked clip used for reload)
  currentWeaponObj.userData.mixer = null;
  currentWeaponObj.userData.reloadAction = null;
  currentWeaponObj.userData.reloadDurationMs = currentWeapon.reloadFallbackMs;
  if(src && src.animations && src.animations.length){
    const mixer = new THREE.AnimationMixer(obj);
    const clip = src.animations[0];
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.loop = THREE.LoopOnce;
    currentWeaponObj.userData.mixer = mixer;
    currentWeaponObj.userData.reloadAction = action;
    currentWeaponObj.userData.reloadDurationMs = Math.max(600, clip.duration*1000);
  }

  ammoInMag = currentWeapon.magSize;
  isReloading = false;
  burstInProgress = false;
  pumpLocked = false;
  boltLocked = false;
  updateHudWeapon();
}

function startReload(){
  if(isReloading || ammoInMag === currentWeapon.magSize) return;
  isReloading = true;
  const dur = currentWeaponObj.userData.reloadDurationMs;
  reloadEndsAt = performance.now() + dur;
  SoundBank.play(currentWeapon.soundReload, 0.8);
  const action = currentWeaponObj.userData.reloadAction;
  if(action){
    action.reset();
    action.timeScale = action.getClip().duration>0 ? (action.getClip().duration*1000/dur) : 1;
    action.play();
  }
  $('reloadBar').classList.add('active');
  showCenterMsg('RELOADING', 400);
}

function finishReloadIfDue(now){
  if(isReloading){
    const rem = reloadEndsAt - now;
    const dur = currentWeaponObj.userData.reloadDurationMs;
    const pct = clamp(100 - (rem/dur*100), 0, 100);
    $('reloadBarFill').style.width = pct+'%';
    if(rem <= 0){
      isReloading = false;
      ammoInMag = currentWeapon.magSize;
      $('reloadBar').classList.remove('active');
      updateHudWeapon();
    }
  }
}

function canFireNow(now){
  if(isReloading) return false;
  if(currentWeapon.type==='pump' && pumpLocked) return false;
  if(currentWeapon.type==='bolt' && boltLocked) return false;
  if(now - lastFireAt < currentWeapon.fireRateMs) return false;
  return true;
}

function fireOnce(now){
  if(ammoInMag <= 0){
    SoundBank.play(currentWeapon.soundEmpty||'Empty Click AUD.mp4', 0.5);
    return;
  }
  ammoInMag--;
  lastFireAt = now;
  levelStats.shotsFired++;
  SoundBank.play(currentWeapon.soundFire, 0.9);
  applyRecoil();
  muzzleFlash();
  doHitscan();
  updateHudWeapon();

  if(currentWeapon.type==='pump'){
    pumpLocked = true;
    setTimeout(function(){ pumpLocked=false; SoundBank.play(currentWeapon.soundPump||'Shotgun Pump AUD.mp4',0.6); }, 420);
  }
  if(currentWeapon.type==='bolt'){
    boltLocked = true;
    setTimeout(function(){ boltLocked=false; SoundBank.play(currentWeapon.soundBolt||'Bolt Cycle AUD.mp4',0.6); }, 700);
  }
}

function tryFire(){
  const now = performance.now();
  if(!canFireNow(now)) return;

  if(currentWeapon.type==='burst'){
    if(burstInProgress) return;
    burstInProgress = true;
    let shots = 0;
    const gap = currentWeapon.burstGapMs;
    function nextShot(){
      if(shots >= currentWeapon.burstCount || ammoInMag<=0){ burstInProgress=false; return; }
      fireOnce(performance.now());
      shots++;
      if(shots < currentWeapon.burstCount && ammoInMag>0) setTimeout(nextShot, gap);
      else burstInProgress = false;
    }
    nextShot();
  } else {
    fireOnce(now);
  }
}

function applyRecoil(){
  recoilPitch += currentWeapon.recoil;
  recoilYaw += (Math.random()-0.5)*currentWeapon.recoil*0.4;
  recoilKick = Math.min(recoilKick + 0.08, 0.35);
}

function muzzleFlash(){
  const light = new THREE.PointLight(0xffc069, 3.2, 3.2, 2);
  light.position.set(0,0,-0.15);
  weaponMount.add(light);
  const geo = new THREE.PlaneGeometry(0.14,0.14);
  const tex = getFlashTexture();
  const mat = new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending});
  const spr = new THREE.Mesh(geo, mat);
  spr.position.set(0,0,-0.55);
  spr.rotation.z = Math.random()*Math.PI;
  if(currentWeaponObj) currentWeaponObj.add(spr);
  setTimeout(function(){
    weaponMount.remove(light);
    if(currentWeaponObj) currentWeaponObj.remove(spr);
  }, 50);

  // tracer
  spawnTracer();
}

let _flashTex = null;
function getFlashTexture(){
  if(_flashTex) return _flashTex;
  const c = document.createElement('canvas'); c.width=64; c.height=64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,240,200,1)');
  g.addColorStop(0.4,'rgba(255,180,80,0.9)');
  g.addColorStop(1,'rgba(255,120,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  _flashTex = new THREE.CanvasTexture(c);
  return _flashTex;
}

function spawnTracer(){
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const start = new THREE.Vector3();
  camera.getWorldPosition(start);
  start.addScaledVector(dir, 0.3);
  const end = start.clone().addScaledVector(dir, 40);
  const geo = new THREE.BufferGeometry().setFromPoints([start,end]);
  const mat = new THREE.LineBasicMaterial({color:0xfff2c0, transparent:true, opacity:0.55});
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  const t0 = performance.now();
  (function fade(){
    const t = (performance.now()-t0)/90;
    if(t>=1){ scene.remove(line); return; }
    mat.opacity = 0.55*(1-t);
    requestAnimationFrame(fade);
  })();
}

function doHitscan(){
  raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
  // apply spread
  const spread = currentWeapon.spread;
  if(spread>0){
    raycaster.ray.direction.x += rand(-spread,spread);
    raycaster.ray.direction.y += rand(-spread,spread);
    raycaster.ray.direction.normalize();
  }
  const meshes = [];
  activeTargets.forEach(function(t){ if(t.alive) meshes.push(t.hitMesh); });
  const hits = raycaster.intersectObjects(meshes, true);
  if(hits.length){
    let obj = hits[0].object;
    while(obj && !obj.userData.targetRef) obj = obj.parent;
    if(obj && obj.userData.targetRef){
      registerHit(obj.userData.targetRef);
    }
  }
}

/* ---------------------------------------------------------------------
   6. TARGETS
--------------------------------------------------------------------- */
function makeTargetInstance(){
  let obj;
  if(targetTemplate && targetTemplate.scene){
    obj = targetTemplate.scene.clone(true);
    obj.scale.setScalar(0.27);
  } else {
    obj = new THREE.Mesh(new THREE.BoxGeometry(0.9,1.8,0.15), new THREE.MeshStandardMaterial({color:0x3a3f33}));
  }
  obj.traverse(function(o){ if(o.isMesh){o.castShadow=true; o.receiveShadow=true;} });
  return obj;
}

function spawnTarget(){
  const laneIdx = Math.floor(rand(0, LANES_X.length));
  const x = LANES_X[laneIdx];
  const z = 7.6;
  const obj = makeTargetInstance();
  obj.position.set(x, -1.8, z); // starts hidden below "window"
  obj.userData.baseX = x;
  scene.add(obj);

  const hitMesh = obj; // use whole model as hit volume
  const ref = {
    obj, hitMesh, alive:false, lane:laneIdx,
    spawnedAt:performance.now(), expiresAt:0,
    moveDir: Math.random()<0.5?-1:1, baseX:x,
  };
  obj.userData.targetRef = ref;
  obj.traverse(function(o){ o.userData.targetRef = ref; });

  // pop-up animation
  const t0 = performance.now();
  const upY = 0;
  (function pop(){
    const t = clamp((performance.now()-t0)/280, 0, 1);
    obj.position.y = lerp(-1.8, upY, easeOutBack(t));
    if(t<1) requestAnimationFrame(pop);
    else { ref.alive = true; ref.expiresAt = performance.now() + levelConfig.exposureMs; }
  })();

  activeTargets.push(ref);
  levelStats.targetsShown++;
  updateHudCounters();
  return ref;
}

function easeOutBack(t){
  const c1=1.70158, c3=c1+1;
  return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
}

function dropTarget(ref, hit){
  if(!ref.alive) return;
  ref.alive = false;
  const t0 = performance.now();
  const startY = ref.obj.position.y;
  const startRotX = ref.obj.rotation.x;
  const targetRotX = hit ? -Math.PI/2 : ref.obj.rotation.x;
  (function fall(){
    const t = clamp((performance.now()-t0)/(hit?260:320), 0, 1);
    ref.obj.position.y = lerp(startY, -1.8, t*t);
    if(hit) ref.obj.rotation.x = lerp(startRotX, targetRotX, t);
    if(t<1) requestAnimationFrame(fall);
    else { scene.remove(ref.obj); const idx=activeTargets.indexOf(ref); if(idx>=0) activeTargets.splice(idx,1); }
  })();
}

function registerHit(ref){
  if(!ref.alive) return;
  levelStats.hits++;
  levelStats.score += currentWeapon.scoped ? 150 : 100;
  showHitmarker();
  SoundBank.play('Target Hit AUD.mp4', 0.7);
  dropTarget(ref, true);
  updateHudCounters();
}

function showHitmarker(){
  const el = $('hitmarker');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function updateTargets(dt, now){
  for(let i=activeTargets.length-1;i>=0;i--){
    const ref = activeTargets[i];
    if(!ref.alive) continue;
    if(levelConfig.moving){
      ref.obj.position.x = ref.baseX + Math.sin(now/1000*1.4 + ref.lane)*1.1*ref.moveDir;
    }
    if(now > ref.expiresAt){
      dropTarget(ref, false);
    }
  }
}

/* ---------------------------------------------------------------------
   7. LEVEL FLOW
--------------------------------------------------------------------- */
function startLevel(cfg){
  levelConfig = cfg;
  levelRunning = true;
  levelStartAt = performance.now();
  levelStats = {hits:0, shotsFired:0, targetsShown:0, score:0};
  targetsSpawnedCount = 0;
  nextSpawnAt = performance.now() + 400;
  activeTargets.forEach(function(r){ scene.remove(r.obj); });
  activeTargets = [];

  $('hudLevelName').textContent = cfg.name.toUpperCase();
  $('hud').classList.add('active');
  showScreen(null);
  updateHudCounters();
  showCenterMsg('BEGIN', 700);
}

function endLevel(){
  levelRunning = false;
  $('hud').classList.remove('active');
  const elapsed = (performance.now()-levelStartAt)/1000;
  const acc = levelStats.shotsFired>0 ? (levelStats.hits/levelStats.shotsFired*100) : 0;
  const completion = levelStats.targetsShown>0 ? (levelStats.hits/levelConfig.targetCount) : 0;
  let stars = 1;
  if(acc>=80 && completion>=0.9) stars=3;
  else if(acc>=55 && completion>=0.7) stars=2;
  if(levelStats.hits===0) stars=0;

  State.levelProgress[levelConfig.id] = Math.max(State.levelProgress[levelConfig.id]||0, stars);
  if(stars>0 && levelConfig.id < LEVELS.length){ State.unlocked[levelConfig.id+1] = true; }

  $('resTitle').textContent = levelConfig.name;
  $('resHits').textContent = levelStats.hits+'/'+levelConfig.targetCount;
  $('resAcc').textContent = acc.toFixed(0)+'%';
  $('resTime').textContent = elapsed.toFixed(1)+'s';
  $('resScore').textContent = levelStats.score;
  const starsEl = $('resStars');
  starsEl.innerHTML = '★★★'.split('').map(function(s,i){ return '<span style="color:'+(i<stars?'var(--amber)':'var(--line)')+'">★</span>'; }).join('');
  $('btnNextLevel').disabled = levelConfig.id >= LEVELS.length;
  showScreen('results');
  exitPointerLock();
}

function updateHudCounters(){
  $('hudHits').textContent = levelStats.hits;
  $('hudTotal').textContent = levelConfig?levelConfig.targetCount:0;
  const acc = levelStats.shotsFired>0? (levelStats.hits/levelStats.shotsFired*100):0;
  $('hudAcc').textContent = acc.toFixed(0)+'%';
  $('hudScore').textContent = levelStats.score;
}

function updateHudWeapon(){
  $('hudWeaponName').textContent = currentWeapon.name.toUpperCase();
  $('hudMag').textContent = ammoInMag;
}

function showCenterMsg(txt, ms){
  const el = $('centerMsg');
  el.textContent = txt;
  el.classList.add('show');
  setTimeout(function(){ el.classList.remove('show'); }, ms);
}

/* ---------------------------------------------------------------------
   8. PLAYER MOVEMENT / LOOK
--------------------------------------------------------------------- */
function requestPointerLock(){
  const el = $('gamecanvas');
  if(el.requestPointerLock) el.requestPointerLock();
}
function exitPointerLock(){
  if(document.pointerLockElement) document.exitPointerLock();
}

document.addEventListener('pointerlockchange', function(){
  pointerLocked = (document.pointerLockElement === $('gamecanvas'));
});

function onMouseMove(e){
  if(!pointerLocked || !levelRunning) return;
  const dx = e.movementX||0, dy = e.movementY||0;
  const s = 0.0022*mouseSensitivity;
  yawObject.rotation.y -= dx*s;
  pitchObject.rotation.x -= dy*s;
  pitchObject.rotation.x = clamp(pitchObject.rotation.x, -Math.PI/2+0.05, Math.PI/2-0.05);
}

function updateMovement(dt){
  const speed = 3.2;
  const accel = 22;
  const damping = Math.pow(0.0015, dt);

  let moveForward=0, moveRight=0;
  if(keys['KeyW']) moveForward += 1;
  if(keys['KeyS']) moveForward -= 1;
  if(keys['KeyD']) moveRight += 1;
  if(keys['KeyA']) moveRight -= 1;
  const len = Math.hypot(moveForward,moveRight);
  if(len>0){ moveForward/=len; moveRight/=len; }

  const yaw = yawObject.rotation.y;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const wish = new THREE.Vector3();
  wish.addScaledVector(forward, moveForward);
  wish.addScaledVector(right, moveRight);
  if(wish.lengthSq()>0) wish.normalize().multiplyScalar(speed);

  velocity.x = lerp(velocity.x, wish.x, 1-Math.pow(0.0008, dt));
  velocity.z = lerp(velocity.z, wish.z, 1-Math.pow(0.0008, dt));

  const nx = yawObject.position.x + velocity.x*dt;
  const nz = yawObject.position.z + velocity.z*dt;
  yawObject.position.x = clamp(nx, boundary.xMin, boundary.xMax);
  yawObject.position.z = clamp(nz, boundary.zMin, boundary.zMax);

  // head-bob
  const moving = Math.hypot(velocity.x,velocity.z) > 0.2;
  if(moving && levelRunning){
    bobPhase += dt*8;
    camera.position.y = Math.sin(bobPhase)*0.02;
    camera.position.x = Math.cos(bobPhase*0.5)*0.01;
  } else {
    camera.position.y = lerp(camera.position.y, 0, 0.1);
    camera.position.x = lerp(camera.position.x, 0, 0.1);
  }
}

function updateRecoilRecover(dt){
  recoilPitch = lerp(recoilPitch, 0, 1-Math.pow(0.001, dt));
  recoilYaw = lerp(recoilYaw, 0, 1-Math.pow(0.001, dt));
  recoilKick = lerp(recoilKick, 0, 1-Math.pow(0.0005, dt));
  pitchObject.rotation.x += recoilPitch*dt*6;
  yawObject.rotation.y += recoilYaw*dt*6;
  if(weaponMount) weaponMount.position.z = recoilKick*0.5;
}

function updateWeaponSway(dt, now){
  if(!weaponMount) return;
  const idle = Math.sin(now/1000*1.6)*0.004;
  weaponMount.rotation.z = idle + (mouseDown?0:0);
  if(currentWeaponObj && currentWeaponObj.userData.mixer){
    currentWeaponObj.userData.mixer.update(dt);
  }
}

/* ---------------------------------------------------------------------
   9. SCOPE (sniper right-click zoom)
--------------------------------------------------------------------- */
function setScoped(on){
  if(!currentWeapon.scoped) return;
  scoped = on;
  const targetFov = on ? currentWeapon.zoomFov : 72;
  animateFov(targetFov);
  $('scopeOverlay').classList.toggle('active', on);
  $('crosshair').classList.toggle('crosshair-hidden', on);
  if(on) buildScopeSvg();
}
function animateFov(target){
  const startFov = camera.fov;
  const t0 = performance.now();
  (function step(){
    const t = clamp((performance.now()-t0)/180,0,1);
    camera.fov = lerp(startFov, target, t);
    camera.updateProjectionMatrix();
    if(t<1) requestAnimationFrame(step);
  })();
}
function buildScopeSvg(){
  const w = window.innerWidth, h = window.innerHeight;
  const r = Math.min(w,h)*0.44;
  const cx=w/2, cy=h/2;
  $('scopeOverlay').innerHTML =
    '<svg viewBox="0 0 '+w+' '+h+'">'+
    '<defs><mask id="scopeMask"><rect width="'+w+'" height="'+h+'" fill="white"/><circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="black"/></mask></defs>'+
    '<rect width="'+w+'" height="'+h+'" fill="black" mask="url(#scopeMask)"/>'+
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="#111" stroke-width="6"/>'+
    '<line x1="'+cx+'" y1="'+(cy-r)+'" x2="'+cx+'" y2="'+(cy+r)+'" stroke="#1c1c1c" stroke-width="1.5"/>'+
    '<line x1="'+(cx-r)+'" y1="'+cy+'" x2="'+(cx+r)+'" y2="'+cy+'" stroke="#1c1c1c" stroke-width="1.5"/>'+
    '<circle cx="'+cx+'" cy="'+cy+'" r="3" fill="#e6483c"/>'+
    '</svg>';
}

/* ---------------------------------------------------------------------
   10. INPUT
--------------------------------------------------------------------- */
function bindInput(){
  window.addEventListener('keydown', function(e){
    keys[e.code]=true;
    if(e.code==='KeyR' && levelRunning) startReload();
    if(e.code==='Escape' && levelRunning) togglePause();
    if(e.code==='Backquote'){ $('debugPanel').classList.toggle('active'); }
  });
  window.addEventListener('keyup', function(e){ keys[e.code]=false; });

  const canvas = $('gamecanvas');
  canvas.addEventListener('click', function(){
    if(levelRunning && !pointerLocked) requestPointerLock();
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', function(e){
    if(!levelRunning || !pointerLocked) return;
    if(e.button===0){ mouseDown=true; tryFire(); }
    if(e.button===2){ setScoped(true); }
  });
  document.addEventListener('mouseup', function(e){
    if(e.button===0) mouseDown=false;
    if(e.button===2) setScoped(false);
  });
  canvas.addEventListener('contextmenu', function(e){ e.preventDefault(); });
}

let pausedBefore = false;
function togglePause(){
  const pm = $('pauseMenu');
  const willPause = !pm.classList.contains('active');
  pm.classList.toggle('active', willPause);
  if(willPause) exitPointerLock();
  else requestPointerLock();
}

/* ---------------------------------------------------------------------
   11. MAIN LOOP
--------------------------------------------------------------------- */
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  if(levelRunning && !$('pauseMenu').classList.contains('active')){
    updateMovement(dt);
    updateRecoilRecover(dt);
    updateWeaponSway(dt, now);
    finishReloadIfDue(now);

    if(mouseDown && currentWeapon.type==='auto') tryFire();

    // spawn logic
    if(targetsSpawnedCount < levelConfig.targetCount){
      const currentlyAlive = activeTargets.filter(t=>t.alive).length;
      if(now >= nextSpawnAt && currentlyAlive < levelConfig.simultaneous){
        spawnTarget();
        targetsSpawnedCount++;
        nextSpawnAt = now + levelConfig.spawnGapMs;
      }
    }
    updateTargets(dt, now);

    // timer
    const elapsed = (now-levelStartAt)/1000;
    const remaining = levelConfig.timeLimit - elapsed;
    if(levelConfig.timeLimit < 999){
      $('hudTimer').textContent = Math.max(0,remaining).toFixed(1);
      $('hudTimer').classList.toggle('warn', remaining<10);
    } else {
      $('hudTimer').textContent = '∞';
      $('hudTimer').classList.remove('warn');
    }

    const doneSpawning = targetsSpawnedCount >= levelConfig.targetCount;
    const noneAlive = activeTargets.filter(t=>t.alive).length===0;
    if((remaining<=0 && levelConfig.timeLimit<999) || (doneSpawning && noneAlive && activeTargets.length===0)){
      endLevel();
    }
  }

  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------------
   12. UI SCREENS
--------------------------------------------------------------------- */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  if(id) $(id).classList.add('active');
}

function buildArmoryUI(){
  const grid = $('gunGrid');
  grid.innerHTML = '';
  WEAPONS.forEach(function(w){
    const card = document.createElement('div');
    card.className = 'gun-card'+(w.id===State.selectedWeapon?' selected':'');
    card.dataset.id = w.id;
    card.innerHTML =
      '<div class="gun-type">'+w.price+'</div>'+
      '<h3>'+w.name+'</h3>'+
      statRow('DMG', w.stats.damage)+
      statRow('RATE', w.stats.firerate)+
      statRow('ACC', w.stats.accuracy)+
      statRow('HDL', w.stats.handling)+
      '<div class="gun-desc">'+w.desc+'</div>';
    card.addEventListener('click', function(){
      State.selectedWeapon = w.id;
      document.querySelectorAll('.gun-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected');
      $('btnToRange').disabled = false;
    });
    grid.appendChild(card);
  });
}
function statRow(label, val){
  return '<div class="stat-row"><span class="stat-label">'+label+'</span><div class="stat-bar"><i style="width:'+val+'%"></i></div></div>';
}

function buildLevelsUI(){
  const grid = $('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach(function(cfg, i){
    const unlocked = State.unlocked[cfg.id];
    const stars = State.levelProgress[cfg.id]||0;
    const card = document.createElement('div');
    card.className = 'level-card'+(unlocked?'':' locked');
    card.innerHTML =
      '<div class="level-num">DRILL '+String(cfg.id).padStart(2,'0')+'</div>'+
      '<h3>'+cfg.name.replace(/^Drill \d+ — /,'')+'</h3>'+
      '<p>'+cfg.desc+'</p>'+
      '<div class="level-stars s'+stars+'"><span>★</span><span>★</span><span>★</span></div>';
    if(unlocked){
      card.addEventListener('click', function(){
        equipWeapon(State.selectedWeapon);
        startLevel(cfg);
      });
    }
    grid.appendChild(card);
  });
}

function wireUI(){
  $('btnStart').addEventListener('click', function(){
    buildArmoryUI();
    showScreen('armory');
  });
  $('btnHow').addEventListener('click', function(){
    showCenterMsg('', 1);
    alert('Choose a weapon in the Armory, then pick a drill in the Shooting Range.\n\nWASD to move, mouse to look, left-click to fire, R to reload, right-click to aim (sniper), Esc to pause.\nStay within the range boundary — targets pop up from the range windows downrange.');
  });
  $('btnArmoryBack').addEventListener('click', function(){ showScreen('menu'); });
  $('btnToRange').addEventListener('click', function(){
    buildLevelsUI();
    showScreen('levels');
  });
  $('btnLevelsBack').addEventListener('click', function(){ showScreen('armory'); });

  $('btnResume').addEventListener('click', togglePause);
  $('btnQuitLevel').addEventListener('click', function(){
    $('pauseMenu').classList.remove('active');
    levelRunning = false;
    $('hud').classList.remove('active');
    activeTargets.forEach(function(r){ scene.remove(r.obj); });
    activeTargets = [];
    exitPointerLock();
    buildLevelsUI();
    showScreen('levels');
  });

  $('btnRetry').addEventListener('click', function(){ equipWeapon(State.selectedWeapon); startLevel(levelConfig); requestPointerLock(); });
  $('btnNextLevel').addEventListener('click', function(){
    const next = LEVELS.find(l=>l.id===levelConfig.id+1);
    if(next){ equipWeapon(State.selectedWeapon); startLevel(next); requestPointerLock(); }
  });
  $('btnResToLevels').addEventListener('click', function(){ buildLevelsUI(); showScreen('levels'); });

  $('sensSlider').addEventListener('input', function(e){ mouseSensitivity = parseFloat(e.target.value); });

  // debug panel wiring
  ['dpx','dpy','dpz','dry','dsc'].forEach(function(id){
    $(id).addEventListener('input', applyDebugOffsets);
  });
}

function applyDebugOffsets(){
  if(!currentWeaponObj || !currentWeapon) return;
  const px=parseFloat($('dpx').value), py=parseFloat($('dpy').value), pz=parseFloat($('dpz').value);
  const ry=parseFloat($('dry').value), sc=parseFloat($('dsc').value);
  currentWeaponObj.position.set(
    currentWeapon.offset.pos[0]+px,
    currentWeapon.offset.pos[1]+py,
    currentWeapon.offset.pos[2]+pz
  );
  currentWeaponObj.rotation.y = currentWeapon.offset.rot[1]+ry;
  currentWeaponObj.scale.setScalar(currentWeapon.offset.scale*sc);
  $('dvpx').textContent=px.toFixed(2); $('dvpy').textContent=py.toFixed(2); $('dvpz').textContent=pz.toFixed(2);
  $('dvry').textContent=ry.toFixed(2); $('dvsc').textContent=sc.toFixed(2);
  console.log('[calibration] '+currentWeapon.id+' offset:',{
    pos:[currentWeapon.offset.pos[0]+px, currentWeapon.offset.pos[1]+py, currentWeapon.offset.pos[2]+pz],
    rot:[currentWeapon.offset.rot[0], currentWeapon.offset.rot[1]+ry, currentWeapon.offset.rot[2]],
    scale: currentWeapon.offset.scale*sc
  });
}

/* ---------------------------------------------------------------------
   13. BOOTSTRAP
--------------------------------------------------------------------- */
function boot(){
  bootLog('starting engine…', 2);
  initThree();
  bindInput();
  wireUI();
  // yield one frame so the boot screen actually paints before the heavy
  // synchronous base64-decode + GLTF parse work blocks the main thread
  requestAnimationFrame(function(){
    setTimeout(function(){
      loadAssets(function(){
        buildScene();
        equipWeapon(State.selectedWeapon);
        assetsLoaded = true;
        bootLog('ready.', 100);
        setTimeout(function(){
          showScreen('menu');
        }, 300);
      });
      animate();
    }, 30);
  });
}

function bootSafe(){
  try{
    boot();
  }catch(e){
    console.error('Fatal boot error', e);
    try{
      const el = document.getElementById('fatalError');
      const msg = document.getElementById('fatalErrorMsg');
      if(el && msg){ msg.textContent += (e.message||e)+'\n'+(e.stack||''); el.classList.add('show'); }
    }catch(e2){}
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bootSafe);
} else {
  bootSafe();
}

})();
