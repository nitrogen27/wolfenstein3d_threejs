// Node.js script to decode Wolf3D map data from jseidelin/wolf3d format
// Outputs decoded level data as a JS module

import { readFileSync, writeFileSync } from 'fs';

// Read maps.js and extract the MapData object
const mapsContent = readFileSync('/tmp/wolf3d_maps.js', 'utf-8');
const match = mapsContent.match(/Wolf\.MapData\s*=\s*(\{.*\})/s);
if (!match) { console.error('Could not find MapData'); process.exit(1); }
const mapData = JSON.parse(match[1]);

const MAPHEADER_SIZE = 49;
const MAP_SIGNATURE = 0x21444921;

function base64ToBytes(b64) {
    const bin = Buffer.from(b64, 'base64');
    return new Uint8Array(bin);
}

function readUInt8(data, pos) { return data[pos]; }
function readUInt16(data, pos) { return data[pos] | (data[pos+1] << 8); }
function readUInt32(data, pos) { return data[pos] | (data[pos+1] << 8) | (data[pos+2] << 16) | ((data[pos+3] << 24) >>> 0); }
function readString(data, pos, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(data[pos+i]);
    return s;
}

function carmackExpand(source, length) {
    const NEARTAG = 0xA7, FARTAG = 0xA8;
    let inptr = 0, outptr = 0;
    const dest = [];
    length = Math.floor(length / 2);

    while (length > 0) {
        const ch = source[inptr] + (source[inptr+1] << 8);
        inptr += 2;
        const chhigh = ch >> 8;

        if (chhigh === NEARTAG) {
            const count = ch & 0xff;
            if (!count) {
                dest[outptr++] = ch | source[inptr++];
                length--;
            } else {
                const offset = source[inptr++];
                let copyptr = outptr - offset;
                length -= count;
                for (let i = 0; i < count; i++) dest[outptr++] = dest[copyptr++];
            }
        } else if (chhigh === FARTAG) {
            const count = ch & 0xff;
            if (!count) {
                dest[outptr++] = ch | source[inptr++];
                length--;
            } else {
                const offset = source[inptr] + (source[inptr+1] << 8);
                inptr += 2;
                let copyptr = offset;
                length -= count;
                for (let i = 0; i < count; i++) dest[outptr++] = dest[copyptr++];
            }
        } else {
            dest[outptr++] = ch;
            length--;
        }
    }
    return dest;
}

function rlewExpand(source, length, rlewtag) {
    let inptr = 0, outptr = 0;
    const dest = [];
    const end = Math.floor(length / 2);

    while (outptr < end) {
        const value = source[inptr++];
        if (value !== rlewtag) {
            dest[outptr++] = value;
        } else {
            const count = source[inptr++];
            const fillVal = source[inptr++];
            for (let i = 0; i < count; i++) dest[outptr++] = fillVal;
        }
    }
    return dest;
}

function readPlaneData(data, offset, length, rle) {
    const expandedLength = readUInt16(data, offset);
    const carmackData = data.slice(offset + 2, offset + length);
    const expandedData = carmackExpand(carmackData, expandedLength);
    return rlewExpand(expandedData.slice(1), 64*64*2, rle);
}

function decodeMap(name, b64data) {
    const data = base64ToBytes(b64data);

    if (data.length < MAPHEADER_SIZE) return null;
    if (readUInt32(data, 0) !== MAP_SIGNATURE) return null;

    const rle = readUInt16(data, 4);
    const width = readUInt16(data, 6);
    const height = readUInt16(data, 8);
    const ceiling = [readUInt8(data, 10), readUInt8(data, 11), readUInt8(data, 12), readUInt8(data, 13)];
    const floor = [readUInt8(data, 14), readUInt8(data, 15), readUInt8(data, 16), readUInt8(data, 17)];

    const lengths = [readUInt16(data, 18), readUInt16(data, 20), readUInt16(data, 22)];
    const offsets = [readUInt32(data, 24), readUInt32(data, 28), readUInt32(data, 32)];

    const mapNameLen = readUInt16(data, 36);
    const musicNameLen = readUInt16(data, 38);

    const parTime = readString(data, 44, 5);
    const levelName = readString(data, 49, mapNameLen);
    const music = readString(data, 49 + mapNameLen, musicNameLen);

    const plane1 = readPlaneData(data, offsets[0], lengths[0], rle);
    const plane2 = readPlaneData(data, offsets[1], lengths[1], rle);

    // Parse map tiles
    // plane1: walls/doors
    // plane2: objects/enemies/player spawn
    const walls = new Array(64*64).fill(0);
    const objects = new Array(64*64).fill(0);
    let spawnX = 29, spawnY = 57, spawnAngle = 90;
    const enemies = [];
    const statics = [];
    const doors = [];

    for (let y0 = 0; y0 < 64; y0++) {
        for (let x = 0; x < 64; x++) {
            const y = 63 - y0;
            const layer1 = plane1[y0 * 64 + x];
            const layer2 = plane2[y0 * 64 + x];

            // Wall/door layer
            if (layer1 === 0) {
                walls[y * 64 + x] = 0; // empty/unknown
            } else if (layer1 < 0x6a) {
                if ((layer1 >= 0x5A && layer1 <= 0x5F) || layer1 === 0x64 || layer1 === 0x65) {
                    // Door
                    let doorType = 'normal';
                    let vertical = false;
                    if (layer1 === 0x5A) { doorType = 'normal'; vertical = true; }
                    else if (layer1 === 0x5B) { doorType = 'normal'; vertical = false; }
                    else if (layer1 === 0x5C) { doorType = 'gold'; vertical = true; }
                    else if (layer1 === 0x5D) { doorType = 'gold'; vertical = false; }
                    else if (layer1 === 0x5E) { doorType = 'silver'; vertical = true; }
                    else if (layer1 === 0x5F) { doorType = 'silver'; vertical = false; }
                    else if (layer1 === 0x64) { doorType = 'elevator'; vertical = true; }
                    else if (layer1 === 0x65) { doorType = 'elevator'; vertical = false; }
                    walls[y * 64 + x] = -1; // door marker
                    doors.push({ x, y, type: doorType, vertical });
                } else {
                    // Wall - store wall type index
                    walls[y * 64 + x] = layer1;
                    if (layer1 === 0x15) {
                        // Elevator wall
                    }
                }
            } else if (layer1 === 0x6a) {
                walls[y * 64 + x] = 0; // ambush floor (open)
            } else {
                walls[y * 64 + x] = 0; // area marker (open floor)
            }

            // Object/enemy layer
            if (layer2) {
                // Player spawn
                if (layer2 === 0x13) { spawnX = x; spawnY = y; spawnAngle = 90; }
                else if (layer2 === 0x14) { spawnX = x; spawnY = y; spawnAngle = 0; }
                else if (layer2 === 0x15) { spawnX = x; spawnY = y; spawnAngle = 270; }
                else if (layer2 === 0x16) { spawnX = x; spawnY = y; spawnAngle = 180; }
                // Static objects (23-69 range = indices 0-46 in statinfo)
                else if (layer2 >= 23 && layer2 < 23 + 47) {
                    statics.push({ x, y, type: layer2 - 23 });
                }
                // Exit tile
                else if (layer2 === 0x63) {
                    statics.push({ x, y, type: 'exit' });
                }
                // Guards (standing) - all difficulties
                else if (layer2 >= 108 && layer2 <= 111) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 108, patrol: false });
                }
                else if (layer2 >= 112 && layer2 <= 115) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 112, patrol: true });
                }
                // Officers
                else if (layer2 >= 116 && layer2 <= 119) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 116, patrol: false });
                }
                else if (layer2 >= 120 && layer2 <= 123) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 120, patrol: true });
                }
                // SS
                else if (layer2 >= 126 && layer2 <= 129) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 126, patrol: false });
                }
                else if (layer2 >= 130 && layer2 <= 133) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 130, patrol: true });
                }
                // Dogs
                else if (layer2 >= 134 && layer2 <= 137) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 134, patrol: false });
                }
                else if (layer2 >= 138 && layer2 <= 141) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 138, patrol: true });
                }
                // Medium difficulty guards (144-177)
                else if (layer2 >= 144 && layer2 <= 147) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 144, patrol: false, difficulty: 1 });
                }
                else if (layer2 >= 148 && layer2 <= 151) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 148, patrol: true, difficulty: 1 });
                }
                else if (layer2 >= 152 && layer2 <= 155) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 152, patrol: false, difficulty: 1 });
                }
                else if (layer2 >= 156 && layer2 <= 159) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 156, patrol: true, difficulty: 1 });
                }
                else if (layer2 >= 162 && layer2 <= 165) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 162, patrol: false, difficulty: 1 });
                }
                else if (layer2 >= 166 && layer2 <= 169) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 166, patrol: true, difficulty: 1 });
                }
                else if (layer2 >= 170 && layer2 <= 173) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 170, patrol: false, difficulty: 1 });
                }
                else if (layer2 >= 174 && layer2 <= 177) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 174, patrol: true, difficulty: 1 });
                }
                // Hard difficulty enemies (180-213)
                else if (layer2 >= 180 && layer2 <= 183) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 180, patrol: false, difficulty: 2 });
                }
                else if (layer2 >= 184 && layer2 <= 187) {
                    enemies.push({ x, y, type: 'guard', dir: layer2 - 184, patrol: true, difficulty: 2 });
                }
                else if (layer2 >= 188 && layer2 <= 191) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 188, patrol: false, difficulty: 2 });
                }
                else if (layer2 >= 192 && layer2 <= 195) {
                    enemies.push({ x, y, type: 'officer', dir: layer2 - 192, patrol: true, difficulty: 2 });
                }
                else if (layer2 >= 198 && layer2 <= 201) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 198, patrol: false, difficulty: 2 });
                }
                else if (layer2 >= 202 && layer2 <= 205) {
                    enemies.push({ x, y, type: 'ss', dir: layer2 - 202, patrol: true, difficulty: 2 });
                }
                else if (layer2 >= 206 && layer2 <= 209) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 206, patrol: false, difficulty: 2 });
                }
                else if (layer2 >= 210 && layer2 <= 213) {
                    enemies.push({ x, y, type: 'dog', dir: layer2 - 210, patrol: true, difficulty: 2 });
                }
                // Bosses
                else if (layer2 === 214) { enemies.push({ x, y, type: 'boss', dir: 0, patrol: false }); }
                else if (layer2 === 196) { enemies.push({ x, y, type: 'boss', dir: 0, patrol: false }); } // schabbs
                else if (layer2 === 160) { enemies.push({ x, y, type: 'boss', dir: 0, patrol: false }); } // fake
                else if (layer2 === 178) { enemies.push({ x, y, type: 'boss', dir: 0, patrol: false }); } // mecha
                // Mutants
                else if (layer2 >= 216 && layer2 <= 219) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 216, patrol: false });
                }
                else if (layer2 >= 220 && layer2 <= 223) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 220, patrol: true });
                }
                else if (layer2 >= 234 && layer2 <= 237) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 234, patrol: false, difficulty: 1 });
                }
                else if (layer2 >= 238 && layer2 <= 241) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 238, patrol: true, difficulty: 1 });
                }
                else if (layer2 >= 252 && layer2 <= 255) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 252, patrol: false, difficulty: 2 });
                }
                else if (layer2 >= 256 && layer2 <= 259) {
                    enemies.push({ x, y, type: 'mutant', dir: layer2 - 256, patrol: true, difficulty: 2 });
                }
            }
        }
    }

    return {
        name: levelName,
        music,
        parTime,
        ceiling,
        floor: floor,
        walls,
        doors,
        enemies,
        statics,
        spawnX,
        spawnY,
        spawnAngle,
    };
}

// Decode all maps
const levels = {};
const sortedKeys = Object.keys(mapData).sort();
for (const key of sortedKeys) {
    const num = key.match(/w(\d+)/);
    if (!num) continue;
    const idx = parseInt(num[1]);
    console.log(`Decoding ${key}...`);
    const level = decodeMap(key, mapData[key]);
    if (level) {
        levels[idx] = level;
        console.log(`  ${level.name}: spawn=(${level.spawnX},${level.spawnY}), doors=${level.doors.length}, enemies=${level.enemies.length}, statics=${level.statics.length}`);
    } else {
        console.log(`  FAILED to decode`);
    }
}

// Write as JS module
const output = `// Auto-generated Wolf3D level data
// Decoded from jseidelin/wolf3d maps.js
export const LEVELS = ${JSON.stringify(levels)};
`;

writeFileSync('/Users/kirillionov/Claude/Games/wolfenstein3d-threejs/src/levels.js', output);
console.log('\nWrote src/levels.js');

// Print stats
for (const [idx, level] of Object.entries(levels)) {
    const wallCount = level.walls.filter(w => w > 0).length;
    const floorCount = level.walls.filter(w => w === 0).length;
    console.log(`Level ${idx}: "${level.name}" walls=${wallCount} floor=${floorCount} doors=${level.doors.length} enemies=${level.enemies.length}`);
}
