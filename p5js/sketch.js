/*
 * IMPACT ARCHIVE
 *
 * Each distinct physical press adds structural complexity to the photographed
 * shard. The potentiometer controls glass tension and rotation, while the FSR
 * becomes the gesture that progressively builds the object.
 *
 * The sketch intentionally works without Arduino hardware. Press D to switch
 * demo mode, click the canvas once to unlock browser audio, then press SPACE
 * to make a manual impact.
 */

const BG = [4, 5, 7];
const PAPER = [236, 239, 235];
const MUTED = [128, 139, 146];

let serial = null;
let serialConnected = false;
let serialPortName = "";
let serialStatus = "Demo mode — press D or SPACE";
let lastPacketAt = 0;
let serialScanTimer = null;
let nativeSerialPort = null;
let nativeSerialReader = null;
let nativeSerialBuffer = "";

let portSelect;
let connectButton;
let refreshButton;
let demoButton;
let cameraButton;
let statusLabel;
let hud;

let pressureRaw = 0;
let potRaw = 0;
let pressureTarget = 0.08;
let potTarget = 0.32;
let pressureLevel = 0.08;
let potLevel = 0.32;
let previousPressure = 0.08;
let demoMode = true;
let demoNextHit = 0;
let lastImpactAt = -1000;
let impactEnergy = 0;
let complexityLevel = 0.08;
let audioContext = null;
let audioReady = false;

let cameraVideo = null;
let cameraReady = false;
let cameraStatus = "Camera / Off";
let cameraStartTimer = null;
let snapshots = [];
let landscapeTextures = [];
const MAX_SNAPSHOTS = 8;
const TRIPLE_PRESS_WINDOW = 2200;
let recentPhysicalPresses = [];
let postcardMode = false;
let postcardProgress = 0;
let postcardImages = [];
let postcardView = null;
let memoryIndex = 0;
let postcardPairCursor = 0;
let postcardReturnArmed = false;

// The photographs are the memory archive: second-year moments from Tongji
// University's College of Design and Innovation. Keeping the list explicit
// makes the sketch portable when it is published as a static p5.js page.
const MEMORY_PATHS = [
  "media/memories/118564864390babff8604cc2f8ef52e7.jpg",
  "media/memories/96095cf57fa6b6db307def744ce94ccb.jpg",
  "media/memories/c8188541c3a720bfb769efb29b809fbc.jpg",
  "media/memories/87bd94a059a4df3ce719368afa38ddd9.jpg",
  "media/memories/89bf46252fdad6e2e8a55c78c23b062b.jpg",
  "media/memories/0f4b7feb0b0e20f70a4337e21f10d5bf.jpg",
  "media/memories/1b4d239994c30736365cb15a78cd35b7.jpg",
  "media/memories/deb3b1955d17efa095b8783c3d9d2691.jpg",
  "media/memories/c8c8125e81216b33fbb1b5a02b92bca3.jpg",
  "media/memories/80df2a3887c2020edb908456308c04e8.jpg",
  "media/memories/2e1920b8cee54105bd91318910aa2b11.jpg",
  "media/memories/117687dc6634c67dcfdedb4b9db342eb.jpg",
  "media/memories/4eb58bf206c463095099f7b36c334c21.jpg",
  "media/memories/1ed09e82f987990ed01385261c76e454.jpg",
  "media/memories/e8589cc94ffd5791ec4032cd51acf534.jpg"
];
let memoryImages = [];

let fallbackPhoto;

function preload() {
  memoryImages = MEMORY_PATHS.map((path) => loadImage(path));
}

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  canvas.parent("canvas-wrap");
  canvas.mousePressed(() => {
    unlockAudio();
    mousePressImpact();
  });
  pixelDensity(1);
  textureMode(NORMAL);
  noiseSeed(41);
  fallbackPhoto = makeFallbackPhoto();
  landscapeTextures = makeLandscapeSet();

  setupSerialPanel();
  setupCamera();
  setupHud();
  setupPostcardView();
  setupSerial();
}

window.addEventListener("beforeunload", () => {
  // Best-effort cleanup so refreshing the sketch does not leave the Arduino
  // locked to an abandoned browser tab.
  if (nativeSerialPort) nativeSerialPort.close();
});

function draw() {
  background(BG[0], BG[1], BG[2]);
  updateSensorState();
  pressureLevel = lerp(pressureLevel, pressureTarget, 0.12);
  potLevel = lerp(potLevel, potTarget, 0.09);
  impactEnergy = max(0, impactEnergy * 0.91 - 0.0012);
  complexityLevel = max(0.08, complexityLevel * 0.9997);

  drawArchiveObject();
  postcardProgress = lerp(postcardProgress, postcardMode ? 1 : 0, 0.085);
  drawOverlay();
}

// ---------------------------------------------------------------------------
// Mouse / touch mode: lets the piece be played without Arduino hardware.
//   click / tap        = one FSR press (archives a memory, adds complexity)
//   3 clicks in ~2s    = unfold the postcard; the next click folds it back
//   hold the button    = pressure keeps rising while held
//   scroll / ↑ ↓ keys  = potentiometer (memory depth / glass tension)
// ---------------------------------------------------------------------------
let mouseMode = false;
let mouseHeld = false;
let mouseHeldSince = 0;

function enableMouseMode() {
  if (serialConnected && !demoMode) return;
  if (!mouseMode) {
    mouseMode = true;
    demoMode = false;
    if (demoButton) demoButton.html("Demo: Off");
    setSerialStatus("Mouse mode — click to press · scroll for tension");
  }
}

function mousePressImpact() {
  if (serialConnected && !demoMode) return;
  enableMouseMode();
  mouseHeld = true;
  mouseHeldSince = millis();
  const strength = random(0.62, 0.92);
  pressureTarget = strength;
  triggerImpact(strength, true, true);
}

function mouseReleased() {
  mouseHeld = false;
}

function touchEnded() {
  mouseHeld = false;
}

function mouseWheel(event) {
  if (serialConnected && !demoMode) return;
  enableMouseMode();
  potTarget = constrain(potTarget - event.delta * 0.0006, 0, 1);
  return false;
}

function updateMouseInput() {
  if (mouseHeld) {
    const held = (millis() - mouseHeldSince) / 1200;
    pressureTarget = constrain(0.62 + held * 0.38, 0, 1);
  } else {
    pressureTarget = lerp(pressureTarget, 0.06, 0.08);
  }
}

function updateSensorState() {
  if (mouseMode && !serialConnected) {
    updateMouseInput();
  } else if (demoMode || !serialConnected) {
    updateDemoInput();
  } else if (millis() - lastPacketAt > 1500) {
    pressureTarget = 0;
    // If the serial stream pauses while the card is open, treat that pause as
    // the release half of the return gesture. The next press can close it.
    if (postcardMode) postcardReturnArmed = true;
  }
}

function drawArchiveObject() {
  const tension = constrain(potLevel, 0, 1);
  const complexity = constrain(complexityLevel, 0, 1);
  const roughness = constrain(complexity * 0.74 + tension * 0.26, 0, 1);
  const pressure = constrain(pressureLevel, 0, 1);
  const scaleBase = min(width, height) * 0.44;
  const objectScale = scaleBase * (0.84 + pressure * 0.16 + impactEnergy * 0.16);
  const segments = floor(6 + complexity * 8 + tension * 2);
  const ringCount = 4;
  const heightFactor = 1.18 + pressure * 0.18 + impactEnergy * 0.28;
  const rotation = frameCount * (0.0012 + tension * 0.007) + impactEnergy * 0.42;
  const tilt = -0.13 + sin(frameCount * 0.002) * 0.045 + impactEnergy * 0.14;

  push();
  rotateY(rotation);
  rotateX(tilt);
  rotateZ(-0.08 + tension * 0.06);
  scale(objectScale / 220);
  // Keep the photograph close to its original grayscale. The facet seams and
  // signal rings provide the depth cues; lighting the texture would wash out
  // the image into a pale plastic object.
  noLights();

  noStroke();
  drawCrystalFaces(segments, ringCount, heightFactor, roughness, impactEnergy);

  // A second, translucent shell creates the hard, glass-like flash in the
  // reference images. It is deliberately sparse so the photograph remains
  // the primary material.
  drawGlassGlints(segments, ringCount, heightFactor, roughness, impactEnergy);

  // Facet seams are drawn on top of the texture as a very thin registration
  // line. Their opacity rises when the FSR is hit.
  stroke(PAPER[0], PAPER[1], PAPER[2], 64 + impactEnergy * 105);
  strokeWeight(0.8 + impactEnergy * 0.7);
  noFill();
  drawCrystalSeams(segments, ringCount, heightFactor, roughness, impactEnergy);
  pop();
}

function crystalRings(segments, heightFactor, roughness, energy) {
  const rings = [];
  const profile = [
    { y: -86 * heightFactor, radius: 0.14 },
    { y: -34 * heightFactor, radius: 0.78 },
    { y: 8 * heightFactor, radius: 1.0 },
    { y: 40 * heightFactor, radius: 0.86 },
    { y: 74 * heightFactor, radius: 0.16 }
  ];

  const apex = [
    { x: -26 - roughness * 10, z: 18 + roughness * 8 },
    { x: 24 + roughness * 7, z: -17 - roughness * 11 }
  ];

  for (let ring = 0; ring < profile.length; ring += 1) {
    const points = [];
    const isApex = ring === 0 || ring === profile.length - 1;
    for (let side = 0; side < segments; side += 1) {
      const angle = (TWO_PI * side) / segments + 0.13 * sin(ring * 7.1);
      const irregular = 1 + (noise(ring * 10.7, side * 0.23) - 0.5) * (0.28 + roughness * 0.62);
      const splitAngle = angle + sin(side * 3.1 + ring) * energy * 0.07;
      const split = energy * (5 + roughness * 22) * sin(side * 5.2 + ring * 1.7);
      const radius = profile[ring].radius * irregular * (1 + sin(side * 1.7 + ring * 4.1) * roughness * 0.12);
      const apexPoint = apex[ring === 0 ? 0 : 1];
      const sideLift = isApex ? 0 : sin(side * 1.51 + ring * 2.2) * (5 + roughness * 15);
      const driftX = isApex ? apexPoint.x : (ring - 2) * 7 + sin(side * 2.7 + ring) * roughness * 18;
      const driftZ = isApex ? apexPoint.z : cos(side * 2.2 + ring) * roughness * 15;
      points.push({
        x: isApex ? apexPoint.x : cos(splitAngle) * radius * 98 + split + driftX,
        y: isApex ? profile[ring].y : profile[ring].y + sideLift,
        z: isApex ? apexPoint.z : sin(splitAngle) * radius * 98 + split * 0.55 + driftZ,
        u: 0.5 + cos(angle) * radius * 0.46,
        v: ring / (profile.length - 1) + sin(side * 1.47) * roughness * 0.045,
        apex: isApex
      });
    }
    rings.push(points);
  }
  return rings;
}

function drawCrystalFaces(segments, ringCount, heightFactor, roughness, energy) {
  const rings = crystalRings(segments, heightFactor, roughness, energy);
  for (let band = 0; band < ringCount; band += 1) {
    for (let side = 0; side < segments; side += 1) {
      const next = (side + 1) % segments;
      const a = rings[band][side];
      const b = rings[band][next];
      const c = rings[band + 1][next];
      const d = rings[band + 1][side];
      const faceOffset = energy * (7 + roughness * 26);
      const offsetX = sin(side * 2.21 + band * 5.1) * faceOffset;
      const offsetZ = cos(side * 1.83 + band * 2.4) * faceOffset * 0.7;
      const tone = 0.78 + 0.22 * noise(side * 0.5, band * 0.7);
      // Keep the crystal as a layered memory object: each facet can carry a
      // different photograph, while the postcard reveals complete frames.
      tint(210 * tone, 228 * tone, 244 * tone, 232);
      texture(textureForFacet(side, band));
      drawTexturedTriangle(a, b, c, offsetX, offsetZ, roughness, side, band);
      texture(textureForFacet(side + 1, band + 7));
      drawTexturedTriangle(a, c, d, offsetX, offsetZ, roughness, side + 1, band);
    }
  }
  noTint();
}

function makeLandscapeSet() {
  const archive = memoryImages.filter((image) => image && image.width > 0);
  if (!archive.length) archive.push(fallbackPhoto);
  return archive;
}

function availableMemoryImages() {
  const archive = memoryImages.length ? memoryImages : landscapeTextures;
  return archive.filter((image) => image && image.width > 0 && image.height > 0);
}

function memoryImageAt(index) {
  const archive = availableMemoryImages();
  if (!archive.length) return fallbackPhoto;
  return archive[((index % archive.length) + archive.length) % archive.length];
}

function advanceMemoryImage() {
  const archive = availableMemoryImages();
  if (archive.length < 2) return;
  memoryIndex = (memoryIndex + 1) % archive.length;
}

function archiveSources() {
  const sources = snapshots.map((snapshot) => snapshot.image);
  if (sources.length) return sources.concat(landscapeTextures);
  return landscapeTextures.length ? landscapeTextures : [fallbackPhoto];
}

function textureForFacet(side, band) {
  const sources = archiveSources();
  if (!sources.length) return fallbackPhoto;
  const memoryMix = constrain(potLevel, 0, 1);
  const stableNoise = noise(side * 0.73 + band * 11.2, band * 0.61 + 19.7);

  if (snapshots.length) {
    // A low pot value keeps the just-captured present image in most facets.
    // A high value lets earlier snapshots and campus memories come through.
    const newestBias = 0.78 - memoryMix * 0.58;
    if (stableNoise < newestBias) return snapshots[0].image;
    const deeperArchive = sources.slice(1);
    const depth = floor(map(stableNoise, newestBias, 1, 0, deeperArchive.length));
    const safeDepth = min(deeperArchive.length - 1, max(0, depth));
    const snapshotTail = max(0, snapshots.length - 1);
    if (landscapeTextures.length && safeDepth >= snapshotTail) {
      const memoryDepth = safeDepth - snapshotTail;
      return landscapeTextures[(memoryDepth + memoryIndex) % landscapeTextures.length];
    }
    return deeperArchive[safeDepth];
  }

  const index = floor((stableNoise + memoryMix * 0.3) * landscapeTextures.length);
  return landscapeTextures[(index + memoryIndex) % landscapeTextures.length];
}

function drawTexturedTriangle(a, b, c, offsetX, offsetZ, roughness, side, band) {
  const uvShift = (noise(side * 0.71, band * 0.93) - 0.5) * roughness * 0.18;
  beginShape(TRIANGLES);
  vertex(a.x + offsetX, a.y, a.z + offsetZ, constrain(a.u + uvShift, 0, 1), constrain(a.v, 0, 1));
  vertex(b.x + offsetX, b.y, b.z + offsetZ, constrain(b.u + uvShift, 0, 1), constrain(b.v, 0, 1));
  vertex(c.x + offsetX, c.y, c.z + offsetZ, constrain(c.u + uvShift, 0, 1), constrain(c.v, 0, 1));
  endShape();
}

function drawCrystalSeams(segments, ringCount, heightFactor, roughness, energy) {
  const rings = crystalRings(segments, heightFactor, roughness, energy);
  for (let band = 0; band <= ringCount; band += 1) {
    const ring = rings[band];
    beginShape();
    for (const point of ring) vertex(point.x, point.y, point.z);
    endShape(CLOSE);
  }
  for (let side = 0; side < segments; side += 1) {
    beginShape();
    for (let band = 0; band <= ringCount; band += 1) {
      const point = rings[band][side];
      vertex(point.x, point.y, point.z);
    }
    endShape();
  }

  // Diagonal cuts make the object read as a triangulated shard rather than a
  // smooth symmetrical gem.
  stroke(255, 255, 255, 38 + roughness * 46 + energy * 65);
  strokeWeight(0.42 + energy * 0.45);
  for (let band = 0; band < ringCount; band += 1) {
    for (let side = 0; side < segments; side += 2) {
      const start = rings[band][side];
      const end = rings[band + 1][(side + 1) % segments];
      line(start.x, start.y, start.z, end.x, end.y, end.z);
    }
  }
}

function drawGlassGlints(segments, ringCount, heightFactor, roughness, energy) {
  const rings = crystalRings(segments, heightFactor, roughness, energy);
  // p5 1.x keeps the active texture on filled geometry, so the glass layer is
  // drawn as sparse specular cuts instead of trying to switch to a second
  // material. This keeps the effect crisp and avoids washing out the photo.
  noFill();
  stroke(220, 246, 255, 26 + energy * 55 + roughness * 18);
  strokeWeight(0.55 + energy * 0.55);
  for (let band = 0; band < ringCount; band += 1) {
    for (let side = 0; side < segments; side += 1) {
      if ((side + band * 2) % 4 !== 0) continue;
      const next = (side + 1) % segments;
      const a = rings[band][side];
      const b = rings[band][next];
      const c = rings[band + 1][next];
      beginShape();
      vertex(a.x, a.y, a.z);
      vertex(b.x, b.y, b.z);
      vertex(c.x, c.y, c.z);
      endShape();
    }
  }
}

function drawPostcardScene(progress) {
  const eased = easeInOut(progress);
  const margin = min(width, height) * 0.075;
  const cardWidth = width - margin * 2;
  const cardHeight = height - margin * 2;
  const leftWidth = cardWidth * 0.58;
  const gap = max(16, cardWidth * 0.022);
  const rightX = margin + leftWidth + gap;
  const rightWidth = cardWidth - leftWidth - gap;
  const photoTop = margin + cardHeight * 0.19;
  const photoHeight = cardHeight * 0.63;
  const smallHeight = (photoHeight - gap) / 2;
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  // The paper layer gradually covers the crystal, making the object feel as
  // if it is unfolding into a flat postcard rather than cutting to a new
  // screen.
  push();
  resetMatrix();
  translate(-width / 2, -height / 2, 500);
  // The postcard is a 2D editorial layer above the 3D crystal. Disable depth
  // testing while it is drawn so the paper, images, rules, and type follow
  // normal painter's order instead of being hidden by the first rectangle.
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  noLights();
  noStroke();
  fill(PAPER[0], PAPER[1], PAPER[2], 248 * eased);
  rect(0, 0, width, height);

  const images = postcardImages.length ? postcardImages : landscapeTextures;
  const first = images[0] || fallbackPhoto;
  const second = images[1] || first;
  const third = images[2] || second;
  const firstX = lerp(centerX - leftWidth / 2, margin, eased);
  const firstY = lerp(centerY - photoHeight / 2, photoTop, eased);
  const secondX = lerp(centerX - rightWidth / 2, rightX, eased);
  const secondY = lerp(centerY - smallHeight / 2, photoTop, eased);
  const thirdX = lerp(centerX - rightWidth / 2, rightX, eased);
  const thirdY = lerp(centerY - smallHeight / 2, photoTop + smallHeight + gap, eased);

  drawPostcardImage(first, firstX, firstY, leftWidth, photoHeight, 246 * eased, -0.008 * (1 - eased));
  drawPostcardImage(second, secondX, secondY, rightWidth, smallHeight, 242 * eased, 0.012 * (1 - eased));
  drawPostcardImage(third, thirdX, thirdY, rightWidth, smallHeight, 242 * eased, -0.01 * (1 - eased));

  stroke(35, 42, 44, 145 * eased);
  strokeWeight(1);
  noFill();
  rect(margin, margin, cardWidth, cardHeight);
  line(margin, margin + cardHeight * 0.145, margin + cardWidth, margin + cardHeight * 0.145);

  fill(20, 27, 29, 235 * eased);
  noStroke();
  textFont("Times New Roman");
  textStyle(BOLD);
  textSize(max(17, min(width, height) * 0.026));
  textAlign(LEFT, TOP);
  text("Impact archive", margin + cardWidth * 0.035, margin + cardHeight * 0.047);

  textStyle(ITALIC);
  textSize(max(9, min(width, height) * 0.012));
  fill(52, 95, 125, 230 * eased);
  text("A memory held in pressure", margin + cardWidth * 0.035, margin + cardHeight * 0.095);

  textAlign(RIGHT, TOP);
  textStyle(NORMAL);
  textSize(max(9, min(width, height) * 0.012));
  fill(35, 42, 44, 190 * eased);
  text("Three impacts / one moment", margin + cardWidth * 0.965, margin + cardHeight * 0.052);

  textAlign(LEFT, TOP);
  textStyle(ITALIC);
  textSize(max(9, min(width, height) * 0.011));
  fill(52, 95, 125, 220 * eased);
  text("Tongji University · College of Design and Innovation", margin + cardWidth * 0.035, margin + cardHeight * 0.865);
  text("Frame 01—03", margin + cardWidth * 0.035, margin + cardHeight * 0.91);

  textAlign(RIGHT, TOP);
  textStyle(NORMAL);
  fill(35, 42, 44, 190 * eased);
  text("Postcard / 01", margin + cardWidth * 0.965, margin + cardHeight * 0.91);
  gl.enable(gl.DEPTH_TEST);
  pop();
}

function drawPostcardImage(imageSource, x, y, boxWidth, boxHeight, alpha, rotation) {
  push();
  translate(x + boxWidth / 2, y + boxHeight / 2, 520);
  rotateZ(rotation);
  rectMode(CENTER);
  noStroke();
  fill(24, 30, 33, 238);
  rect(0, 0, boxWidth, boxHeight);
  if (!imageSource || !imageSource.width || !imageSource.height) {
    pop();
    return;
  }

  const sourceRatio = imageSource.width / imageSource.height;
  const boxRatio = boxWidth / boxHeight;
  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  if (sourceRatio > boxRatio) {
    drawWidth = boxHeight * sourceRatio;
  } else {
    drawHeight = boxWidth / sourceRatio;
  }

  imageMode(CENTER);
  tint(255, alpha);
  image(imageSource, 0, 0, drawWidth, drawHeight);
  noTint();
  pop();
}

function easeInOut(value) {
  const amount = constrain(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function enterPostcardMode() {
  // Keep the newest captured frame as the large image. The two smaller
  // panels come from the Tongji memory archive so three repeated camera
  // frames never fill the postcard.
  const newestFrame = snapshots.length ? snapshots[0].image : null;
  const memoryArchive = availableMemoryImages().filter(
    (image) => image && image.width > 0 && image !== newestFrame
  );
  const archiveOffset = postcardPairCursor % max(1, memoryArchive.length);
  const firstMemory = memoryArchive.length
    ? memoryArchive[archiveOffset % memoryArchive.length]
    : newestFrame || fallbackPhoto;
  const secondMemory = memoryArchive.length > 1
    ? memoryArchive[(archiveOffset + 1) % memoryArchive.length]
    : firstMemory;
  // Advance by a pair so every new postcard receives a fresh combination of
  // archive photographs instead of repeating the same two panels.
  postcardPairCursor = (postcardPairCursor + 2) % max(1, memoryArchive.length);
  postcardImages = [newestFrame || firstMemory, firstMemory, secondMemory];
  postcardMode = true;
  postcardReturnArmed = false;
  recentPhysicalPresses = [];
  renderPostcardView();
  document.body.classList.add("postcard-open");
  if (postcardView) {
    requestAnimationFrame(() => postcardView.classList.add("is-open"));
  }
}

function exitPostcardMode() {
  postcardMode = false;
  postcardReturnArmed = false;
  recentPhysicalPresses = [];
  if (postcardView) postcardView.classList.remove("is-open");
  document.body.classList.remove("postcard-open");
}

function setupPostcardView() {
  postcardView = document.createElement("div");
  postcardView.id = "postcard-view";
  document.body.appendChild(postcardView);
}

function imageToDataUrl(source) {
  if (!source) return "";
  const canvas = source.canvas || (source.elt && source.elt.tagName === "CANVAS" ? source.elt : null);
  if (!canvas || !canvas.toDataURL) return "";
  try {
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch (error) {
    return "";
  }
}

function renderPostcardView() {
  if (!postcardView) return;
  const images = postcardImages.length ? postcardImages : landscapeTextures;
  const imageUrls = [0, 1, 2].map((index) => imageToDataUrl(images[index] || images[0] || fallbackPhoto));
  postcardView.innerHTML = `
    <article class="postcard-sheet">
      <header class="postcard-header">
        <div>
          <div class="postcard-title">Impact archive</div>
          <div class="postcard-subtitle">A memory held in pressure</div>
        </div>
        <div class="postcard-meta">Three impacts / one moment</div>
      </header>
      <div class="postcard-rule"></div>
      <section class="postcard-grid">
        <figure class="postcard-photo postcard-photo-main"><img alt="First captured memory" /></figure>
        <div class="postcard-side">
          <figure class="postcard-photo"><img alt="Second captured memory" /></figure>
          <figure class="postcard-photo"><img alt="Third captured memory" /></figure>
        </div>
      </section>
      <footer class="postcard-footer">
        <div>Tongji University · College of Design and Innovation</div>
        <div>Frame 01—03&nbsp;&nbsp; / &nbsp;&nbsp;Postcard 01</div>
      </footer>
    </article>
  `;
  postcardView.querySelectorAll("img").forEach((image, index) => {
    if (imageUrls[index]) image.src = imageUrls[index];
  });
}

function drawOverlay() {
  const pressure = floor(pressureLevel * 100);
  const complexity = floor(complexityLevel * 100);
  const archiveCount = snapshots.length.toString().padStart(2, "0");
  if (!hud) return;
  const visualState = postcardMode || postcardProgress > 0.04 ? "Postcard / Open" : "Crystal / Closed";
  hud.html(`
    <div class="hud-header">
      <div><strong>Impact Archive</strong><span>Image / Pressure Study · 01</span></div>
      <div class="hud-readout"><strong>Archive&nbsp;&nbsp;${archiveCount} / ${MAX_SNAPSHOTS}</strong><span>Impact&nbsp;&nbsp;${pressure.toString().padStart(3, "0")} &nbsp;·&nbsp; Complexity&nbsp;&nbsp;${complexity.toString().padStart(3, "0")}</span></div>
    </div>
    <div class="hud-status">${visualState} &nbsp;·&nbsp; ${cameraStatus} &nbsp;·&nbsp; ${serialStatus}</div>
    ${serialConnected ? "" : `<div class="hud-hint">Click to press &nbsp;·&nbsp; click 3× quickly for the postcard &nbsp;·&nbsp; scroll or ↑ ↓ for tension &nbsp;·&nbsp; C for camera</div>`}
  `);
}

function setupHud() {
  hud = createDiv();
  hud.id("hud");
}

function updateDemoInput() {
  const now = millis();
  if (now > demoNextHit) {
    const strength = random(0.38, 0.98);
    pressureTarget = strength;
    // Demo mode can preview the pressure animation, but it must never create
    // archive snapshots. New camera images are reserved for a real FSR press.
    impactEnergy = max(impactEnergy, strength * 0.55);
    demoNextHit = now + random(1400, 2400);
  } else if (now > demoNextHit - 780) {
    pressureTarget = lerp(pressureTarget, 0.06, 0.04);
  }
  potTarget = map(sin(now * 0.00021 + 1.2), -1, 1, 0.16, 0.94);
}

function triggerImpact(strength, shouldCapture = true, isPhysicalPress = false) {
  const now = millis();
  const amount = constrain(strength, 0.12, 1);

  // Once the three-image postcard is open, the next real press folds it back
  // into the crystal. That return gesture does not create a fourth image.
  if (postcardMode && isPhysicalPress) {
    lastImpactAt = now;
    exitPostcardMode();
    advanceMemoryImage();
    impactEnergy = max(impactEnergy, amount * 0.72);
    playImpact(strength);
    return;
  }

  if (now - lastImpactAt < 160) return;
  lastImpactAt = now;

  if (isPhysicalPress) {
    recentPhysicalPresses = recentPhysicalPresses.filter(
      (time) => now - time <= TRIPLE_PRESS_WINDOW
    );
    recentPhysicalPresses.push(now);
    advanceMemoryImage();
  }

  impactEnergy = max(impactEnergy, amount);
  // A press is a constructive gesture. Every distinct hit adds more faces
  // and more asymmetry, so the object becomes increasingly complex over time.
  complexityLevel = min(1, complexityLevel + 0.055 + amount * 0.16);
  if (shouldCapture) captureSnapshot(amount);
  if (isPhysicalPress && recentPhysicalPresses.length >= 3) enterPostcardMode();
  playImpact(strength);
}

function setupCamera() {
  cameraButton = createButton(cameraStatus);
  cameraButton.parent("serial-panel");
  cameraButton.mousePressed(toggleCamera);
}

function toggleCamera() {
  unlockAudio();
  if (cameraVideo) {
    stopCamera();
    return;
  }

  cameraStatus = "Camera / Starting";
  updateCameraButton();
  try {
    cameraVideo = createCapture({ video: { facingMode: "user" }, audio: false }, () => {
      if (cameraStartTimer) clearTimeout(cameraStartTimer);
      cameraReady = true;
      cameraStatus = "Camera / Live";
      updateCameraButton();
    });
    cameraVideo.size(640, 480);
    cameraVideo.hide();
    cameraVideo.elt.addEventListener("loadeddata", () => {
      if (cameraStartTimer) clearTimeout(cameraStartTimer);
      cameraReady = true;
      cameraStatus = "Camera / Live";
      updateCameraButton();
    });
    cameraStartTimer = setTimeout(() => {
      if (!cameraReady && cameraVideo) {
        cameraStatus = "Camera / Unavailable";
        updateCameraButton();
      }
    }, 5000);
  } catch (error) {
    if (cameraStartTimer) clearTimeout(cameraStartTimer);
    cameraVideo = null;
    cameraReady = false;
    cameraStatus = "Camera / Unavailable";
    updateCameraButton();
  }
}

function stopCamera() {
  if (cameraStartTimer) clearTimeout(cameraStartTimer);
  if (cameraVideo && cameraVideo.elt && cameraVideo.elt.srcObject) {
    cameraVideo.elt.srcObject.getTracks().forEach((track) => track.stop());
  }
  if (cameraVideo) cameraVideo.remove();
  cameraVideo = null;
  cameraReady = false;
  cameraStatus = "Camera / Off";
  updateCameraButton();
}

function updateCameraButton() {
  if (cameraButton) cameraButton.html(cameraStatus);
}

function captureSnapshot(strength) {
  let captured = null;
  let fromCamera = false;
  if (cameraVideo && cameraReady && cameraVideo.elt && cameraVideo.elt.readyState >= 2) {
    const width = 640;
    const height = 480;
    captured = createGraphics(width, height);
    captured.pixelDensity(1);
    captured.push();
    captured.translate(width, 0);
    captured.scale(-1, 1);
    captured.image(cameraVideo, 0, 0, width, height);
    captured.pop();
    treatCameraFrame(captured);
    fromCamera = true;
  }

  // If the camera is off, a different Tongji photograph still becomes the
  // physical press's archived fragment. That keeps demo mode meaningful.
  if (!captured) {
    const memories = landscapeTextures.length ? landscapeTextures : [fallbackPhoto];
    captured = memories[snapshots.length % memories.length];
  }

  snapshots.unshift({ image: captured, strength, fromCamera, time: millis() });
  while (snapshots.length > MAX_SNAPSHOTS) {
    const removed = snapshots.pop();
    if (removed.fromCamera && removed.image && removed.image.remove) removed.image.remove();
  }
}

function treatCameraFrame(graphics) {
  // Convert the live portrait to a monochrome, film-like still before it is
  // stored. The grain is baked into the snapshot so it stays attached to the
  // same glass facet instead of shimmering as an overlay.
  graphics.loadPixels();
  for (let i = 0; i < graphics.pixels.length; i += 4) {
    const luminance =
      graphics.pixels[i] * 0.299 +
      graphics.pixels[i + 1] * 0.587 +
      graphics.pixels[i + 2] * 0.114;
    const grain = random(-22, 22);
    const value = constrain(luminance + grain, 0, 255);
    graphics.pixels[i] = value;
    graphics.pixels[i + 1] = value;
    graphics.pixels[i + 2] = value;
  }
  graphics.updatePixels();
}

function unlockAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume();
    audioReady = true;
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = new AudioContextClass();
  audioContext.resume();
  audioReady = true;
}

function playImpact(strength) {
  if (!audioContext || !audioReady) return;
  const now = audioContext.currentTime;
  const level = 0.035 + constrain(strength, 0, 1) * 0.07;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120 + strength * 65, now);
  osc.frequency.exponentialRampToValueAtTime(54, now + 0.16);
  gain.gain.setValueAtTime(level, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.connect(gain).connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + 0.2);

  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.06, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (random() * 2 - 1) * (1 - i / data.length);
  const noise = audioContext.createBufferSource();
  const noiseGain = audioContext.createGain();
  noise.buffer = buffer;
  noiseGain.gain.setValueAtTime(level * 0.55, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  noise.connect(noiseGain).connect(audioContext.destination);
  noise.start(now);
}

function makeFallbackPhoto() {
  const g = createGraphics(720, 560);
  g.pixelDensity(1);
  g.background(216, 218, 211);
  g.noStroke();
  for (let y = 0; y < g.height; y += 4) {
    const light = 168 + noise(y * 0.014) * 72;
    g.fill(light, light + 2, light - 4, 255);
    g.rect(0, y, g.width, 4);
  }
  for (let i = 0; i < 18; i += 1) {
    const x = random(g.width);
    const y = random(g.height);
    g.fill(28, 31, 30, random(22, 92));
    g.ellipse(x, y, random(45, 180), random(20, 120));
  }
  g.stroke(35, 38, 36, 62);
  g.strokeWeight(2);
  for (let i = 0; i < 22; i += 1) {
    g.line(random(-100, 200), random(g.height), random(500, 820), random(g.height));
  }
  return g;
}

function setupSerialPanel() {
  const panel = createDiv();
  panel.id("serial-panel");

  portSelect = createSelect();
  portSelect.parent(panel);
  portSelect.option("Serial port", "");

  connectButton = createButton("Connect");
  connectButton.parent(panel);
  connectButton.mousePressed(() => {
    unlockAudio();
    if (nativeSerialPort && serialConnected) {
      disconnectNativeSerial();
      return;
    }
    connectToSelectedPort();
  });

  refreshButton = createButton("Refresh");
  refreshButton.parent(panel);
  refreshButton.mousePressed(refreshSerialPorts);

  demoButton = createButton("Demo: On");
  demoButton.parent(panel);
  demoButton.mousePressed(toggleDemoMode);

  statusLabel = createDiv(serialStatus);
  statusLabel.id("serial-status");
  statusLabel.parent(panel);
}

function setupSerial() {
  // Prefer the browser's native Web Serial connection when it is available.
  // Creating a p5.SerialPort as well would still try to reach localhost:8081
  // and could overwrite the useful direct-connection status with "Port
  // closed" even though the page is ready for the browser picker.
  if (supportsNativeSerial()) {
    refreshSerialPorts();
    return;
  }
  if (typeof p5 === "undefined" || typeof p5.SerialPort === "undefined") {
    setSerialStatus("Demo mode — p5.serialport.js is unavailable");
    return;
  }

  serial = new p5.SerialPort();
  serial.on("list", gotPortList);
  serial.on("connected", serverConnected);
  serial.on("open", portOpen);
  serial.on("data", gotData);
  serial.on("error", gotSerialError);
  serial.on("close", portClosed);
  refreshSerialPorts();
}

function refreshSerialPorts() {
  // Chrome and Edge can talk to an Arduino directly through Web Serial. This
  // avoids requiring a separate p5.serialserver process during a critique.
  // The port picker must be opened by a user gesture, so Connect handles the
  // actual requestPort() call.
  if (supportsNativeSerial()) {
    if (serialScanTimer) clearTimeout(serialScanTimer);
    portSelect.elt.innerHTML = "";
    portSelect.option("Browser port chooser", "__native__");
    setSerialStatus("Ready — click Connect to choose Arduino");
    return;
  }
  if (!serial) {
    setSerialStatus("Serial library is unavailable");
    return;
  }
  serial.list();
  setSerialStatus("Scanning serial ports…");
  if (serialScanTimer) clearTimeout(serialScanTimer);
  serialScanTimer = setTimeout(() => {
    if (!serialConnected) {
      setSerialStatus("Serial server not found — run p5 serial server");
    }
  }, 3000);
}

function gotPortList(portList) {
  if (serialScanTimer) clearTimeout(serialScanTimer);
  portSelect.elt.innerHTML = "";
  portSelect.option("Serial port", "");
  for (const port of portList) {
    const name = typeof port === "string" ? port : port.path;
    if (name) portSelect.option(name, name);
  }
  setSerialStatus(portList.length ? `${portList.length} port(s) found` : "No port found — demo mode is active");
}

function connectToSelectedPort() {
  if (supportsNativeSerial()) {
    connectNativeSerial();
    return;
  }
  if (!serial) {
    setSerialStatus("p5.serialport.js is not loaded");
    return;
  }
  const selected = portSelect.value();
  if (!selected) {
    setSerialStatus("Choose a serial port first");
    return;
  }
  serialPortName = selected;
  try {
    serial.open(selected, { baudRate: 9600 });
  } catch (error) {
    serial.open(selected);
  }
  setSerialStatus(`Connecting to ${selected}…`);
}

function supportsNativeSerial() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

async function connectNativeSerial() {
  if (!supportsNativeSerial()) return;
  try {
    setSerialStatus("Choose the Arduino port in the browser dialog…");
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    nativeSerialPort = port;
    nativeSerialBuffer = "";
    serialPortName = "Arduino (Web Serial)";
    serialConnected = true;
    demoMode = false;
    demoButton.html("Demo: Off");
    connectButton.html("Disconnect");
    setSerialStatus("Connected: Arduino");
    readNativeSerial();
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      setSerialStatus("No port selected — choose Arduino and try again");
    } else if (/(already open|failed to open)/i.test(String(error && error.message))) {
      // A preview tab from an earlier session can leave the USB handle busy.
      // Ask the browser to release any paired handle, then let the user retry.
      await releasePairedSerialPorts();
      setSerialStatus("Port was busy — press Connect again");
    } else {
      setSerialStatus(`Serial connection error: ${error.message || error}`);
    }
  }
}

async function releasePairedSerialPorts() {
  if (!supportsNativeSerial()) return;
  try {
    const ports = await navigator.serial.getPorts();
    for (const port of ports) {
      try {
        await port.close();
      } catch (error) {
        // A port that is not open has nothing to release.
      }
      if (typeof port.forget === "function") {
        try {
          await port.forget();
        } catch (error) {
          // Some browsers expose forget() but do not allow it for an open port.
        }
      }
    }
  } catch (error) {
    // Permissions or browser support may prevent enumerating paired ports.
  }
}

async function readNativeSerial() {
  if (!nativeSerialPort || !nativeSerialPort.readable) return;
  const reader = nativeSerialPort.readable.getReader();
  nativeSerialReader = reader;
  const decoder = new TextDecoder();
  try {
    while (nativeSerialPort && nativeSerialReader) {
      const result = await reader.read();
      if (result.done) break;
      nativeSerialBuffer += decoder.decode(result.value, { stream: true });
      const lines = nativeSerialBuffer.split(/\r?\n/);
      nativeSerialBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) parseSensorPacket(line.trim());
      }
    }
  } catch (error) {
    if (serialConnected) {
      serialConnected = false;
      demoMode = true;
      demoButton.html("Demo: On");
      setSerialStatus(`Serial connection closed: ${error.message || error}`);
    }
  } finally {
    reader.releaseLock();
    if (nativeSerialReader === reader) nativeSerialReader = null;
  }
}

async function disconnectNativeSerial() {
  const port = nativeSerialPort;
  const reader = nativeSerialReader;
  nativeSerialPort = null;
  nativeSerialReader = null;
  if (reader) {
    try {
      await reader.cancel();
    } catch (error) {
      // The port may already have been unplugged.
    }
  }
  if (port) {
    try {
      await port.close();
    } catch (error) {
      // The port may already have been closed by the browser.
    }
  }
  serialConnected = false;
  demoMode = true;
  demoButton.html("Demo: On");
  connectButton.html("Connect");
  setSerialStatus("Disconnected — demo mode is active");
}

function serverConnected() {
  setSerialStatus("Serial server connected — scanning ports…");
}

function portOpen() {
  serialConnected = true;
  demoMode = false;
  demoButton.html("Demo: Off");
  setSerialStatus(`Connected: ${serialPortName}`);
}

function portClosed() {
  serialConnected = false;
  demoMode = true;
  demoButton.html("Demo: On");
  setSerialStatus("Port closed — demo mode is active");
}

function gotSerialError(error) {
  if (serialScanTimer) clearTimeout(serialScanTimer);
  setSerialStatus(`Serial server error: ${error}`);
}

function gotData() {
  if (!serial) return;
  const line = serial.readLine();
  if (line) parseSensorPacket(line.trim());
}

function parseSensorPacket(packet) {
  if (!packet) return;
  const normalized = packet.toLowerCase().replace(/\s+/g, "");
  const pressureMatch = normalized.match(/(?:pressure|fsr|p):(-?\d+(?:\.\d+)?)/);
  const potMatch = normalized.match(/(?:roughness|pot|r):(-?\d+(?:\.\d+)?)/);
  let nextPressure = pressureMatch ? Number(pressureMatch[1]) : null;
  let nextPot = potMatch ? Number(potMatch[1]) : null;
  if (nextPressure === null || nextPot === null) {
    const numbers = normalized.match(/-?\d+(?:\.\d+)?/g);
    if (numbers && numbers.length >= 2) {
      nextPressure = Number(numbers[0]);
      nextPot = Number(numbers[1]);
    }
  }
  if (!Number.isFinite(nextPressure) || !Number.isFinite(nextPot)) return;

  pressureRaw = constrain(nextPressure, 0, 1023);
  potRaw = constrain(nextPot, 0, 1023);
  const nextPressureLevel = map(pressureRaw, 0, 1023, 0, 1);
  const nextPotLevel = map(potRaw, 0, 1023, 0, 1);
  const pressureRise = nextPressureLevel - previousPressure;
  const isPress = pressureRise > 0.045 || (previousPressure < 0.16 && nextPressureLevel > 0.22);
  if (postcardMode) {
    // A new press closes the postcard only after the sensor has registered a
    // release. This avoids reopening/closing the card from the same sustained
    // third press that opened it.
    if (nextPressureLevel < 0.18 || pressureRise < -0.045) {
      postcardReturnArmed = true;
    } else if (postcardReturnArmed && nextPressureLevel > 0.22 && pressureRise > 0.02) {
      postcardReturnArmed = false;
      triggerImpact(nextPressureLevel, false, true);
    }
  } else if (isPress) {
    triggerImpact(nextPressureLevel, true, true);
  }
  previousPressure = nextPressureLevel;
  pressureTarget = nextPressureLevel;
  potTarget = nextPotLevel;
  lastPacketAt = millis();
  demoMode = false;
  demoButton.html("Demo: Off");
}

function toggleDemoMode() {
  unlockAudio();
  demoMode = !demoMode;
  if (demoMode) mouseMode = false;
  demoButton.html(`Demo: ${demoMode ? "On" : "Off"}`);
  setSerialStatus(demoMode ? "Demo mode is active" : "Sensor input is active");
}

function setSerialStatus(message) {
  serialStatus = message;
  if (statusLabel) statusLabel.html(message);
}

function keyPressed() {
  if (key === "d" || key === "D") toggleDemoMode();
  if (key === "r" || key === "R") refreshSerialPorts();
  if (key === "c" || key === "C") toggleCamera();
  if (keyCode === UP_ARROW || keyCode === DOWN_ARROW) {
    enableMouseMode();
    potTarget = constrain(potTarget + (keyCode === UP_ARROW ? 0.08 : -0.08), 0, 1);
    return false;
  }
  if (key === " ") {
    unlockAudio();
    // SPACE is a visual/audio test only. Camera snapshots belong to FSR input.
    triggerImpact(random(0.45, 1), false);
    pressureTarget = random(0.55, 1);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
