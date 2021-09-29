const N_NOTES = 12 * 4;
const LOOP_DURATION = 8; // seconds
const noteLines = [];
const parts = [];
const lowestFreq = 55;

let isDrawing = false;
let currentDrawingPath = [];
let lockedMouseY = null;

let activeType = "PAD";

const outputNode = new Tone.Gain(0.5);
outputNode.chain(
  new Tone.Chorus(),
  new Tone.Reverb({ decay: 5, wet: 0.4 }),
  new Tone.Limiter(-1),
  Tone.Destination
);

Tone.Transport.loop = true;
Tone.Transport.loopEnd = LOOP_DURATION;

const LINE_TYPES = {
  PAD: {
    color: [100, 40, 70],
    getSynth: () =>
      new Tone.MonoSynth({
        volume: -10,
        // oscillator: "triangle",
        oscillator: {
          type: "sawtooth",
        },
        filter: {
          Q: 4,
          type: "lowpass",
          rolloff: -48,
        },
        envelope: { attack: 0.8, sustain: 0.1, decay: 3, release: 1 },
        filterEnvelope: { attack: 1, sustain: 0.4, decay: 1.4, release: 3 },
      }),
  },
  MEMBRANE: {
    color: [300, 40, 70],
    getSynth: () =>
      new Tone.MembraneSynth({
        volume: -12,
        envelope: { attack: 0.4, decay: 3, release: 0.5 },
        filterEnvelope: { attack: 1, sustain: 0.4, decay: 1.4, release: 3 },
      }),
  },
  BASS: {
    color: [50, 40, 70],
    getSynth: () =>
      new Tone.MonoSynth({
        portamento: 0.08,
        oscillator: {
          partials: [2, 1, 3, 2, 0.4],
          volume: -6,
        },
        filter: {
          Q: 4,
          type: "lowpass",
          rolloff: -48,
        },
        envelope: {
          attack: 0.04,
          decay: 0.06,
          sustain: 0.4,
          release: 1,
        },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0.6,
          release: 1.5,
          baseFrequency: 50,
          octaves: 3.4,
        },
      }),
  },
  KEYS: {
    color: [150, 40, 70],
    getSynth: () =>
      new Tone.Synth({
        volume: -4,
        portamento: 0,
        oscillator: {
          detune: 0,
          type: "custom",
          partials: [2, 1, 2, 2],
          phase: 0,
          volume: -6,
        },
        envelope: {
          attack: 0.05,
          decay: 0.3,
          sustain: 0.2,
          release: 1,
        },
      }),
  },
  STRINGS: {
    color: [10, 40, 70],
    getSynth: () =>
      new Tone.FMSynth({
        harmonicity: 3.01,
        modulationIndex: 14,
        oscillator: {
          type: "triangle",
        },
        envelope: {
          attack: 0.3,
          decay: 1,
          sustain: 0.5,
          release: 1.2,
        },
        modulation: {
          type: "square",
        },
        modulationEnvelope: {
          attack: 0.5,
          decay: 0.5,
          sustain: 0.2,
          release: 0.1,
        },
      }),
  },
};

const yPosToFreq = (y) => {
  //   F = 440 × 2 ^ n / 12
  const invertedY = height - y;
  const note = (invertedY / height) * N_NOTES;
  return lowestFreq * pow(2, note / 12);
};

const xToSeconds = (x) => {
  return (x / width) * LOOP_DURATION;
};

secondsToXWidth = (s) => {
  return (s / LOOP_DURATION) * width;
};

function pathToTonePart(path) {
  const sortedPath = path.sort((a, b) => a[0] - b[0]);
  return sortedPath.map((pt, i) => {
    const [x, y] = pt;
    const isFirst = i === 0;
    const isLast = i === sortedPath.length - 1;
    const startTime = (x / width) * LOOP_DURATION;
    const freq = yPosToFreq(y);
    if (isLast) {
      return {
        isFirst: false,
        isLast: true,
        time: startTime,
        freq,
      };
    }

    const [nextX, nextY] = sortedPath[i + 1];
    const nextFreq = yPosToFreq(nextY);
    const duration = xToSeconds(nextX - x);

    return {
      isFirst,
      isLast: false,
      time: startTime,
      freq,
      nextFreq,
      duration,
    };
  });
}

function NoteLine({ path: initPath, type }) {
  const [startX, startY] = initPath[0];
  const [endX, endY] = initPath[initPath.length - 1];
  const { color, getSynth } = LINE_TYPES[type];

  this.lineColor = color;
  this.startMillis = millis();
  this.lifeSpan = 6 * LOOP_DURATION; // six loops
  this.isActive = true;

  this.outputGain = new Tone.Gain();
  this.outputGain.connect(outputNode);

  const synth = getSynth();
  synth.connect(this.outputGain);

  this.outputGain.gain.rampTo(0, this.lifeSpan);
  const { release } = synth.envelope;
  const endPointWithRelease = [endX + secondsToXWidth(release), endY];
  const path = [...initPath, endPointWithRelease];
  const partData = pathToTonePart(path);

  const getLifeProgress = (currMillis) => {
    return (currMillis - this.startMillis) / (this.lifeSpan * 1000);
  };

  const tonePart = new Tone.Part((time, value) => {
    const { velocity, freq, isFirst, isLast, nextFreq, duration } = value;
    if (isFirst) {
      synth.triggerAttack(freq);
    } else {
      // TODO look ahead and ramp over duration of distance
      synth.frequency.rampTo(nextFreq, duration);
    }
    if (isLast) {
      synth.triggerRelease();
    }
  }, partData).start(0);

  const destroy = () => {
    tonePart.dispose();
    synth.dispose();
    this.isActive = false;
  };

  const getPointAttrs = (xPos) => {
    const maxSize = 30;

    const { attack, decay, sustain, release } = synth.envelope;
    const attackWidth = secondsToXWidth(attack);
    const decayWidth = secondsToXWidth(decay);
    const releaseWidth = secondsToXWidth(release);
    const isInAttack = xPos - startX < attackWidth;
    const isInRelease = xPos > endX;
    const localX = xPos - startX;
    if (isInRelease) {
      const percentAlong = xPos - endX;
      const startSize = maxSize * sustain;
      const endSize = 0;
      // TODO should be current size (if in attack)
      return {
        weight: (1 - percentAlong / releaseWidth) * (maxSize * sustain),
        alpha: (1 - percentAlong / releaseWidth) * 1,
      };
    }

    if (isInAttack) {
      return {
        weight: (localX / attackWidth) * maxSize,
        alpha: localX / attackWidth,
      };
    }

    const isInDecay = xPos - startX < attackWidth + decayWidth;
    if (isInDecay) {
      const percentAlong = localX - attackWidth;
      const endSize = maxSize * sustain;
      return {
        weight: (1 - percentAlong / decayWidth) * (maxSize - endSize) + endSize,
        alpha: 1,
      };
    }

    return { weight: maxSize * sustain, alpha: 1 };
  };

  const gr = createGraphics(width, height);
  gr.noStroke();
  gr.colorMode(HSL);
  path.forEach((pt, i) => {
    const nextPt = path[i + 1];
    const [x, y] = pt;
    if (nextPt) {
      const xDist = Math.sqrt(
        Math.pow(nextPt[0] - x, 2) + Math.pow(nextPt[1] - y, 2)
      );
      for (let i = 0; i < xDist; i++) {
        const mX = lerp(x, nextPt[0], i / xDist);
        const mY = lerp(y, nextPt[1], i / xDist);
        // gr.circle(mX, mY, getPointAttrs(mX));
        const { weight, alpha } = getPointAttrs(mX);
        gr.rectMode(CENTER);
        console.log(alpha);
        gr.fill(...this.lineColor, alpha);
        gr.rect(mX, mY, 1, weight);
      }
    }
  });

  return {
    draw: (currMillis) => {
      if (!this.isActive) {
        return;
      }
      const lifeProgress = getLifeProgress(currMillis);
      if (lifeProgress >= 1) {
        destroy();
        return;
      }
      // tint(255, 255 * (1 - frameCount / 1000));
      // scale(1, 1 - lifeProgress);
      drawingContext.globalAlpha = 1 - lifeProgress;
      // before drawing the image, and restoring it with
      image(gr, 0, 0);
      drawingContext.globalAlpha = 1;
    },
  };
}

function setup() {
  pixelDensity(1);
  // frameRate(30);
  createCanvas(1200, 800);
  const playBtn = createButton("play");
  playBtn.mousePressed(() => {
    Tone.Transport.toggle();
  });
}

function getMousePos() {
  // Snap to note frequencies
  if (keyIsDown(SHIFT)) {
    if (lockedMouseY && isDrawing) {
      return [mouseX, lockedMouseY];
    }
    const gridSize = height / N_NOTES;
    snappedY = round(mouseY / gridSize) * gridSize;
    lockedMouseY = snappedY;
    return [mouseX, snappedY];
  } else {
    lockedMouseY = null;
    return [mouseX, mouseY];
  }
}

function draw() {
  const [mx, my] = getMousePos();
  colorMode(HSL);
  const { color: activeDrawColor } = LINE_TYPES[activeType];

  background(140);
  push();
  for (let i = 0; i < N_NOTES; i++) {
    const yPos = height - (i / N_NOTES) * height;
    // const yFreq = yPosToFreq(yPos);
    fill(0, 20);
    noStroke();
    /* NOTE: assumes first note is an A */
    let isWhiteNote = [0, 2, 3, 5, 7, 8, 10].includes(i % 12);
    const fillC = isWhiteNote ? 255 : 40;
    fill(fillC, 100);
    const rectHeight = height / N_NOTES;
    const halfHeight = rectHeight / 2;
    // text(yFreq.toPrecision(5), 5, yPos);
    // text(i % 12, 60, yPos);
    // text(i, 160, yPos);
    const isMouseHovering = my > yPos - halfHeight && my < yPos + halfHeight;
    // fill(((i % 12) / 12) * 360, 50, isMouseHovering ? 5 : 5, 1);
    // rect(0, yPos - 12, width, 23);
    // fill(((i % 12) / 12) * 180, 50, isMouseHovering ? 70 : 50, 0.5);

    if (isMouseHovering) {
      fill(...activeDrawColor, 0.1);
      rect(0, yPos - halfHeight, width, rectHeight);
      fill(...activeDrawColor, 0.3);
      rect(0, yPos, width, 1);
    }

    if (isMouseHovering) {
      fill(...activeDrawColor);
    } else {
      strokeWeight(1);
      stroke(40, 0.1);
      fill(fillC, 0.9);
    }
    rect(0, yPos - halfHeight, 20, rectHeight);
    fill(fillC, 40);
    // rect(0, yPos, width, 1);
  }
  pop();

  for (let i = 0; i < 8; i++) {
    fill(0, 0.05);
    noStroke();
    const xPos = i * (width / 8);
    rect(xPos, 0, 1, height);
  }

  push();

  // current line

  noFill();

  currentDrawingPath.forEach((pt) => {
    beginShape(POINTS);
    stroke([...activeDrawColor]);
    strokeWeight(2);
    vertex(pt[0], pt[1]);
    endShape();
  });
  pop();

  // lines
  push();
  noFill();

  /* Draw lines */
  const currMillis = millis();
  noteLines.forEach((noteLine) => {
    noteLine.draw(currMillis);
  });

  pop();

  push();

  noFill();
  /* mouse Brush */
  stroke([...activeDrawColor]);
  strokeWeight(2);
  circle(mx, my, 20);
  pop();

  push();
  fill("orange");
  const playHeadX = Tone.Transport.progress * width;
  // console.log(deltaTime);
  rect(playHeadX, 0, 2, height);
  pop();
}

function keyPressed() {
  if (key === " ") {
    Tone.Transport.toggle();
  }
  if (key === "Escape") {
    isDrawing = false;
    currentDrawingPath = [];
  }
  if (key === "1") {
    activeType = "PAD";
  }
  if (key === "2") {
    activeType = "MEMBRANE";
  }
  if (key === "3") {
    activeType = "STRINGS";
  }
  if (key === "4") {
    activeType = "KEYS";
  }
  if (key === "5") {
    activeType = "BASS";
  }
}

function mousePressed() {
  isDrawing = true;
}

function mouseDragged() {
  if (isDrawing) {
    if (currentDrawingPath.length < 1) {
      currentDrawingPath.push(getMousePos());
      return;
    }

    const [lastX, lastY] = currentDrawingPath[currentDrawingPath.length - 1];
    const [mx, my] = getMousePos();

    if (dist(mx, my, lastX, lastY) > 4) {
      currentDrawingPath.push(getMousePos());
    }
    // console.log(currentDrawingPath);
  }
}

function mouseReleased() {
  if (isDrawing && currentDrawingPath.length > 2) {
    noteLines.push(
      new NoteLine({
        type: activeType,
        path: currentDrawingPath,
      })
    );
  }
  isDrawing = false;
  currentDrawingPath = [];
}
