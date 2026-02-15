import * as THREE from 'three';
import { LEVELS } from './levels.js';

// ─── Game Constants ─────────────────────────────
const MAP_SIZE = 64;
const CELL = 2; // world units per cell
const WALL_H = CELL;
const EYE_H = 0.9;
const HUD_BASE_W = 640;
const HUD_BASE_H = 80;
const HUD_MAX_SCALE = 4;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_HEALTH = 100;
const MAX_AMMO = 99;
const START_AMMO = 8;
const CLIP_AMMO = 8;
const DOOR_TRAVEL = CELL - 0.02;
const DOOR_PASSABLE_OPEN = 0.8;

// ─── Game State ─────────────────────────────────
const state = {
    health: MAX_HEALTH, ammo: START_AMMO, score: 0, lives: 3,
    weapon: 'pistol', keys: { gold: false, silver: false },
    episode: 0, level: 0,
    shooting: false, shootCooldown: 0,
    minimapVisible: true,
    moveSpeed: 4.0, runMultiplier: 1.8, mouseSensitivity: 0.002,
};

// ─── Audio System ───────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioCache = new Map();
let musicGain, sfxGain, currentMusic = null, musicSource = null;

function initAudio() {
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.3;
    musicGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.6;
    sfxGain.connect(audioCtx.destination);
}
initAudio();

async function loadAudio(url) {
    if (audioCache.has(url)) return audioCache.get(url);
    try {
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(buf);
        audioCache.set(url, decoded);
        return decoded;
    } catch { return null; }
}

function playSound(url, volume = 1.0) {
    loadAudio(url).then(buf => {
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const gain = audioCtx.createGain();
        gain.gain.value = volume;
        src.connect(gain);
        gain.connect(sfxGain);
        src.start();
    });
}

function playSpatialSound(url, worldX, worldZ, volume = 1.0) {
    const dx = worldX - camera.position.x;
    const dz = worldZ - camera.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const maxDist = 30;
    if (dist > maxDist) return;
    playSound(url, volume * Math.max(0, 1 - dist / maxDist));
}

const MUSIC_TRACKS = [
    '/sounds/music/GETTHEM.ogg', '/sounds/music/SEARCHN.ogg',
    '/sounds/music/WARMARCH.ogg', '/sounds/music/CORNER.ogg',
    '/sounds/music/DUNGEON.ogg', '/sounds/music/SUSPENSE.ogg',
    '/sounds/music/GOINGAFT.ogg', '/sounds/music/HEADACHE.ogg',
    '/sounds/music/POW.ogg', '/sounds/music/ZEROHOUR.ogg',
    '/sounds/music/INTROCW3.ogg', '/sounds/music/NAZI_OMI.ogg',
    '/sounds/music/PACMAN.ogg', '/sounds/music/ROSTER.ogg',
    '/sounds/music/URAHERO.ogg', '/sounds/music/VICTORS.ogg',
    '/sounds/music/WONDERIN.ogg', '/sounds/music/FUNKYOU.ogg',
    '/sounds/music/ENDLEVEL.ogg', '/sounds/music/GOINGAFT.ogg',
    '/sounds/music/PREGNANT.ogg', '/sounds/music/ULTIMATE.ogg',
    '/sounds/music/NAZI_RAP.ogg', '/sounds/music/TWELFTH.ogg',
    '/sounds/music/SALUTE.ogg', '/sounds/music/XFUNKIE.ogg',
    '/sounds/music/XDEATH.ogg',
];

async function playMusic(idx) {
    const url = MUSIC_TRACKS[idx % MUSIC_TRACKS.length];
    if (currentMusic === url) return;
    currentMusic = url;
    if (musicSource) { try { musicSource.stop(); } catch {} }
    const buf = await loadAudio(url);
    if (!buf) return;
    musicSource = audioCtx.createBufferSource();
    musicSource.buffer = buf;
    musicSource.loop = true;
    musicSource.connect(musicGain);
    musicSource.start();
}

const SFX = {
    pistolFire:    '/sounds/sfx/012.ogg',
    machinegunFire:'/sounds/sfx/011.ogg',
    chaingunFire:  '/sounds/sfx/013.ogg',
    doorOpen:      '/sounds/sfx/010.ogg',
    doorClose:     '/sounds/sfx/007.ogg',
    guardAlert:    '/sounds/sfx/001.ogg',
    guardDeath:    ['/sounds/sfx/025.ogg', '/sounds/sfx/026.ogg', '/sounds/sfx/086.ogg', '/sounds/sfx/088.ogg'],
    guardAttack:   '/sounds/sfx/049.ogg',
    officerAlert:  '/sounds/sfx/071.ogg',
    officerDeath:  '/sounds/sfx/074.ogg',
    ssAlert:       '/sounds/sfx/015.ogg',
    ssDeath:       '/sounds/sfx/046.ogg',
    ssAttack:      '/sounds/sfx/024.ogg',
    dogAlert:      '/sounds/sfx/002.ogg',
    dogDeath:      '/sounds/sfx/035.ogg',
    bossAlert:     '/sounds/sfx/017.ogg',
    bossDeath:     '/sounds/sfx/019.ogg',
    bossAttack:    '/sounds/sfx/022.ogg',
    mutantDeath:   '/sounds/sfx/037.ogg',
    playerDamage:  '/sounds/lsfx/009.ogg',
    pickupAmmo:    '/sounds/lsfx/031.ogg',
    pickupWeapon:  '/sounds/lsfx/030.ogg',
    pickupHealth:  '/sounds/lsfx/034.ogg',
    pickupFood:    '/sounds/lsfx/033.ogg',
    pickupTreasure:'/sounds/lsfx/035.ogg',
    pickupKey:     '/sounds/lsfx/012.ogg',
    knife:         '/sounds/lsfx/023.ogg',
    levelComplete: '/sounds/music/ENDLEVEL.ogg',
};

// Preload critical sounds
for (const val of Object.values(SFX)) {
    if (Array.isArray(val)) val.forEach(u => loadAudio(u));
    else loadAudio(val);
}

// ─── Texture Atlas ──────────────────────────────
const loader = new THREE.TextureLoader();
const ATLAS_SIZE = 16;

const wallsAtlas = loader.load('/textures/walls.png');
wallsAtlas.magFilter = THREE.NearestFilter;
wallsAtlas.minFilter = THREE.NearestFilter;
wallsAtlas.colorSpace = THREE.SRGBColorSpace;

const spritesAtlas = loader.load('/textures/sprites.png');
spritesAtlas.magFilter = THREE.NearestFilter;
spritesAtlas.minFilter = THREE.NearestFilter;
spritesAtlas.colorSpace = THREE.SRGBColorSpace;

const guardAtlas = loader.load('/textures/guard.png');
guardAtlas.magFilter = THREE.NearestFilter;
guardAtlas.minFilter = THREE.NearestFilter;
guardAtlas.colorSpace = THREE.SRGBColorSpace;

function wallTile(col, row) {
    const tex = wallsAtlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / ATLAS_SIZE, 1 / ATLAS_SIZE);
    tex.offset.set(col / ATLAS_SIZE, 1 - (row + 1) / ATLAS_SIZE);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

function spriteTile(col, row) {
    const tex = spritesAtlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / ATLAS_SIZE, 1 / ATLAS_SIZE);
    tex.offset.set(col / ATLAS_SIZE, 1 - (row + 1) / ATLAS_SIZE);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

function guardTile(col, row) {
    const GUARD_SIZE = 8;
    const tex = guardAtlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / GUARD_SIZE, 1 / GUARD_SIZE);
    tex.offset.set(col / GUARD_SIZE, 1 - (row + 1) / GUARD_SIZE);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

// ─── Wall Material Cache ────────────────────────
// Wolf3D wall value n → light texture index (n-1)*2, dark texture index (n-1)*2+1
// Atlas: 16x16 grid, index → col = idx % 16, row = floor(idx / 16)
const wallMatCache = new Map();

function getWallMaterials(wallValue) {
    if (wallMatCache.has(wallValue)) return wallMatCache.get(wallValue);
    const lightIdx = (wallValue - 1) * 2;
    const darkIdx = lightIdx + 1;
    const lightCol = lightIdx % ATLAS_SIZE, lightRow = Math.floor(lightIdx / ATLAS_SIZE);
    const darkCol = darkIdx % ATLAS_SIZE, darkRow = Math.floor(darkIdx / ATLAS_SIZE);
    const lightMat = new THREE.MeshLambertMaterial({ map: wallTile(lightCol, lightRow) });
    const darkMat = new THREE.MeshLambertMaterial({ map: wallTile(darkCol, darkRow) });
    // 6 faces: +x, -x, +y, -y, +z, -z
    // Light on N/S walls (±z), Dark on E/W walls (±x)
    const mats = [darkMat, darkMat, lightMat, lightMat, lightMat, lightMat];
    wallMatCache.set(wallValue, mats);
    return mats;
}

// Door textures - from original Wolf3D TEX_DOOR = 98
// Door face: atlas index 98,99  Door side: atlas index 100,101
// Elevator door: atlas index 102,103  Locked door: 104,105
function getDoorMat(texIdx) {
    const col = texIdx % ATLAS_SIZE, row = Math.floor(texIdx / ATLAS_SIZE);
    return new THREE.MeshLambertMaterial({ map: wallTile(col, row) });
}

const doorFaceMat = getDoorMat(98);
const doorSideMat = getDoorMat(100);
const elevDoorMat = getDoorMat(102);
const lockDoorMat = getDoorMat(104);

// ─── Static Object Definitions (statinfo) ───────
// Type index (0-46) from decoded map data
// [blocking, pickupType]
const STATINFO = [
    { name: 'puddle',      block: false, pickup: null,       tile: [0, 0] },   // 0
    { name: 'greenBarrel', block: true,  pickup: null,       tile: [2, 1] },   // 1
    { name: 'tableChairs', block: true,  pickup: null,       tile: [13, 1] },  // 2
    { name: 'floorLamp',   block: true,  pickup: null,       tile: [3, 1] },   // 3
    { name: 'chandelier',  block: false, pickup: null,       tile: [4, 1] },   // 4
    { name: 'hangedMan',   block: true,  pickup: null,       tile: [5, 1] },   // 5
    { name: 'dogFood',     block: false, pickup: 'food',     tile: [10, 3] },  // 6
    { name: 'pillar',      block: true,  pickup: null,       tile: [8, 1] },   // 7
    { name: 'tree',        block: true,  pickup: null,       tile: [9, 1] },   // 8
    { name: 'skeleton',    block: false, pickup: null,       tile: [10, 1] },  // 9
    { name: 'sink',        block: true,  pickup: null,       tile: [11, 1] },  // 10
    { name: 'plant',       block: true,  pickup: null,       tile: [11, 1] },  // 11
    { name: 'urn',         block: true,  pickup: null,       tile: [12, 1] },  // 12
    { name: 'bareTable',   block: true,  pickup: null,       tile: [13, 1] },  // 13
    { name: 'ceilLight',   block: false, pickup: null,       tile: [0, 2], light: true },  // 14
    { name: 'pans',        block: false, pickup: null,       tile: [1, 2] },   // 15
    { name: 'armor',       block: true,  pickup: null,       tile: [2, 2] },   // 16
    { name: 'cage',        block: true,  pickup: null,       tile: [3, 2] },   // 17
    { name: 'cageSkel',    block: true,  pickup: null,       tile: [3, 2] },   // 18
    { name: 'bonesRelax',  block: false, pickup: null,       tile: [4, 3] },   // 19
    { name: 'key1',        block: false, pickup: 'key1',     tile: [5, 3] },   // 20
    { name: 'key2',        block: false, pickup: 'key2',     tile: [6, 3] },   // 21
    { name: 'stuff',       block: true,  pickup: null,       tile: [7, 3] },   // 22
    { name: 'junk',        block: false, pickup: null,       tile: [4, 3] },   // 23
    { name: 'food',        block: false, pickup: 'food',     tile: [10, 3] },  // 24
    { name: 'firstaid',    block: false, pickup: 'health',   tile: [11, 3] },  // 25
    { name: 'clip',        block: false, pickup: 'ammo',     tile: [12, 3] },  // 26
    { name: 'machinegun',  block: false, pickup: 'machinegun', tile: [13, 3] },// 27
    { name: 'chaingun',    block: false, pickup: 'chaingun', tile: [7, 3] },   // 28
    { name: 'cross',       block: false, pickup: 'cross',    tile: [14, 3] },  // 29
    { name: 'chalice',     block: false, pickup: 'chalice',  tile: [15, 3] },  // 30
    { name: 'bible',       block: false, pickup: 'bible',    tile: [0, 4] },   // 31
    { name: 'crown',       block: false, pickup: 'crown',    tile: [1, 4] },   // 32
    { name: 'oneUp',       block: false, pickup: 'oneup',    tile: [2, 4] },   // 33
    { name: 'gibs',        block: false, pickup: null,       tile: [7, 4] },   // 34
    { name: 'barrel',      block: true,  pickup: null,       tile: [4, 4] },   // 35
    { name: 'well',        block: true,  pickup: null,       tile: [5, 4] },   // 36
    { name: 'emptyWell',   block: true,  pickup: null,       tile: [6, 4] },   // 37
    { name: 'gibs2',       block: false, pickup: null,       tile: [7, 4] },   // 38
    { name: 'flag',        block: true,  pickup: null,       tile: [8, 4] },   // 39
    { name: 'callApogee',  block: true,  pickup: null,       tile: [0, 5] },   // 40
    { name: 'junk2',       block: false, pickup: null,       tile: [4, 3] },   // 41
    { name: 'junk3',       block: false, pickup: null,       tile: [4, 3] },   // 42
    { name: 'junk4',       block: false, pickup: null,       tile: [4, 3] },   // 43
    { name: 'pots',        block: false, pickup: null,       tile: [1, 2] },   // 44
    { name: 'stove',       block: true,  pickup: null,       tile: [15, 5] },  // 45
    { name: 'spears',      block: true,  pickup: null,       tile: [0, 5] },   // 46
];

// ─── Enemy Types ────────────────────────────────
// Each type has unique behavioral flags:
//   melee: only attacks at close range (dogs)
//   silent: no alert sound, attacks instantly (mutants)
//   noPain: ignores pain state (bosses)
//   dodges: strafes during combat (officers, SS)
//   rushes: charges straight at player ignoring caution distance (dogs)
//   canOpenDoors: can open doors during chase
const ENEMY_TYPES = {
    guard:   { name:'Guard',   hp:25,  speed:1.5, dmg:[5,10],  score:100,  alertDist:10, shootDist:10, cooldown:[1.5,2.5], acc:0.6,  alertSfx:SFX.guardAlert,   deathSfx:SFX.guardDeath,   atkSfx:SFX.guardAttack,   tint:null, scale:[1.2,1.6], melee:false, silent:false, noPain:false, dodges:false, rushes:false, canOpenDoors:true },
    officer: { name:'Officer', hp:50,  speed:2.5, dmg:[8,15],  score:400,  alertDist:14, shootDist:12, cooldown:[1.0,1.8], acc:0.75, alertSfx:SFX.officerAlert, deathSfx:SFX.officerDeath, atkSfx:SFX.guardAttack,   tint:new THREE.Color(0.9,0.9,1.2), scale:[1.2,1.6], melee:false, silent:false, noPain:false, dodges:true, rushes:false, canOpenDoors:true },
    ss:      { name:'SS',      hp:100, speed:2.0, dmg:[10,20], score:500,  alertDist:16, shootDist:14, cooldown:[0.8,1.5], acc:0.8,  alertSfx:SFX.ssAlert,      deathSfx:SFX.ssDeath,      atkSfx:SFX.ssAttack,      tint:new THREE.Color(0.5,0.5,0.5), scale:[1.3,1.7], melee:false, silent:false, noPain:false, dodges:true, rushes:false, canOpenDoors:true },
    dog:     { name:'Dog',     hp:1,   speed:4.0, dmg:[5,12],  score:200,  alertDist:12, shootDist:2,  cooldown:[0.8,1.2], acc:0.9,  alertSfx:SFX.dogAlert,     deathSfx:SFX.dogDeath,     atkSfx:SFX.knife,         tint:new THREE.Color(0.8,0.6,0.3), scale:[1.0,0.8], melee:true, silent:false, noPain:false, dodges:false, rushes:true, canOpenDoors:false },
    mutant:  { name:'Mutant',  hp:55,  speed:1.8, dmg:[8,18],  score:700,  alertDist:12, shootDist:10, cooldown:[0.3,0.6], acc:0.7,  alertSfx:SFX.guardAlert,   deathSfx:SFX.mutantDeath,  atkSfx:SFX.guardAttack,   tint:new THREE.Color(0.4,0.8,0.3), scale:[1.3,1.7], melee:false, silent:true, noPain:false, dodges:false, rushes:false, canOpenDoors:true },
    boss:    { name:'Boss',    hp:850, speed:1.2, dmg:[15,30], score:5000, alertDist:20, shootDist:16, cooldown:[0.5,1.0], acc:0.85, alertSfx:SFX.bossAlert,    deathSfx:SFX.bossDeath,    atkSfx:SFX.bossAttack,    tint:new THREE.Color(1.2,0.8,0.8), scale:[1.8,2.2], melee:false, silent:false, noPain:true, dodges:false, rushes:false, canOpenDoors:true },
};

const AI = { STAND:0, PATROL:1, ALERT:2, CHASE:3, ATTACK:4, PAIN:5, DYING:6, DEAD:7, DOOR_WAIT:8, DODGE:9, INVESTIGATE:10 };

// Pre-create guard sprite textures (8x8 grid)
const guardFrames = [];
for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
        guardFrames.push(guardTile(c, r));
// Guard spritesheet layout (8x8 grid, 16px cells):
// Row 0: Stand 8 dirs | Row 1-4: Walk 4 frames × 8 dirs
// Row 5: pain/death sequence (col 0..4)
// Row 6: attack/aim poses (col 0..1)
// Row 7: alternate standing/aim variants
const guardShootAimTex = guardTile(0, 6);   // row 6 col 0 — aim/raise gun
const guardShootFireTex = guardTile(1, 6);  // row 6 col 1 — fire with flash
const guardPainTex = guardTile(1, 5);       // row 5 col 1 — hit reaction
const guardDeathFrames = [
    guardTile(0, 5),  // frame 0: hit
    guardTile(1, 5),  // frame 1: falling with blood
    guardTile(2, 5),  // frame 2: down (side)
    guardTile(3, 5),  // frame 3: down (front)
    guardTile(4, 5),  // frame 4: flat dead
];
const guardDeathPose = [
    { sx: 1.0, sy: 0.95, y: 0.48 },
    { sx: 1.05, sy: 0.82, y: 0.42 },
    { sx: 1.12, sy: 0.66, y: 0.34 },
    { sx: 1.18, sy: 0.56, y: 0.28 },
    { sx: 1.24, sy: 0.48, y: 0.24 },
];

// ─── Scene Setup ────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x383838);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / Math.max(MIN_VIEWPORT_HEIGHT, window.innerHeight - HUD_BASE_H), 0.1, 200);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: false, canvas: document.createElement('canvas') });
renderer.domElement.id = 'game';
renderer.setSize(window.innerWidth, Math.max(MIN_VIEWPORT_HEIGHT, window.innerHeight - HUD_BASE_H));
renderer.setPixelRatio(1);
document.body.prepend(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
dirLight.position.set(0, 1, 0);
scene.add(dirLight);
const playerLight = new THREE.PointLight(0xffeedd, 0.3, 10);
scene.add(playerLight);

// ─── Level State ────────────────────────────────
let levelWalls = null;    // 64x64 wall values
let levelDoors = [];      // door objects
let levelEnemies = [];    // enemy sprites
let levelStatics = [];    // static prop sprites
let levelPickups = [];    // pickup sprites
let levelMeshes = [];     // all Three.js meshes for current level
let levelLights = [];
let playerMoveSpeed = 0;
let hudScale = 1;
let hudPixelHeight = HUD_BASE_H;

const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);

// ─── Level Loading ──────────────────────────────

function clearLevel() {
    for (const m of levelMeshes) { scene.remove(m); if (m.geometry) m.geometry.dispose(); }
    for (const e of levelEnemies) scene.remove(e);
    for (const s of levelStatics) scene.remove(s);
    for (const p of levelPickups) scene.remove(p);
    for (const l of levelLights) scene.remove(l);
    levelMeshes = []; levelDoors = []; levelEnemies = []; levelStatics = []; levelPickups = []; levelLights = [];
    levelWalls = null;
}

function getPickupScale(pickupType) {
    switch (pickupType) {
        case 'ammo': return 0.66;
        case 'food': return 0.72;
        case 'health': return 0.78;
        case 'key1':
        case 'key2': return 0.72;
        default: return 0.82;
    }
}

function addCeilingLamp(wx, wz, warm = false) {
    const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.20, 0.10, 10),
        new THREE.MeshLambertMaterial({ color: warm ? 0xa67a2a : 0x1e7f56 })
    );
    cap.position.set(wx, WALL_H - 0.05, wz);
    scene.add(cap);
    levelMeshes.push(cap);

    const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 10, 8),
        new THREE.MeshBasicMaterial({ color: warm ? 0xffd872 : 0x5dff75 })
    );
    bulb.position.set(wx, WALL_H - 0.16, wz);
    scene.add(bulb);
    levelMeshes.push(bulb);

    const light = new THREE.PointLight(warm ? 0xffdf9c : 0x9dff8f, warm ? 0.55 : 0.65, warm ? 7 : 8);
    light.position.set(wx, WALL_H - 0.22, wz);
    scene.add(light);
    levelLights.push(light);
}

function loadLevel(levelIdx) {
    clearLevel();
    const lvl = LEVELS[levelIdx];
    if (!lvl) { console.error('Level not found:', levelIdx); return; }

    levelWalls = lvl.walls.slice(); // copy

    // Ceiling/floor colors from level data
    const ceilColor = lvl.ceiling ? ((lvl.ceiling[0] << 16) | (lvl.ceiling[1] << 8) | lvl.ceiling[2]) : 0x383838;
    const floorColor = lvl.floor ? ((lvl.floor[0] << 16) | (lvl.floor[1] << 8) | lvl.floor[2]) : 0x707070;
    scene.background = new THREE.Color(ceilColor || 0x383838);

    // Floor plane
    const floorGeo = new THREE.PlaneGeometry(MAP_SIZE * CELL, MAP_SIZE * CELL);
    const floorMat = new THREE.MeshBasicMaterial({ color: floorColor || 0x707070 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(MAP_SIZE * CELL / 2, 0, MAP_SIZE * CELL / 2);
    scene.add(floor);
    levelMeshes.push(floor);

    // Ceiling plane
    const ceilGeo = new THREE.PlaneGeometry(MAP_SIZE * CELL, MAP_SIZE * CELL);
    const ceilMat = new THREE.MeshBasicMaterial({ color: ceilColor || 0x383838 });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(MAP_SIZE * CELL / 2, WALL_H, MAP_SIZE * CELL / 2);
    scene.add(ceil);
    levelMeshes.push(ceil);

    // Build walls
    for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            const w = levelWalls[y * MAP_SIZE + x];
            if (w > 0) {
                // Solid wall
                const mats = getWallMaterials(w);
                const mesh = new THREE.Mesh(wallGeo, mats);
                mesh.position.set(x * CELL + CELL / 2, WALL_H / 2, y * CELL + CELL / 2);
                scene.add(mesh);
                levelMeshes.push(mesh);
            }
        }
    }

    // Place doors
    for (const d of lvl.doors) {
        const wx = d.x * CELL + CELL / 2;
        const wz = d.y * CELL + CELL / 2;

        let faceMat = doorFaceMat;
        if (d.type === 'elevator') faceMat = elevDoorMat;
        else if (d.type === 'gold' || d.type === 'silver') faceMat = lockDoorMat;

        const doorMesh = new THREE.Mesh(wallGeo, faceMat);
        doorMesh.position.set(wx, WALL_H / 2, wz);
        doorMesh.userData = {
            isDoor: true,
            doorType: d.type,
            vertical: d.vertical,
            gridX: d.x, gridY: d.y,
            openAmount: 0, opening: false, open: false,
            closeTimer: 0,
        };
        scene.add(doorMesh);
        levelMeshes.push(doorMesh);
        levelDoors.push(doorMesh);

        // Mark door cell in walls as -1 so collision/LOS treat it as a door cell.
        levelWalls[d.y * MAP_SIZE + d.x] = -1;
    }

    // Static objects
    for (const s of lvl.statics) {
        if (s.type === 'exit') {
            // Exit marker — place invisible trigger
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
            sp.position.set(s.x * CELL + CELL / 2, 0.5, s.y * CELL + CELL / 2);
            sp.userData = { isExit: true };
            scene.add(sp);
            levelStatics.push(sp);
            continue;
        }
        const typeIdx = (typeof s.type === 'number') ? s.type : -1;
        if (typeIdx < 0 || typeIdx >= STATINFO.length) continue;
        const info = STATINFO[typeIdx];
        if (!info) continue;

        const wx = s.x * CELL + CELL / 2;
        const wz = s.y * CELL + CELL / 2;

        if (typeIdx === 14 || typeIdx === 4) {
            addCeilingLamp(wx, wz, typeIdx === 4);
            continue;
        }

        if (typeIdx === 15) {
            // Remove old hanging pans sprites.
            continue;
        }

        if (info.pickup) {
            // This is a pickup
            const mat = new THREE.SpriteMaterial({ map: spriteTile(info.tile[0], info.tile[1]), transparent: true, alphaTest: 0.5 });
            const sp = new THREE.Sprite(mat);
            const pickupScale = getPickupScale(info.pickup);
            sp.center.set(0.5, 0);
            sp.position.set(wx, 0.02, wz);
            sp.scale.set(pickupScale, pickupScale, 1);
            sp.userData = { isPickup: true, pickupType: info.pickup, collected: false };
            scene.add(sp);
            levelPickups.push(sp);
        } else {
            // Decorative / blocking static
            const mat = new THREE.SpriteMaterial({ map: spriteTile(info.tile[0], info.tile[1]), transparent: true, alphaTest: 0.5 });
            const sp = new THREE.Sprite(mat);
            sp.center.set(0.5, 0);
            sp.position.set(wx, 0.02, wz);
            sp.scale.set(1.0, 1.2, 1);
            sp.userData = { blocking: info.block };
            scene.add(sp);
            levelStatics.push(sp);
        }
    }

    // Enemies
    for (const e of lvl.enemies) {
        const typeDef = ENEMY_TYPES[e.type];
        if (!typeDef) continue;
        const wx = e.x * CELL + CELL / 2;
        const wz = e.y * CELL + CELL / 2;

        const mat = new THREE.SpriteMaterial({ map: guardTile(0, 0), transparent: true, alphaTest: 0.5 });
        if (typeDef.tint) mat.color.copy(typeDef.tint);
        const sp = new THREE.Sprite(mat);
        sp.position.set(wx, typeDef.scale[1] / 2, wz);
        sp.scale.set(typeDef.scale[0], typeDef.scale[1], 1);
        sp.userData = {
            isEnemy: true, alive: true,
            enemyType: e.type, typeDef,
            health: typeDef.hp,
            aiState: e.patrol ? AI.PATROL : AI.STAND,
            shootCooldown: typeDef.cooldown[0] + Math.random() * (typeDef.cooldown[1] - typeDef.cooldown[0]),
            alertTimer: 0, painTimer: 0, deathTimer: 0,
            attackPhase: 'none', attackTimer: 0, attackDidFire: false,
            deathFrame: 0, deathFrameTimer: 0,
            alerted: false,
            lastSeenX: wx, lastSeenZ: wz, lostSightTimer: 0,
            patrolAngle: (e.dir || 0) * Math.PI / 2,
            patrolTimer: 2 + Math.random() * 3,
            walkFrame: 0, walkTimer: 0,
            dir: e.dir || 0,
            baseScaleX: typeDef.scale[0], baseScaleY: typeDef.scale[1],
            // Investigate state
            investigateX: 0, investigateZ: 0, investigateTimer: 0,
            // Dodge state (officers/SS)
            dodgeTimer: 0, dodgeDir: 1,
            // Door wait state
            doorWaitTimer: 0, doorWaitX: 0, doorWaitZ: 0,
        };
        scene.add(sp);
        levelEnemies.push(sp);
    }

    // Player spawn
    camera.position.set(
        lvl.spawnX * CELL + CELL / 2,
        EYE_H,
        lvl.spawnY * CELL + CELL / 2
    );
    // Spawn angle: 0=east, 90=north, 180=west, 270=south (original Wolf3D)
    // In our system: yaw=0 faces -Z (north), yaw=-PI/2 faces +X (east)
    yaw = ((lvl.spawnAngle || 0) - 90) * Math.PI / 180;

    camera.rotation.y = yaw;
    camera.rotation.x = 0;
    pitch = 0;

    // Music
    playMusic(levelIdx);

    console.log(`Loaded level ${levelIdx}: "${lvl.name}" — ${lvl.enemies.length} enemies, ${lvl.doors.length} doors, ${lvl.statics.length} statics`);
}

// ─── Collision ──────────────────────────────────

function isBlocked(wx, wz) {
    const gx = Math.floor(wx / CELL);
    const gz = Math.floor(wz / CELL);
    if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return true;
    const w = levelWalls[gz * MAP_SIZE + gx];
    if (w > 0) return true;
    if (w === -1) {
        const door = levelDoors.find(d => d.userData.gridX === gx && d.userData.gridY === gz);
        if (door && door.userData.openAmount >= DOOR_PASSABLE_OPEN) return false;
        return true;
    }
    for (const s of levelStatics) {
        if (s.userData.blocking) {
            const sdx = wx - s.position.x, sdz = wz - s.position.z;
            if (sdx * sdx + sdz * sdz < 0.36) return true; // 0.6² = 0.36, circular collision
        }
    }
    return false;
}

// Grid-level blocked check (for pathfinding — ignores statics, treats doors as passable)
function isTileBlocked(gx, gz) {
    if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return true;
    const w = levelWalls[gz * MAP_SIZE + gx];
    if (w > 0) return true;
    return false; // doors (-1) and empty (0) are passable for pathfinding
}

// Check if a tile has a closed door
function getDoorAt(gx, gz) {
    if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return null;
    if (levelWalls[gz * MAP_SIZE + gx] !== -1) return null;
    return levelDoors.find(d => d.userData.gridX === gx && d.userData.gridY === gz) || null;
}

function hasLineOfSight(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.1) return true; // same spot
    // Use finer step size for better accuracy, skip start and end cells
    const stepSize = 0.4;
    const steps = Math.max(2, Math.ceil(dist / stepSize));
    const startGX = Math.floor(x1 / CELL), startGZ = Math.floor(z1 / CELL);
    const endGX = Math.floor(x2 / CELL), endGZ = Math.floor(z2 / CELL);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const cx = x1 + dx * t, cz = z1 + dz * t;
        const gx = Math.floor(cx / CELL), gz = Math.floor(cz / CELL);
        // Skip the start and end cells (entities might be in door cells)
        if (gx === startGX && gz === startGZ) continue;
        if (gx === endGX && gz === endGZ) continue;
        if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return false;
        const w = levelWalls[gz * MAP_SIZE + gx];
        if (w > 0) return false;
        if (w === -1) {
            const door = levelDoors.find(d => d.userData.gridX === gx && d.userData.gridY === gz);
            if (!door || door.userData.openAmount < DOOR_PASSABLE_OPEN) return false;
        }
    }
    return true;
}

function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function setEnemyTexture(e, tex) {
    if (e.material.map !== tex) {
        e.material.map = tex;
        e.material.needsUpdate = true;
    }
}

function setEnemyDeathFrame(e, frameIdx) {
    const idx = Math.max(0, Math.min(frameIdx, guardDeathFrames.length - 1));
    const pose = guardDeathPose[idx];
    setEnemyTexture(e, guardDeathFrames[idx]);
    e.scale.set(e.userData.baseScaleX * pose.sx, e.userData.baseScaleY * pose.sy, 1);
    e.position.y = e.userData.baseScaleY * pose.y;
}

function startEnemyAttack(e) {
    e.userData.aiState = AI.ATTACK;
    e.userData.attackPhase = 'aim';
    e.userData.attackTimer = 0.25 + Math.random() * 0.15; // visible aim pause
    e.userData.attackDidFire = false;
}

function finishEnemyAttack(e) {
    const td = e.userData.typeDef;
    e.userData.attackPhase = 'none';
    e.userData.attackTimer = 0;
    e.userData.attackDidFire = false;
    if (td.dodges && Math.random() < 0.6) {
        e.userData.aiState = AI.DODGE;
        e.userData.dodgeTimer = 0.35 + Math.random() * 0.35;
        e.userData.dodgeDir = Math.random() < 0.5 ? 1 : -1;
    } else {
        e.userData.aiState = AI.CHASE;
    }
}

function applyPlayerDamageFeedback(dmg) {
    if (dmg <= 0) return;
    state.health = Math.max(0, state.health - dmg);
    playSound(SFX.playerDamage, 0.5);
    const ov = document.getElementById('damage-overlay');
    ov.style.opacity = '0.6';
    setTimeout(() => { ov.style.opacity = '0'; }, 200);
}

function enemyAttemptHitPlayer(e, dist) {
    const td = e.userData.typeDef;
    const tileDist = dist / CELL;
    let effectiveDist = tileDist;
    if (e.userData.enemyType === 'ss' || e.userData.enemyType === 'boss') {
        effectiveDist = (effectiveDist * 2) / 3;
    }

    // Match classic Wolf3D behavior: running makes enemy shots less accurate.
    let hitChance = playerMoveSpeed >= state.moveSpeed * 1.35 ? 160 : 256;
    const playerToEnemy = Math.atan2(e.position.x - camera.position.x, e.position.z - camera.position.z);
    const facingDiff = Math.abs(normalizeAngle(playerToEnemy - yaw));
    hitChance -= effectiveDist * (facingDiff < Math.PI / 3 ? 16 : 8);
    hitChance = Math.max(8, Math.min(255, hitChance));

    if (Math.floor(Math.random() * 256) >= hitChance) return;

    let rawDamage = Math.floor(Math.random() * 256);
    if (effectiveDist < 2) rawDamage >>= 2;
    else if (effectiveDist < 4) rawDamage >>= 3;
    else rawDamage >>= 4;

    const typeScale = Math.max(0.4, (td.dmg[0] + td.dmg[1]) / 24);
    const dmg = Math.min(td.dmg[1] * 3, Math.max(1, Math.round(rawDamage * typeScale)));
    applyPlayerDamageFeedback(dmg);
}

function enemyFireAtPlayer(e, dist) {
    const td = e.userData.typeDef;
    playSpatialSound(td.atkSfx, e.position.x, e.position.z, 0.7);

    if (td.melee) {
        if (dist >= 1.35) return;
        if (!hasLineOfSight(e.position.x, e.position.z, camera.position.x, camera.position.z)) return;
        if (Math.floor(Math.random() * 256) >= 180) return;
        const rawDamage = Math.floor(Math.random() * 256) >> 4;
        const dmg = Math.max(td.dmg[0], Math.min(td.dmg[1], rawDamage));
        applyPlayerDamageFeedback(dmg);
        return;
    }

    if (dist >= td.shootDist) return;
    if (!hasLineOfSight(e.position.x, e.position.z, camera.position.x, camera.position.z)) return;
    enemyAttemptHitPlayer(e, dist);
}

// ─── A* Pathfinding ─────────────────────────────
// Grid-based A* that finds path through doors (treats them as passable with +2 cost)

const _pathCache = new Map();
let _pathCacheFrame = 0;

function findPath(startX, startZ, goalX, goalZ, maxSteps = 200) {
    const sx = Math.floor(startX / CELL), sz = Math.floor(startZ / CELL);
    const gx = Math.floor(goalX / CELL), gz = Math.floor(goalZ / CELL);
    if (sx === gx && sz === gz) return null; // already there

    // Cache key — reuse paths computed this frame
    const cacheKey = `${sx},${sz}-${gx},${gz}`;
    if (_pathCache.has(cacheKey)) return _pathCache.get(cacheKey);

    // A* with Manhattan heuristic
    const open = []; // min-heap by f
    const gScore = new Map();
    const cameFrom = new Map();
    const key = (x, z) => x * MAP_SIZE + z;

    const startKey = key(sx, sz);
    gScore.set(startKey, 0);
    open.push({ x: sx, z: sz, f: Math.abs(gx - sx) + Math.abs(gz - sz) });

    // 4-directional neighbors (cardinal only — like Wolf3D)
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

    let steps = 0;
    while (open.length > 0 && steps++ < maxSteps) {
        // Find lowest f
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++)
            if (open[i].f < open[bestIdx].f) bestIdx = i;
        const cur = open.splice(bestIdx, 1)[0];
        const curKey = key(cur.x, cur.z);

        if (cur.x === gx && cur.z === gz) {
            // Reconstruct path — return next step
            let k = curKey;
            const path = [];
            while (cameFrom.has(k)) {
                const px = Math.floor(k / MAP_SIZE), pz = k % MAP_SIZE;
                path.unshift({ x: px, z: pz });
                k = cameFrom.get(k);
            }
            if (path.length > 0) {
                _pathCache.set(cacheKey, path);
                return path;
            }
            return null;
        }

        for (const [ddx, ddz] of dirs) {
            const nx = cur.x + ddx, nz = cur.z + ddz;
            if (isTileBlocked(nx, nz)) continue;

            const nKey = key(nx, nz);
            // Doors cost extra to traverse (encourages open paths)
            const doorAt = getDoorAt(nx, nz);
            const moveCost = doorAt && !doorAt.userData.open ? 3 : 1;
            const tentG = (gScore.get(curKey) || 0) + moveCost;

            if (!gScore.has(nKey) || tentG < gScore.get(nKey)) {
                gScore.set(nKey, tentG);
                cameFrom.set(nKey, curKey);
                const h = Math.abs(gx - nx) + Math.abs(gz - nz);
                open.push({ x: nx, z: nz, f: tentG + h });
            }
        }
    }

    _pathCache.set(cacheKey, null);
    return null; // no path found
}

// ─── Sound Alert Propagation (BFS through doors) ────

function alertEnemiesBySound(sourceX, sourceZ, radius) {
    // BFS flood-fill from source through open spaces and doors
    // Alerts enemies within the flood area + direct radius
    const sgx = Math.floor(sourceX / CELL), sgz = Math.floor(sourceZ / CELL);
    const visited = new Set();
    const queue = [{ x: sgx, z: sgz, dist: 0 }];
    visited.add(sgx * MAP_SIZE + sgz);

    const maxFlood = Math.ceil(radius / CELL);
    const alertedCells = new Set();

    while (queue.length > 0) {
        const { x, z, dist } = queue.shift();
        alertedCells.add(x * MAP_SIZE + z);

        if (dist >= maxFlood) continue;

        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dx, dz] of dirs) {
            const nx = x + dx, nz = z + dz;
            const nk = nx * MAP_SIZE + nz;
            if (visited.has(nk)) continue;
            visited.add(nk);
            if (nx < 0 || nx >= MAP_SIZE || nz < 0 || nz >= MAP_SIZE) continue;
            const w = levelWalls[nz * MAP_SIZE + nx];
            if (w > 0) continue; // wall blocks sound
            // Sound passes through open doors and open space
            if (w === -1) {
                const door = getDoorAt(nx, nz);
                if (door && door.userData.openAmount < 0.3) continue; // closed door blocks most sound
            }
            queue.push({ x: nx, z: nz, dist: dist + 1 });
        }
    }

    // Alert all enemies standing in flooded cells
    for (const e of levelEnemies) {
        if (!e.userData.alive) continue;
        const egx = Math.floor(e.position.x / CELL);
        const egz = Math.floor(e.position.z / CELL);
        if (alertedCells.has(egx * MAP_SIZE + egz)) {
            // Bug G fix: Don't downgrade enemies already chasing/attacking/dodging
            const ai = e.userData.aiState;
            if (ai === AI.CHASE || ai === AI.ATTACK || ai === AI.DODGE || ai === AI.PAIN) continue;
            e.userData.alerted = true;
            e.userData.aiState = AI.INVESTIGATE;
            e.userData.investigateX = sourceX;
            e.userData.investigateZ = sourceZ;
            e.userData.investigateTimer = 4 + Math.random() * 3;
            // Mutants are silent — no alert sound
            if (!e.userData.typeDef.silent) {
                playSpatialSound(e.userData.typeDef.alertSfx, e.position.x, e.position.z, 0.6);
            }
        }
    }
}

// Enemy tries to open a door in its path
function enemyTryOpenDoor(e, gx, gz) {
    const door = getDoorAt(gx, gz);
    if (!door || door.userData.open || door.userData.opening) return false;
    // Enemies can't open locked/elevator doors
    if (door.userData.doorType === 'gold' || door.userData.doorType === 'silver' || door.userData.doorType === 'elevator') return false;
    if (!e.userData.typeDef.canOpenDoors) return false;

    door.userData.opening = true;
    playSpatialSound(SFX.doorOpen, door.position.x, door.position.z, 0.8);
    // Enemy waits for door to open
    e.userData.aiState = AI.DOOR_WAIT;
    e.userData.doorWaitTimer = 1.0;
    e.userData.doorWaitX = gx;
    e.userData.doorWaitZ = gz;
    return true;
}

// ─── Door System ────────────────────────────────

function tryOpenDoor() {
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const checkX = camera.position.x + fwd.x * 2;
    const checkZ = camera.position.z + fwd.z * 2;

    for (const door of levelDoors) {
        const dx = checkX - door.position.x;
        const dz = checkZ - door.position.z;
        if (Math.abs(dx) < CELL && Math.abs(dz) < CELL && !door.userData.open && !door.userData.opening) {
            const dt = door.userData.doorType;

            // Check key requirements
            if (dt === 'gold' && !state.keys.gold) {
                showNotification('You need a gold key!');
                return;
            }
            if (dt === 'silver' && !state.keys.silver) {
                showNotification('You need a silver key!');
                return;
            }

            door.userData.opening = true;
            playSpatialSound(SFX.doorOpen, door.position.x, door.position.z, 0.8);
        }
    }
}

let notificationText = '';
let notificationTimer = 0;

function showNotification(text) {
    notificationText = text;
    notificationTimer = 2;
}

// ─── Shooting ───────────────────────────────────

function getWeaponFireRate() {
    switch (state.weapon) {
        case 'chaingun': return 0.12;
        case 'machinegun': return 0.2;
        default: return 0.4;
    }
}

function getWeaponSound() {
    switch (state.weapon) {
        case 'chaingun': return SFX.chaingunFire;
        case 'machinegun': return SFX.machinegunFire;
        default: return SFX.pistolFire;
    }
}

function shoot() {
    if (state.shootCooldown > 0 || state.ammo <= 0 || gameOver) return;
    state.ammo--;
    state.shootCooldown = getWeaponFireRate();
    weaponFiring = true;
    setTimeout(() => { weaponFiring = false; }, 90);

    playSound(getWeaponSound(), 0.7);

    // Raycast hit check
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    let closestHit = null, closestDist = Infinity;

    for (const e of levelEnemies) {
        if (!e.userData.alive) continue;
        const d = camera.position.distanceTo(e.position);
        if (d > 25 || d >= closestDist) continue;
        const dir = new THREE.Vector3().subVectors(e.position, camera.position).normalize();
        const dotThreshold = Math.max(0.92, 0.98 - (1 / (d + 1)) * 0.1);
        if (dir.dot(camDir) > dotThreshold && hasLineOfSight(camera.position.x, camera.position.z, e.position.x, e.position.z)) {
            closestDist = d;
            closestHit = e;
        }
    }

    if (closestHit) {
        const e = closestHit;
        const td = e.userData.typeDef;
        let damage;
        switch (state.weapon) {
            case 'chaingun': damage = 15 + Math.floor(Math.random() * 15); break;
            case 'machinegun': damage = 10 + Math.floor(Math.random() * 12); break;
            default: damage = 15 + Math.floor(Math.random() * 10); break;
        }
        e.userData.health -= damage;
        if (e.userData.health <= 0) {
            killEnemy(e);
        } else {
            // Flash hit indicator
            e.material.color.set(0xffffff);
            setTimeout(() => {
                if (e.userData.alive && td.tint) e.material.color.copy(td.tint);
                else if (e.userData.alive) e.material.color.set(0xffffff);
            }, 100);

            // Bosses ignore pain — keep attacking
            if (td.noPain) {
                if (!e.userData.alerted) {
                    e.userData.alerted = true;
                    e.userData.aiState = AI.CHASE;
                    e.userData.lastSeenX = camera.position.x;
                    e.userData.lastSeenZ = camera.position.z;
                }
            } else {
                // Normal enemies enter pain state
                e.userData.aiState = AI.PAIN;
                e.userData.painTimer = 0.3 + Math.random() * 0.2;
                if (!e.userData.alerted) {
                    e.userData.alerted = true;
                }
            }
        }
        alertNearbyEnemies(e.position.x, e.position.z, 15);
    }
    alertNearbyEnemies(camera.position.x, camera.position.z, 12);
}

function killEnemy(e) {
    const td = e.userData.typeDef;
    e.userData.alive = false;
    e.userData.aiState = AI.DYING;
    e.userData.deathFrame = 0;
    e.userData.deathFrameTimer = 0.12; // first frame hold time
    e.userData.attackPhase = 'none';
    e.userData.attackTimer = 0;
    e.userData.attackDidFire = false;
    const deathSnd = Array.isArray(td.deathSfx)
        ? td.deathSfx[Math.floor(Math.random() * td.deathSfx.length)]
        : td.deathSfx;
    playSpatialSound(deathSnd, e.position.x, e.position.z, 0.8);
    setEnemyDeathFrame(e, 0);
    e.material.color.set(0xffffff);
    if (td.tint) e.material.color.copy(td.tint);
    state.score += td.score;

    // Drop ammo
    if (Math.random() < 0.5 && e.userData.enemyType !== 'dog') {
        const mat = new THREE.SpriteMaterial({ map: spriteTile(12, 3), transparent: true, alphaTest: 0.5 });
        const pickup = new THREE.Sprite(mat);
        pickup.center.set(0.5, 0);
        pickup.position.set(e.position.x, 0.02, e.position.z);
        pickup.scale.set(0.66, 0.66, 1);
        pickup.userData = { isPickup: true, pickupType: 'ammo', collected: false };
        scene.add(pickup);
        levelPickups.push(pickup);
    }
}

function alertNearbyEnemies(wx, wz, radius) {
    // Use BFS sound propagation — alerts through open doors
    alertEnemiesBySound(wx, wz, radius);
}

// ─── Enemy AI ───────────────────────────────────

function updateEnemySprite(e) {
    const ai = e.userData.aiState;
    if (ai === AI.DEAD) {
        setEnemyDeathFrame(e, guardDeathFrames.length - 1);
        return;
    }

    if (ai === AI.DYING) {
        setEnemyDeathFrame(e, e.userData.deathFrame || 0);
        return;
    }

    if (ai === AI.ATTACK) {
        const tex = e.userData.attackPhase === 'fire' ? guardShootFireTex : guardShootAimTex;
        setEnemyTexture(e, tex);
        return;
    }

    if (ai === AI.PAIN) {
        setEnemyTexture(e, guardPainTex);
        return;
    }

    if (!e.userData.alive) return;

    // Determine the enemy's movement/facing angle
    let enemyFacing = e.userData.patrolAngle || 0;
    if (ai === AI.CHASE || ai === AI.INVESTIGATE || ai === AI.DODGE || ai === AI.DOOR_WAIT) {
        // Facing toward target (player or investigate point)
        const tx = (ai === AI.INVESTIGATE) ? (e.userData.investigateX || camera.position.x) : camera.position.x;
        const tz = (ai === AI.INVESTIGATE) ? (e.userData.investigateZ || camera.position.z) : camera.position.z;
        enemyFacing = Math.atan2(tx - e.position.x, tz - e.position.z);
    }

    // Camera-to-enemy angle (from camera's perspective looking at the enemy)
    const cameraToEnemy = Math.atan2(e.position.x - camera.position.x, e.position.z - camera.position.z);
    // Relative angle: difference between the direction enemy faces and the camera's view angle
    const relAngle = normalizeAngle(enemyFacing - cameraToEnemy);

    // Map to 8-directional frame (0 = facing camera, 4 = facing away)
    let frame = Math.round((relAngle + Math.PI) / (2 * Math.PI) * 8) % 8;

    let frameRow = 0;
    if (ai === AI.CHASE || ai === AI.PATROL || ai === AI.INVESTIGATE || ai === AI.DODGE) {
        frameRow = 1 + (Math.floor(e.userData.walkFrame) % 4);
    } else if (ai === AI.DOOR_WAIT) {
        frameRow = 0;
    }

    const tex = guardFrames[Math.min(frameRow * 8 + frame, guardFrames.length - 1)];
    setEnemyTexture(e, tex);
}

// Move enemy toward world position using A* pathfinding
function moveEnemyToward(e, targetX, targetZ, dt) {
    const td = e.userData.typeDef;
    const speed = td.speed * dt;

    // Direct movement first — if clear line
    const ddx = targetX - e.position.x, ddz = targetZ - e.position.z;
    const dDist = Math.sqrt(ddx * ddx + ddz * ddz);

    if (dDist < 0.5) return true; // arrived

    const dirX = ddx / dDist, dirZ = ddz / dDist;
    const nx = e.position.x + dirX * speed;
    const nz = e.position.z + dirZ * speed;

    // Try direct movement
    if (!isBlocked(nx, nz)) {
        e.position.x = nx; e.position.z = nz;
        return false;
    }

    // Direct blocked — check if blocked by a door and try to open it
    const nextGX = Math.floor(nx / CELL), nextGZ = Math.floor(nz / CELL);
    const doorAhead = getDoorAt(nextGX, nextGZ);
    if (doorAhead && !doorAhead.userData.open && !doorAhead.userData.opening) {
        if (enemyTryOpenDoor(e, nextGX, nextGZ)) return false;
    }

    // Try axis-sliding
    if (!isBlocked(nx, e.position.z)) { e.position.x = nx; return false; }
    if (!isBlocked(e.position.x, nz)) { e.position.z = nz; return false; }

    // Fully blocked — use A* pathfinding
    const path = findPath(e.position.x, e.position.z, targetX, targetZ);
    if (path && path.length > 0) {
        const nextCell = path[0];
        const cellWX = nextCell.x * CELL + CELL / 2;
        const cellWZ = nextCell.z * CELL + CELL / 2;

        // Check if next cell has a closed door
        const doorInPath = getDoorAt(nextCell.x, nextCell.z);
        if (doorInPath && !doorInPath.userData.open && !doorInPath.userData.opening) {
            if (enemyTryOpenDoor(e, nextCell.x, nextCell.z)) return false;
        }

        const pdx = cellWX - e.position.x, pdz = cellWZ - e.position.z;
        const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
        if (pDist > 0.1) {
            const pmx = e.position.x + (pdx / pDist) * speed;
            const pmz = e.position.z + (pdz / pDist) * speed;
            if (!isBlocked(pmx, pmz)) { e.position.x = pmx; e.position.z = pmz; }
            else if (!isBlocked(pmx, e.position.z)) { e.position.x = pmx; }
            else if (!isBlocked(e.position.x, pmz)) { e.position.z = pmz; }
        }
    } else {
        // Bug F fix: Fallback when A* returns no path — try random perpendicular movement
        const perpAngle = Math.atan2(dirX, dirZ) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const fx = e.position.x + Math.sin(perpAngle) * speed;
        const fz = e.position.z + Math.cos(perpAngle) * speed;
        if (!isBlocked(fx, fz)) { e.position.x = fx; e.position.z = fz; }
    }
    return false;
}

function updateEnemies(dt) {
    // Clear pathfinding cache each frame
    _pathCacheFrame++;
    if (_pathCacheFrame % 15 === 0) _pathCache.clear(); // clear every 15 frames

    for (const e of levelEnemies) {
        if (e.userData.aiState === AI.DEAD) {
            setEnemyDeathFrame(e, guardDeathFrames.length - 1);
            continue;
        }

        if (e.userData.aiState === AI.DYING) {
            e.userData.deathFrameTimer -= dt;
            if (e.userData.deathFrameTimer <= 0) {
                if (e.userData.deathFrame < guardDeathFrames.length - 1) {
                    e.userData.deathFrame++;
                    e.userData.deathFrameTimer = 0.12;
                } else {
                    e.userData.aiState = AI.DEAD;
                }
            }
            updateEnemySprite(e);
            continue;
        }

        if (!e.userData.alive) continue;

        const td = e.userData.typeDef;
        const dx = camera.position.x - e.position.x;
        const dz = camera.position.z - e.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Track position before update — walk animation only advances when actually moving
        const prevX = e.position.x, prevZ = e.position.z;

        // ── Check for player visibility (shared across states) ──
        const canSee = dist < td.alertDist && hasLineOfSight(e.position.x, e.position.z, camera.position.x, camera.position.z);

        switch (e.userData.aiState) {

            // ════════ STAND — idle, looking for player ════════
            case AI.STAND: {
                if (canSee && dist < td.alertDist) {
                    e.userData.alerted = true;
                    // Mutants skip alert pause — fire instantly
                    if (td.silent) {
                        e.userData.aiState = AI.CHASE;
                        e.userData.lastSeenX = camera.position.x;
                        e.userData.lastSeenZ = camera.position.z;
                    } else {
                        e.userData.aiState = AI.ALERT;
                        e.userData.alertTimer = 0.3 + Math.random() * 0.3;
                        playSpatialSound(td.alertSfx, e.position.x, e.position.z, 0.6);
                    }
                } else {
                    e.userData.patrolTimer -= dt;
                    if (e.userData.patrolTimer <= 0) {
                        e.userData.patrolTimer = 3 + Math.random() * 4;
                        e.userData.aiState = AI.PATROL;
                        e.userData.patrolAngle = Math.random() * Math.PI * 2;
                    }
                }
                break;
            }

            // ════════ PATROL — wandering ════════
            case AI.PATROL: {
                const speed = td.speed * 0.4 * dt;
                const nx = e.position.x + Math.sin(e.userData.patrolAngle) * speed;
                const nz = e.position.z + Math.cos(e.userData.patrolAngle) * speed;
                if (!isBlocked(nx, nz)) { e.position.x = nx; e.position.z = nz; }
                else { e.userData.patrolAngle += Math.PI * 0.5 + Math.random() * Math.PI; }
                e.userData.patrolTimer -= dt;
                if (e.userData.patrolTimer <= 0) {
                    e.userData.aiState = AI.STAND;
                    e.userData.patrolTimer = 2 + Math.random() * 3;
                }
                if (canSee && dist < td.alertDist) {
                    e.userData.alerted = true;
                    if (td.silent) {
                        e.userData.aiState = AI.CHASE;
                        e.userData.lastSeenX = camera.position.x;
                        e.userData.lastSeenZ = camera.position.z;
                    } else {
                        e.userData.aiState = AI.ALERT;
                        e.userData.alertTimer = 0.2 + Math.random() * 0.3;
                        playSpatialSound(td.alertSfx, e.position.x, e.position.z, 0.6);
                    }
                }
                break;
            }

            // ════════ ALERT — just spotted player, brief pause ════════
            case AI.ALERT: {
                e.userData.alertTimer -= dt;
                if (e.userData.alertTimer <= 0) {
                    e.userData.aiState = AI.CHASE;
                    e.userData.lastSeenX = camera.position.x;
                    e.userData.lastSeenZ = camera.position.z;
                }
                break;
            }

            // ════════ INVESTIGATE — heard a sound, moving to source ════════
            case AI.INVESTIGATE: {
                const ix = e.userData.investigateX || 0;
                const iz = e.userData.investigateZ || 0;
                const iDist = Math.sqrt((ix - e.position.x) ** 2 + (iz - e.position.z) ** 2);

                // If player seen during investigation, switch to chase
                if (canSee) {
                    e.userData.aiState = AI.CHASE;
                    e.userData.lastSeenX = camera.position.x;
                    e.userData.lastSeenZ = camera.position.z;
                    if (!td.silent) {
                        playSpatialSound(td.alertSfx, e.position.x, e.position.z, 0.6);
                    }
                    break;
                }

                // Move toward sound source
                if (iDist > 2) {
                    moveEnemyToward(e, ix, iz, dt);
                }

                e.userData.investigateTimer -= dt;
                if (e.userData.investigateTimer <= 0 || iDist < 2) {
                    // Done investigating — go back to patrolling
                    e.userData.aiState = AI.STAND;
                    e.userData.patrolTimer = 1 + Math.random() * 2;
                }
                break;
            }

            // ════════ CHASE — pursuing the player ════════
            case AI.CHASE: {
                if (canSee) {
                    e.userData.lastSeenX = camera.position.x;
                    e.userData.lastSeenZ = camera.position.z;
                    e.userData.lostSightTimer = 0;
                }

                const tx = canSee ? camera.position.x : e.userData.lastSeenX;
                const tz = canSee ? camera.position.z : e.userData.lastSeenZ;
                const tDist = Math.sqrt((tx - e.position.x) ** 2 + (tz - e.position.z) ** 2);

                // Attack decision — can we shoot?
                if (canSee && dist < td.shootDist) {
                    e.userData.shootCooldown -= dt;
                    if (e.userData.shootCooldown <= 0) {
                        startEnemyAttack(e);
                        e.userData.shootCooldown = td.cooldown[0] + Math.random() * (td.cooldown[1] - td.cooldown[0]);
                        break;
                    }
                }

                // Movement — dogs rush straight, others keep minimum distance
                const minDist = td.rushes ? 0.5 : (td.melee ? 1.0 : 3.0);
                if (tDist > minDist) {
                    moveEnemyToward(e, tx, tz, dt);
                }
                // Officers/SS dodge sideways after shooting
                else if (td.dodges && canSee && Math.random() < 0.02) {
                    e.userData.aiState = AI.DODGE;
                    e.userData.dodgeTimer = 0.5 + Math.random() * 0.5;
                    e.userData.dodgeDir = Math.random() < 0.5 ? 1 : -1;
                }

                // Lost sight of player — investigate last known position
                if (!canSee) {
                    e.userData.lostSightTimer = (e.userData.lostSightTimer || 0) + dt;
                    if (tDist < 2 || e.userData.lostSightTimer > 5) {
                        e.userData.aiState = AI.INVESTIGATE;
                        e.userData.investigateX = e.userData.lastSeenX;
                        e.userData.investigateZ = e.userData.lastSeenZ;
                        e.userData.investigateTimer = 3;
                    }
                }
                break;
            }

            // ════════ DODGE — strafe sideways (officers, SS) ════════
            case AI.DODGE: {
                const perpX = -dz / (dist || 1) * e.userData.dodgeDir;
                const perpZ = dx / (dist || 1) * e.userData.dodgeDir;
                const speed = td.speed * 0.8 * dt;
                const nx = e.position.x + perpX * speed;
                const nz = e.position.z + perpZ * speed;
                if (!isBlocked(nx, nz)) { e.position.x = nx; e.position.z = nz; }
                else { e.userData.dodgeDir *= -1; } // reverse direction if hit wall

                e.userData.dodgeTimer -= dt;
                if (e.userData.dodgeTimer <= 0) {
                    e.userData.aiState = AI.CHASE;
                }
                // Can still shoot while dodging
                if (canSee && dist < td.shootDist) {
                    e.userData.shootCooldown -= dt;
                    if (e.userData.shootCooldown <= 0) {
                        startEnemyAttack(e);
                        e.userData.shootCooldown = td.cooldown[0] + Math.random() * (td.cooldown[1] - td.cooldown[0]);
                        break;
                    }
                }
                break;
            }

            // ════════ ATTACK — fire at player ════════
            case AI.ATTACK: {
                e.userData.attackTimer -= dt;
                if (e.userData.attackPhase === 'aim' && e.userData.attackTimer <= 0) {
                    e.userData.attackPhase = 'fire';
                    e.userData.attackTimer = 0.2; // hold fire frame visible
                    if (!e.userData.attackDidFire) {
                        enemyFireAtPlayer(e, dist);
                        e.userData.attackDidFire = true;
                    }
                } else if (e.userData.attackPhase === 'fire' && e.userData.attackTimer <= 0) {
                    finishEnemyAttack(e);
                }
                break;
            }

            // ════════ DOOR_WAIT — waiting for door to open ════════
            case AI.DOOR_WAIT: {
                e.userData.doorWaitTimer -= dt;
                const door = getDoorAt(e.userData.doorWaitX, e.userData.doorWaitZ);
                if (!door || door.userData.open || e.userData.doorWaitTimer <= 0) {
                    // Door is open or timeout — resume chase
                    e.userData.aiState = e.userData.alerted ? AI.CHASE : AI.PATROL;
                }
                break;
            }

            // ════════ PAIN — hit reaction (bosses skip this) ════════
            case AI.PAIN: {
                // Frozen in place during pain
                e.userData.painTimer -= dt;
                if (e.userData.painTimer <= 0) {
                    e.userData.aiState = AI.CHASE;
                    e.userData.lastSeenX = camera.position.x;
                    e.userData.lastSeenZ = camera.position.z;
                }
                break;
            }
        }

        // Walk animation: only advance when enemy actually moved (Bug B fix)
        const movedDist = Math.abs(e.position.x - prevX) + Math.abs(e.position.z - prevZ);
        if (movedDist > 0.001 && e.userData.aiState !== AI.ATTACK && e.userData.aiState !== AI.PAIN) {
            e.userData.walkTimer += dt;
            if (e.userData.walkTimer > 0.15) { e.userData.walkTimer = 0; e.userData.walkFrame++; }
        } else {
            // Not moving — reset walk timer but keep frame for idle-walk appearance
            e.userData.walkTimer = 0;
        }

        updateEnemySprite(e);
    }
}

// ─── Pickup Collection ──────────────────────────

function checkPickups() {
    function keepPickup(p) {
        p.userData.collected = false;
        scene.add(p);
    }

    for (const p of levelPickups) {
        if (p.userData.collected) continue;
        if (camera.position.distanceTo(p.position) < 1.2) {
            p.userData.collected = true;
            scene.remove(p);
            const t = p.userData.pickupType;
            switch (t) {
                case 'health':
                    if (state.health >= MAX_HEALTH) { keepPickup(p); continue; }
                    state.health = Math.min(MAX_HEALTH, state.health + 25);
                    playSound(SFX.pickupHealth, 0.5); break;
                case 'food':
                    if (state.health >= MAX_HEALTH) { keepPickup(p); continue; }
                    state.health = Math.min(MAX_HEALTH, state.health + 10);
                    playSound(SFX.pickupFood, 0.5); break;
                case 'ammo':
                    if (state.ammo >= MAX_AMMO) { keepPickup(p); continue; }
                    state.ammo = Math.min(MAX_AMMO, state.ammo + CLIP_AMMO);
                    playSound(SFX.pickupAmmo, 0.5); break;
                case 'machinegun':
                    if (state.ammo >= MAX_AMMO && state.weapon !== 'pistol') { keepPickup(p); continue; }
                    state.ammo = Math.min(MAX_AMMO, state.ammo + CLIP_AMMO);
                    if (state.weapon === 'pistol') state.weapon = 'machinegun';
                    playSound(SFX.pickupWeapon, 0.5); break;
                case 'chaingun':
                    if (state.ammo >= MAX_AMMO && state.weapon === 'chaingun') { keepPickup(p); continue; }
                    state.ammo = Math.min(MAX_AMMO, state.ammo + CLIP_AMMO * 2);
                    state.weapon = 'chaingun';
                    playSound(SFX.pickupWeapon, 0.5); break;
                case 'key1':
                    state.keys.gold = true;
                    playSound(SFX.pickupKey, 0.5); break;
                case 'key2':
                    state.keys.silver = true;
                    playSound(SFX.pickupKey, 0.5); break;
                case 'cross': state.score += 100; playSound(SFX.pickupTreasure, 0.5); break;
                case 'chalice': state.score += 500; playSound(SFX.pickupTreasure, 0.5); break;
                case 'bible': state.score += 1000; playSound(SFX.pickupTreasure, 0.5); break;
                case 'crown': state.score += 5000; playSound(SFX.pickupTreasure, 0.5); break;
                case 'oneup':
                    state.lives++;
                    state.health = MAX_HEALTH;
                    playSound(SFX.pickupHealth, 0.5); break;
            }
        }
    }
}

// ─── Level Transition (Elevator) ────────────────

function checkElevator() {
    // Check if player is on an elevator door that's open
    for (const door of levelDoors) {
        if (door.userData.doorType === 'elevator' && door.userData.open) {
            const dx = camera.position.x - door.position.x;
            const dz = camera.position.z - door.position.z;
            // Check if player walked through (is on the other side)
            if (Math.abs(dx) < CELL * 1.5 && Math.abs(dz) < CELL * 1.5) {
                // Check for exit tiles nearby
                for (const s of levelStatics) {
                    if (s.userData.isExit && camera.position.distanceTo(s.position) < CELL * 2) {
                        nextLevel();
                        return;
                    }
                }
            }
        }
    }
    // Also check if player is standing on an exit tile
    for (const s of levelStatics) {
        if (s.userData.isExit && camera.position.distanceTo(s.position) < 1.5) {
            nextLevel();
            return;
        }
    }
}

function nextLevel() {
    const totalLevels = Object.keys(LEVELS).length;
    const currentGlobal = state.episode * 10 + state.level;
    const nextGlobal = currentGlobal + 1;

    if (!LEVELS[nextGlobal]) {
        showNotification('Congratulations! All levels complete!');
        return;
    }

    state.level++;
    if (state.level >= 10) { state.episode++; state.level = 0; }
    state.keys = { gold: false, silver: false };

    showNotification(`Floor ${state.level + 1}`);
    loadLevel(nextGlobal);
}

// ─── HUD Drawing (Canvas-based authentic Wolf3D HUD) ──────

const hudCanvas = document.getElementById('hud-canvas');
const hCtx = hudCanvas.getContext('2d');
const HUD_NUMBER_Y = 32;
const HUD_LAYOUT = Object.freeze({
    floorX: 48,
    scoreX: 96,
    livesX: 224,
    healthX: 336,
    ammoX: 428,
    faceX: 273,
    faceY: 9,
    faceW: 48,
    faceH: 64,
    keyX: 480,
    keyGoldY: 8,
    keySilverY: 40,
    weaponX: 512,
    weaponY: 16,
    weaponW: 96,
    weaponH: 48,
});

function setNearestFilter(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
}

function getUiPixelRatio() {
    return Math.max(1, Math.round(window.devicePixelRatio || 1));
}

let uiPixelRatio = getUiPixelRatio();
let hudRenderScale = 1;

function resizeHudCanvas() {
    const cssW = HUD_BASE_W * hudScale;
    const cssH = HUD_BASE_H * hudScale;
    uiPixelRatio = getUiPixelRatio();
    const pixelW = cssW * uiPixelRatio;
    const pixelH = cssH * uiPixelRatio;
    if (hudCanvas.width !== pixelW || hudCanvas.height !== pixelH) {
        hudCanvas.width = pixelW;
        hudCanvas.height = pixelH;
    }
    hudCanvas.style.width = `${cssW}px`;
    hudCanvas.style.height = `${cssH}px`;
    hudRenderScale = hudScale * uiPixelRatio;
    setNearestFilter(hCtx);
}

setNearestFilter(hCtx);

const hudBgImg = new Image(); hudBgImg.src = '/textures/hudbg.png';
const bjImg = new Image(); bjImg.src = '/textures/bj.png';
const hudNumImg = new Image(); hudNumImg.src = '/textures/hudnumbers.png';
const hudKeyImg = new Image(); hudKeyImg.src = '/textures/hudkeys.png';
const hudWeapImg = new Image(); hudWeapImg.src = '/textures/hudweapons.png';

function drawHUD() {
    const W = HUD_BASE_W, H = HUD_BASE_H;
    hCtx.setTransform(1, 0, 0, 1, 0, 0);
    hCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    hCtx.setTransform(hudRenderScale, 0, 0, hudRenderScale, 0, 0);
    hCtx.clearRect(0, 0, W, H);

    // Draw HUD background
    if (hudBgImg.complete) {
        hCtx.drawImage(hudBgImg, 0, 0, W, H);
    } else {
        hCtx.fillStyle = '#1a1a4a';
        hCtx.fillRect(0, 0, W, H);
    }

    function drawNumber(num, x, digits = 3) {
        let value = Math.max(0, Math.floor(num));
        const numW = hudNumImg.naturalWidth / 10;
        const numH = hudNumImg.naturalHeight;
        for (let i = digits - 1; i >= 0; i--) {
            if (value === 0 && i < digits - 1) continue;
            const d = value % 10;
            if (hudNumImg.complete && numW > 0) {
                hCtx.drawImage(hudNumImg, d * numW, 0, numW, numH, x + i * numW, HUD_NUMBER_Y, numW, numH);
            } else {
                hCtx.fillStyle = '#fff';
                hCtx.font = 'bold 24px monospace';
                hCtx.fillText(String(d), x + i * 16, HUD_NUMBER_Y + 24);
            }
            value = Math.floor(value / 10);
        }
    }

    // FLOOR number (episode * 10 + level + 1)
    drawNumber(state.episode * 10 + state.level + 1, HUD_LAYOUT.floorX, 2);

    // SCORE
    drawNumber(state.score, HUD_LAYOUT.scoreX, 6);

    // LIVES
    drawNumber(state.lives, HUD_LAYOUT.livesX, 1);

    // BJ Face — health determines which face to show
    if (bjImg.complete && bjImg.naturalWidth > 0) {
        const healthPct = Math.max(0, state.health) / MAX_HEALTH;
        const healthRow = Math.min(7, Math.floor((1 - healthPct) * 8));
        const faceIdx = healthRow * 3 + 1; // center face
        const srcFaceW = bjImg.naturalWidth / 24;
        const srcFaceH = bjImg.naturalHeight;
        hCtx.drawImage(
            bjImg,
            faceIdx * srcFaceW, 0, srcFaceW, srcFaceH,
            HUD_LAYOUT.faceX, HUD_LAYOUT.faceY, HUD_LAYOUT.faceW, HUD_LAYOUT.faceH
        );
    }

    // HEALTH %
    drawNumber(state.health, HUD_LAYOUT.healthX, 3);

    // AMMO
    drawNumber(state.ammo, HUD_LAYOUT.ammoX, 3);

    // Keys
    if (hudKeyImg.complete && hudKeyImg.naturalWidth > 0) {
        const keyW = hudKeyImg.naturalWidth / 2;
        const keyH = hudKeyImg.naturalHeight;
        if (state.keys.gold) {
            hCtx.drawImage(hudKeyImg, 0, 0, keyW, keyH, HUD_LAYOUT.keyX, HUD_LAYOUT.keyGoldY, keyW, keyH);
        }
        if (state.keys.silver) {
            hCtx.drawImage(hudKeyImg, keyW, 0, keyW, keyH, HUD_LAYOUT.keyX, HUD_LAYOUT.keySilverY, keyW, keyH);
        }
    }

    // Weapon icon
    if (hudWeapImg.complete && hudWeapImg.naturalWidth > 0) {
        let weapIdx = 1; // pistol
        if (state.weapon === 'machinegun') weapIdx = 2;
        else if (state.weapon === 'chaingun') weapIdx = 3;
        const ww = hudWeapImg.naturalWidth / 4;
        const wh = hudWeapImg.naturalHeight;
        hCtx.drawImage(
            hudWeapImg,
            weapIdx * ww, 0, ww, wh,
            HUD_LAYOUT.weaponX, HUD_LAYOUT.weaponY, HUD_LAYOUT.weaponW, HUD_LAYOUT.weaponH
        );
    }

    // Notification
    if (notificationTimer > 0) {
        hCtx.fillStyle = '#ffcc00';
        hCtx.font = 'bold 14px monospace';
        hCtx.textAlign = 'center';
        hCtx.fillText(notificationText, 320, 12);
        hCtx.textAlign = 'left';
    }
}

// ─── Weapon Display ─────────────────────────────
const WEAPON_FRAME_SIZE = 256;
const weaponFrameBase = {
    pistol: 4,
    machinegun: 8,
    chaingun: 12,
};

const weaponCanvas = document.createElement('canvas');
weaponCanvas.width = WEAPON_FRAME_SIZE;
weaponCanvas.height = WEAPON_FRAME_SIZE;
weaponCanvas.id = 'weapon';
document.body.appendChild(weaponCanvas);
const wCtx = weaponCanvas.getContext('2d');
setNearestFilter(wCtx);
const attackImg = new Image(); attackImg.src = '/textures/attack.png';
let weaponFiring = false;
let weaponBaseBottom = HUD_BASE_H - 2;
let weaponDisplayScale = 1;
let weaponRenderScale = 1;

function resizeWeaponCanvas() {
    const cssW = WEAPON_FRAME_SIZE * weaponDisplayScale;
    const cssH = WEAPON_FRAME_SIZE * weaponDisplayScale;
    const pixelW = cssW * uiPixelRatio;
    const pixelH = cssH * uiPixelRatio;
    if (weaponCanvas.width !== pixelW || weaponCanvas.height !== pixelH) {
        weaponCanvas.width = pixelW;
        weaponCanvas.height = pixelH;
    }
    weaponCanvas.style.width = `${cssW}px`;
    weaponCanvas.style.height = `${cssH}px`;
    weaponRenderScale = weaponDisplayScale * uiPixelRatio;
    setNearestFilter(wCtx);
}

function getWeaponFrameIndex() {
    const base = weaponFrameBase[state.weapon] ?? weaponFrameBase.pistol;
    return weaponFiring ? base + 2 : base;
}

function drawWeapon() {
    wCtx.setTransform(1, 0, 0, 1, 0, 0);
    wCtx.clearRect(0, 0, weaponCanvas.width, weaponCanvas.height);
    wCtx.setTransform(weaponRenderScale, 0, 0, weaponRenderScale, 0, 0);

    if (attackImg.complete && attackImg.naturalWidth >= WEAPON_FRAME_SIZE * 16) {
        const frameIdx = getWeaponFrameIndex();
        wCtx.drawImage(
            attackImg,
            frameIdx * WEAPON_FRAME_SIZE, 0, WEAPON_FRAME_SIZE, WEAPON_FRAME_SIZE,
            0, 0, WEAPON_FRAME_SIZE, WEAPON_FRAME_SIZE
        );
    }
}

function placeWeaponSprite(bobX = 0, bobY = 0) {
    const cssWidth = parseInt(weaponCanvas.style.width || `${weaponCanvas.width}`, 10) || weaponCanvas.width;
    const centeredLeft = (window.innerWidth - cssWidth) / 2;
    weaponCanvas.style.left = `${Math.floor(centeredLeft + bobX * weaponDisplayScale)}px`;
    weaponCanvas.style.bottom = `${Math.round(weaponBaseBottom + bobY * weaponDisplayScale)}px`;
}

function computeHudScale() {
    const maxByWidth = Math.max(1, Math.floor(window.innerWidth / HUD_BASE_W));
    const maxByHeight = Math.max(1, Math.floor(window.innerHeight / HUD_BASE_H));
    let scale = Math.min(HUD_MAX_SCALE, maxByWidth, maxByHeight);
    while (scale > 1 && window.innerHeight - HUD_BASE_H * scale < MIN_VIEWPORT_HEIGHT) {
        scale--;
    }
    return Math.max(1, scale);
}

function computeWeaponScale() {
    const maxByWidth = Math.max(1, Math.floor(window.innerWidth / WEAPON_FRAME_SIZE));
    const maxByHeight = Math.max(1, Math.floor((window.innerHeight - hudPixelHeight + 96) / WEAPON_FRAME_SIZE));
    return Math.max(1, Math.min(3, hudScale, maxByWidth, maxByHeight));
}

function applyViewportLayout() {
    hudScale = computeHudScale();
    hudPixelHeight = HUD_BASE_H * hudScale;

    resizeHudCanvas();
    hudCanvas.style.left = `${Math.floor((window.innerWidth - HUD_BASE_W * hudScale) / 2)}px`;

    weaponDisplayScale = computeWeaponScale();
    resizeWeaponCanvas();
    weaponBaseBottom = hudPixelHeight - Math.max(2, weaponDisplayScale);
    placeWeaponSprite(0, 0);

    const viewportHeight = Math.max(MIN_VIEWPORT_HEIGHT, window.innerHeight - hudPixelHeight);
    renderer.setSize(window.innerWidth, viewportHeight);
    camera.aspect = window.innerWidth / viewportHeight;
    camera.updateProjectionMatrix();
}

applyViewportLayout();

// ─── Input ──────────────────────────────────────
const keys = {};
let pointerLocked = false;
let yaw = Math.PI, pitch = 0;
let mouseDown = false;

document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('click', () => {
    if (!pointerLocked) {
        renderer.domElement.requestPointerLock();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }
    if (gameOver && !pointerLocked) restartGame();
});
document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    document.getElementById('instructions').style.display = pointerLocked ? 'none' : 'flex';
});
document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw -= e.movementX * state.mouseSensitivity;
    pitch -= e.movementY * state.mouseSensitivity;
    pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
});
document.addEventListener('mousedown', e => {
    if (pointerLocked && e.button === 0) { mouseDown = true; shoot(); }
});
document.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', e => {
    if (e.code === 'KeyM') {
        state.minimapVisible = !state.minimapVisible;
        document.getElementById('minimap').style.display = state.minimapVisible ? 'block' : 'none';
    }
    if (e.code === 'KeyE' || e.code === 'Space') tryOpenDoor();
});

// ─── Minimap ────────────────────────────────────
const mmCanvas = document.getElementById('minimap');
const mCtx = mmCanvas.getContext('2d');

function drawMinimap() {
    mCtx.fillStyle = '#000';
    mCtx.fillRect(0, 0, 200, 200);
    if (!levelWalls) return;

    // Center minimap on player
    const pgx = camera.position.x / CELL;
    const pgz = camera.position.z / CELL;
    const viewR = 16; // cells visible in each direction
    const mmS = 200 / (viewR * 2);

    for (let dy = -viewR; dy < viewR; dy++) {
        for (let dx = -viewR; dx < viewR; dx++) {
            const gx = Math.floor(pgx) + dx;
            const gz = Math.floor(pgz) + dy;
            if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) continue;
            const w = levelWalls[gz * MAP_SIZE + gx];
            const sx = (dx + viewR) * mmS;
            const sy = (dy + viewR) * mmS;
            if (w > 0) mCtx.fillStyle = '#777';
            else if (w === -1) mCtx.fillStyle = '#5AA';
            else mCtx.fillStyle = '#333';
            mCtx.fillRect(sx, sy, mmS + 0.5, mmS + 0.5);
        }
    }

    // Enemies
    for (const e of levelEnemies) {
        if (!e.userData.alive) continue;
        const ex = (e.position.x / CELL - pgx + viewR) * mmS;
        const ez = (e.position.z / CELL - pgz + viewR) * mmS;
        if (ex < 0 || ex > 200 || ez < 0 || ez > 200) continue;
        const et = e.userData.enemyType;
        mCtx.fillStyle = et === 'dog' ? '#c80' : et === 'ss' ? '#888' : et === 'officer' ? '#44f' : et === 'boss' ? '#f0f' : et === 'mutant' ? '#0c0' : '#f00';
        mCtx.fillRect(ex - 2, ez - 2, 4, 4);
    }

    // Player
    const cx = viewR * mmS, cy = viewR * mmS;
    mCtx.fillStyle = '#0f0';
    mCtx.beginPath(); mCtx.arc(cx, cy, 3, 0, Math.PI * 2); mCtx.fill();
    mCtx.strokeStyle = '#0f0'; mCtx.lineWidth = 2;
    mCtx.beginPath(); mCtx.moveTo(cx, cy);
    mCtx.lineTo(cx - Math.sin(yaw) * 8, cy + Math.cos(yaw) * 8); mCtx.stroke();

    mCtx.fillStyle = '#fff'; mCtx.font = '10px monospace';
    mCtx.fillText(`E${state.episode + 1} L${state.level + 1}`, 4, 196);
}

// ─── Death / Restart ────────────────────────────
let gameOver = false;

function checkGameOver() {
    if (state.health <= 0 && !gameOver) {
        gameOver = true;
        document.getElementById('damage-overlay').style.opacity = '0.8';
        document.getElementById('damage-overlay').style.background = 'rgba(139,0,0,0.7)';
        setTimeout(() => {
            const inst = document.getElementById('instructions');
            inst.querySelector('h1').textContent = 'YOU DIED';
            inst.querySelector('h2').textContent = `Score: ${state.score} | Floor: ${state.episode * 10 + state.level + 1}`;
            inst.querySelector('.start-msg').textContent = '[ Click to Restart ]';
            document.exitPointerLock();
        }, 1000);
    }
}

function restartGame() {
    state.health = MAX_HEALTH; state.ammo = START_AMMO; state.score = 0;
    state.weapon = 'pistol'; state.lives = 3;
    state.keys = { gold: false, silver: false };
    state.episode = 0; state.level = 0;
    state.shootCooldown = 0;
    playerMoveSpeed = 0;
    gameOver = false;

    document.getElementById('damage-overlay').style.opacity = '0';
    document.getElementById('damage-overlay').style.background = 'radial-gradient(ellipse at center, transparent 50%, rgba(139,0,0,0.4) 100%)';
    const inst = document.getElementById('instructions');
    inst.querySelector('h1').textContent = 'WOLFENSTEIN 3D';
    inst.querySelector('h2').textContent = 'Three.js Edition';
    inst.querySelector('.start-msg').textContent = '[ Click to Start ]';

    loadLevel(0);
}

// ─── Init ───────────────────────────────────────
loadLevel(0);

// ─── Game Loop ──────────────────────────────────
const clock = new THREE.Clock();

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (!pointerLocked || gameOver) {
        drawHUD();
        drawWeapon();
        renderer.render(scene, camera);
        return;
    }

    // Movement
    const prevPlayerX = camera.position.x;
    const prevPlayerZ = camera.position.z;
    const speed = state.moveSpeed * (keys['ShiftLeft'] || keys['ShiftRight'] ? state.runMultiplier : 1) * dt;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let mv = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) mv.add(fwd);
    if (keys['KeyS'] || keys['ArrowDown']) mv.sub(fwd);
    if (keys['KeyA'] || keys['ArrowLeft']) mv.sub(right);
    if (keys['KeyD'] || keys['ArrowRight']) mv.add(right);

    if (mv.length() > 0) {
        mv.normalize().multiplyScalar(speed);
        const nx = camera.position.x + mv.x, nz = camera.position.z + mv.z;
        const r = 0.3;
        // X axis collision
        if (!isBlocked(nx + r, camera.position.z) && !isBlocked(nx - r, camera.position.z) &&
            !isBlocked(nx + r, camera.position.z + r) && !isBlocked(nx - r, camera.position.z - r) &&
            !isBlocked(nx + r, camera.position.z - r) && !isBlocked(nx - r, camera.position.z + r))
            camera.position.x = nx;
        // Z axis collision
        if (!isBlocked(camera.position.x, nz + r) && !isBlocked(camera.position.x, nz - r) &&
            !isBlocked(camera.position.x + r, nz + r) && !isBlocked(camera.position.x - r, nz - r) &&
            !isBlocked(camera.position.x + r, nz - r) && !isBlocked(camera.position.x - r, nz + r))
            camera.position.z = nz;

        camera.position.y = EYE_H + Math.sin(clock.elapsedTime * 8) * 0.04;
        placeWeaponSprite(Math.sin(clock.elapsedTime * 8) * 2, Math.abs(Math.sin(clock.elapsedTime * 8)) * 4);
    } else {
        camera.position.y = EYE_H;
        placeWeaponSprite(0, 0);
    }
    const moved = Math.hypot(camera.position.x - prevPlayerX, camera.position.z - prevPlayerZ);
    playerMoveSpeed = dt > 0 ? moved / dt : 0;

    playerLight.position.copy(camera.position);

    // Shoot cooldown + auto-fire
    if (state.shootCooldown > 0) state.shootCooldown -= dt;
    if (mouseDown && (state.weapon === 'machinegun' || state.weapon === 'chaingun') && state.shootCooldown <= 0) shoot();

    // Door animations
    for (const d of levelDoors) {
        if (d.userData.opening && d.userData.openAmount < 1) {
            d.userData.openAmount += dt * 1.5;
            const baseX = d.userData.gridX * CELL + CELL / 2;
            const baseZ = d.userData.gridY * CELL + CELL / 2;
            if (d.userData.vertical)
                d.position.z = baseZ + d.userData.openAmount * DOOR_TRAVEL;
            else
                d.position.x = baseX + d.userData.openAmount * DOOR_TRAVEL;
            if (d.userData.openAmount >= 1) {
                d.userData.open = true;
                d.userData.opening = false;
                d.userData.closeTimer = 0;
            }
        }
        // Auto-close after timeout
        if (d.userData.open) {
            d.userData.closeTimer += dt;
            if (d.userData.closeTimer > 5) {
                // Check if player is in doorway
                const dx = camera.position.x - d.position.x;
                const dz = camera.position.z - d.position.z;
                if (Math.abs(dx) > CELL * 1.2 || Math.abs(dz) > CELL * 1.2) {
                    // Close door
                    d.userData.open = false;
                    d.userData.openAmount = 0;
                    d.userData.closeTimer = 0;
                    d.position.set(d.userData.gridX * CELL + CELL / 2, WALL_H / 2, d.userData.gridY * CELL + CELL / 2);
                    playSpatialSound(SFX.doorClose, d.position.x, d.position.z, 0.6);
                }
            }
        }
    }

    // Notification timer
    if (notificationTimer > 0) notificationTimer -= dt;

    updateEnemies(dt);
    checkPickups();
    checkElevator();
    checkGameOver();
    drawHUD();
    drawWeapon();
    if (state.minimapVisible) drawMinimap();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    applyViewportLayout();
});

gameLoop();
