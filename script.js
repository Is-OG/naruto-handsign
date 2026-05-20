(function(){
  // ----- DOM elements -----
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const signDisplay = document.getElementById('sign-display');
  const comboDisplay = document.getElementById('combo-display');
  const jutsuNameEl = document.getElementById('jutsu-name');
  const statusEl = document.getElementById('statusMsg');
  const flashEl = document.getElementById('flash');
  const resetClonesBtn = document.getElementById('resetClonesBtn');

  canvas.width = 640;
  canvas.height = 480;

  // ---------- RASENGAN COMBO SYSTEM (hand‑proportional scaling) ----------
  const COMBO = ['🐍 Snake', '🐦 Bird', '🖐️ Tiger'];
  let comboIndex = 0;
  let lastSign = '';
  let holdStart = null;
  const HOLD_MS = 150;
  let jutsuActive = false;

  let rasenX = 320, rasenY = 240;
  let rasenTargetX = 320, rasenTargetY = 240;
  let rasenAngle = 0;
  let rasenScale = 0;
  let rasenTargetScale = 0;
  let shakeFrames = 0;
  let time = 0;

  // Compute hand size on screen and map to Rasengan scale
  function getHandScaleFactor(landmarks) {
    if (!landmarks || landmarks.length < 21) return 1.0;
    const wrist = landmarks[0];
    const middleTip = landmarks[12];
    const dx = (wrist.x - middleTip.x) * canvas.width;
    const dy = (wrist.y - middleTip.y) * canvas.height;
    const handPixels = Math.sqrt(dx*dx + dy*dy);
    let scale = 0.6 + (handPixels - 80) * (0.8 / 100);
    scale = Math.min(1.6, Math.max(0.5, scale));
    return scale;
  }

  // ---------- CLONE SYSTEM (1 second hold) ----------
  let clonesTriggered = false;
  let cloneStartTime = null;
  let maskImage = null;
  let cloneHoldTimer = null;
  let cloneHoldActive = false;
  let cloneAutoResetTimer = null;
  
  const CLONE_HOLD_REQUIRED = 1000; // 1 second (was 1500)
  const CLONE_DURATION = 30000;     // 30 seconds
  
  const clones = [
    { x: -220, y: 80, scale: 1.0, delay: 800,  smokeSpawned: false },
    { x: 220,  y: 80, scale: 1.0, delay: 950,  smokeSpawned: false },
    { x: -140, y: 80, scale: 1.0, delay: 1150, smokeSpawned: false },
    { x: 140,  y: 80, scale: 1.0, delay: 1250, smokeSpawned: false }
  ];
  
  // --- ANIME WHITE SMOKE PARTICLES ---
  let activeSmokes = [];
  const SMOKE_FRAMES = [];

  for (let i = 0; i < 6; i++) {
    const sz = 90 + i * 8;
    const off = document.createElement('canvas');
    off.width = sz; off.height = sz;
    const octx = off.getContext('2d');
    const center = sz/2;
    const grad = octx.createRadialGradient(center, center, 5, center, center, center-5);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.95 - i*0.1})`);
    grad.addColorStop(0.3, `rgba(240, 240, 255, ${0.8 - i*0.1})`);
    grad.addColorStop(0.6, `rgba(200, 210, 230, ${0.5 - i*0.05})`);
    grad.addColorStop(0.85, `rgba(150, 160, 180, 0.2)`);
    grad.addColorStop(1, `rgba(100, 110, 130, 0)`);
    octx.fillStyle = grad;
    octx.fillRect(0, 0, sz, sz);
    octx.globalCompositeOperation = 'source-over';
    for(let b=0; b<3; b++) {
      octx.beginPath();
      octx.arc(center + (Math.random()-0.5)*12, center + (Math.random()-0.5)*12, sz*0.25, 0, Math.PI*2);
      octx.fillStyle = `rgba(255, 255, 255, ${0.3 + Math.random()*0.2})`;
      octx.fill();
    }
    SMOKE_FRAMES.push(off);
  }

  const BIG_POOF_FRAMES = [];
  for (let i = 0; i < 4; i++) {
    const sz = 120 + i * 10;
    const off = document.createElement('canvas');
    off.width = sz; off.height = sz;
    const octx = off.getContext('2d');
    const center = sz/2;
    const grad = octx.createRadialGradient(center, center, 8, center, center, center-8);
    grad.addColorStop(0, `rgba(255, 255, 255, 0.98)`);
    grad.addColorStop(0.4, `rgba(245, 245, 255, 0.85)`);
    grad.addColorStop(0.7, `rgba(210, 220, 240, 0.5)`);
    grad.addColorStop(1, `rgba(160, 170, 190, 0)`);
    octx.fillStyle = grad;
    octx.fillRect(0, 0, sz, sz);
    BIG_POOF_FRAMES.push(off);
  }

  function spawnSmoke(x, y, scaleFact = 0.9, isBig = false) {
    const frames = isBig ? BIG_POOF_FRAMES : SMOKE_FRAMES;
    activeSmokes.push({
      x, y, scale: scaleFact * 0.85,
      start: performance.now(),
      duration: isBig ? 800 : 650,
      frames: frames,
      big: isBig
    });
  }

  function burstSmoke(centerX, centerY) {
    spawnSmoke(centerX, centerY, 1.4, true);
    spawnSmoke(centerX - 25, centerY - 15, 1.0, true);
    spawnSmoke(centerX + 30, centerY - 10, 1.1, true);
    spawnSmoke(centerX - 15, centerY + 20, 0.9, true);
    spawnSmoke(centerX + 20, centerY + 25, 1.0, true);
    for(let i=0;i<6;i++) {
      const offX = centerX + (Math.random() - 0.5) * 70;
      const offY = centerY + (Math.random() - 0.5) * 60;
      spawnSmoke(offX, offY, 0.7 + Math.random()*0.4, false);
    }
  }

  function drawSmokes() {
    const now = performance.now();
    for (let i=activeSmokes.length-1; i>=0; i--) {
      const s = activeSmokes[i];
      const elapsed = now - s.start;
      let progress = Math.min(1, elapsed / s.duration);
      const frameIdx = Math.floor(progress * s.frames.length);
      if (frameIdx >= s.frames.length) {
        activeSmokes.splice(i,1);
        continue;
      }
      const img = s.frames[frameIdx];
      ctx.save();
      const scaleFactor = s.scale * (1 + progress * 0.3);
      ctx.globalAlpha = 1 - progress * 0.85;
      ctx.translate(s.x, s.y);
      ctx.scale(scaleFactor, scaleFactor);
      ctx.drawImage(img, -img.width/2, -img.height/2);
      ctx.restore();
    }
  }

  function updateCloneSmokes(startTime) {
    if (!clonesTriggered || !startTime) return;
    const now = performance.now();
    clones.forEach(cl => {
      if (!cl.smokeSpawned && (now - startTime >= cl.delay)) {
        cl.smokeSpawned = true;
        const centerX = (canvas.width/2) + cl.x;
        const centerY = (canvas.height/2) + cl.y;
        spawnSmoke(centerX-10, centerY-5, 0.8, false);
        spawnSmoke(centerX+15, centerY+5, 0.85, false);
        spawnSmoke(centerX, centerY-12, 0.75, false);
      }
    });
  }

  function resetClones() {
    if (cloneAutoResetTimer) {
      clearTimeout(cloneAutoResetTimer);
      cloneAutoResetTimer = null;
    }
    clonesTriggered = false;
    cloneStartTime = null;
    clones.forEach(cl => cl.smokeSpawned = false);
    activeSmokes = [];
    cloneHoldActive = false;
    if (cloneHoldTimer) clearInterval(cloneHoldTimer);
    cloneHoldTimer = null;
    statusEl.textContent = 'Clones vanished. Show Dog sign again to summon.';
    setTimeout(() => {
      if(statusEl.textContent.includes('vanished')) statusEl.textContent = 'Camera ready';
    }, 2000);
  }

  // Selfie Segmentation
  const selfieSeg = new SelfieSegmentation({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
  });
  selfieSeg.setOptions({ modelSelection: 1 });
  selfieSeg.onResults(res => { maskImage = res.segmentationMask; });

  function extractPersonCutout() {
    if (!maskImage || canvas.width === 0) return null;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const tmpCtx = off.getContext('2d');
    tmpCtx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
    tmpCtx.globalCompositeOperation = 'source-in';
    tmpCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    tmpCtx.globalCompositeOperation = 'source-over';
    return off;
  }

  function drawClonesAndLeader(personCanvas, startTime) {
    if (!personCanvas) return;
    const now = performance.now();
    clones.forEach(cl => {
      if (now - startTime >= cl.delay) {
        ctx.save();
        const offX = cl.x + canvas.width/2;
        const offY = cl.y + canvas.height/2;
        ctx.translate(offX, offY);
        ctx.scale(cl.scale, cl.scale);
        ctx.drawImage(personCanvas, -personCanvas.width/2, -personCanvas.height/2);
        ctx.restore();
      }
    });
    ctx.drawImage(personCanvas, 0, 0, canvas.width, canvas.height);
  }

  // ---------- Hand sign detection (any hand) ----------
  function isFingerUp(lm, tip, pip) { return lm[tip].y < lm[pip].y - 0.03; }
  function isThumbUp(lm, handedness) {
    if (handedness === 'Right') return lm[4].x < lm[3].x - 0.02;
    else return lm[4].x > lm[3].x + 0.02;
  }
  function detectSign(lm, handedness) {
    const thumb = isThumbUp(lm, handedness),
          index = isFingerUp(lm, 8, 6),
          middle = isFingerUp(lm, 12, 10),
          ring = isFingerUp(lm, 16, 14),
          pinky = isFingerUp(lm, 20, 18);
    if (!thumb && !index && !middle && !ring && !pinky) return '🐍 Snake';
    if (thumb && index && middle && ring && pinky) return '🖐️ Tiger';
    if (!thumb && !index && !middle && !ring && pinky) return '🐦 Bird';
    if (!thumb && index && middle && !ring && !pinky) return '🐶 Dog';
    if (thumb && !index && !middle && !ring && !pinky) return '🐂 Ox';
    return '🤔 Keep trying...';
  }

  // ---------- Rasengan drawing and effects ----------
  function triggerFlash() {
    flashEl.style.opacity = '1';
    setTimeout(() => flashEl.style.opacity = '0.5', 60);
    setTimeout(() => flashEl.style.opacity = '0', 400);
  }
  function triggerShake() { shakeFrames = 20; }
  function updateComboUI() {
    comboDisplay.innerHTML = COMBO.map((sign, i) => {
      const em = sign.split(' ')[0];
      let cls = i < comboIndex ? 'done' : (i === comboIndex ? 'next' : 'todo');
      let html = `<span class="csign ${cls}">${em}</span>`;
      if (i < COMBO.length-1) html += `<span class="arrow">›</span>`;
      return html;
    }).join('');
  }
  function activateJutsu(x, y, handLandmarks) {
    if (jutsuActive) return;
    jutsuActive = true;
    jutsuNameEl.classList.add('show');
    if (handLandmarks) {
      rasenTargetScale = getHandScaleFactor(handLandmarks);
      rasenScale = rasenTargetScale * 0.3;
    } else {
      rasenTargetScale = 1.0;
      rasenScale = 0.3;
    }
    triggerFlash();
    triggerShake();
    statusEl.textContent = '🌀 RASENGAN — size follows your hand (close = big, far = small)';
  }
  function deactivateJutsu() {
    jutsuActive = false;
    jutsuNameEl.classList.remove('show');
    rasenScale = 0;
    rasenTargetScale = 0;
    comboIndex = 0;
    updateComboUI();
    statusEl.textContent = 'Rasengan cancelled — show hand to restart';
  }

  function drawRasengan(x, y, angle, scale) {
    if (scale <= 0) return;
    time++;
    const r = 58 * Math.min(scale, 1.6);
    const pulse = 1 + Math.sin(time * 0.12) * 0.025;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = Math.min(scale, 1);
    const outerAura = ctx.createRadialGradient(0,0,r*0.2, 0,0,r*3.4);
    outerAura.addColorStop(0,'rgba(150,255,255,0.04)');
    outerAura.addColorStop(0.25,'rgba(0,210,255,0.08)');
    outerAura.addColorStop(0.55,'rgba(0,110,255,0.05)');
    outerAura.addColorStop(1,'rgba(0,0,255,0)');
    ctx.beginPath(); ctx.arc(0,0,r*3.4*pulse,0,Math.PI*2); ctx.fillStyle=outerAura; ctx.fill();
    for(let i=0;i<28;i++){
      const a = Math.random()*Math.PI*2;
      const dist = Math.random()*r*1.5;
      const size = Math.random()*r*0.9;
      const px = Math.cos(a)*dist, py = Math.sin(a)*dist;
      const fog = ctx.createRadialGradient(px,py,0, px,py,size);
      fog.addColorStop(0,'rgba(120,220,255,0.04)');
      fog.addColorStop(1,'rgba(0,0,255,0)');
      ctx.beginPath(); ctx.arc(px,py,size,0,Math.PI*2); ctx.fillStyle=fog; ctx.fill();
    }
    const sphere = ctx.createRadialGradient(-r*0.2,-r*0.2,r*0.03, 0,0,r);
    sphere.addColorStop(0,'rgba(255,255,255,1)');
    sphere.addColorStop(0.10,'rgba(210,250,255,1)');
    sphere.addColorStop(0.30,'rgba(90,235,255,0.92)');
    sphere.addColorStop(0.58,'rgba(0,155,255,0.72)');
    sphere.addColorStop(0.85,'rgba(0,70,220,0.34)');
    sphere.addColorStop(1,'rgba(0,40,180,0)');
    ctx.beginPath(); ctx.arc(0,0,r*pulse,0,Math.PI*2); ctx.fillStyle=sphere; ctx.shadowColor='#00cfff'; ctx.shadowBlur=45; ctx.fill();
    ctx.save(); ctx.rotate(angle*0.8);
    for(let i=0;i<170;i++){
      const startA = Math.random()*Math.PI*2, endA = startA+(Math.random()-0.5)*2;
      const startR = Math.random()*r*0.92, endR = Math.random()*r*0.92;
      const sx = Math.cos(startA)*startR, sy = Math.sin(startA)*startR;
      const ex = Math.cos(endA)*endR, ey = Math.sin(endA)*endR;
      const c1x = (sx+ex)/2+(Math.random()-0.5)*25, c1y = (sy+ey)/2+(Math.random()-0.5)*25;
      ctx.beginPath(); ctx.moveTo(sx,sy); ctx.quadraticCurveTo(c1x,c1y,ex,ey);
      ctx.strokeStyle = `rgba(255,255,255,${0.18+Math.random()*0.25})`;
      ctx.lineWidth = 0.7+Math.random()*1.1;
      ctx.shadowColor='rgba(255,255,255,0.7)'; ctx.shadowBlur=5;
      ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.rotate(-angle*1.5);
    for(let i=0;i<12;i++){ ctx.rotate(Math.PI*2/12);
      ctx.beginPath(); ctx.arc(0,0,r*0.46,-0.7,0.7);
      ctx.strokeStyle='rgba(150,255,255,0.12)'; ctx.lineWidth=1.3; ctx.shadowColor='#88ffff'; ctx.shadowBlur=8; ctx.stroke();
    }
    ctx.restore();
    const core = ctx.createRadialGradient(0,0,0, 0,0,r*0.30);
    core.addColorStop(0,'rgba(255,255,255,1)');
    core.addColorStop(0.4,'rgba(220,255,255,0.95)');
    core.addColorStop(0.8,'rgba(120,255,255,0.35)');
    core.addColorStop(1,'rgba(0,255,255,0)');
    ctx.beginPath(); ctx.arc(0,0,r*0.30,0,Math.PI*2); ctx.fillStyle=core; ctx.shadowColor='white'; ctx.shadowBlur=30; ctx.fill();
    ctx.restore();
  }
  function drawSkeleton(lm, alpha) {
    ctx.globalAlpha = alpha;
    const HAND_CONNECTIONS = [
      [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12], [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20]
    ];
    for (const conn of HAND_CONNECTIONS) {
      const s = lm[conn[0]], e = lm[conn[1]];
      ctx.beginPath();
      ctx.moveTo(s.x*640, s.y*480);
      ctx.lineTo(e.x*640, e.y*480);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 4;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const l of lm) {
      ctx.beginPath();
      ctx.arc(l.x*640, l.y*480, 5, 0, Math.PI*2);
      ctx.fillStyle = '#ff3333';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- MediaPipe Hands ----------
  const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

  hands.onResults((results) => {
    if (shakeFrames > 0) {
      shakeFrames--;
      const s = (shakeFrames / 20) * 6;
      canvas.style.transform = `scaleX(-1) translate(${(Math.random()-.5)*s}px, ${(Math.random()-.5)*s}px)`;
    } else {
      canvas.style.transform = 'scaleX(-1)';
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    let personCutout = null;
    if (maskImage) personCutout = extractPersonCutout();
    
    const handFound = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
    let activeHandLandmarks = null;
    let handednessLabel = null;
    if (handFound) {
      activeHandLandmarks = results.multiHandLandmarks[0];
      handednessLabel = results.multiHandedness[0].label;
    }

    // ----- CLONE JUTSU (1 second hold) -----
    let isDogSign = false;
    if (activeHandLandmarks) {
      const sign = detectSign(activeHandLandmarks, handednessLabel);
      isDogSign = (sign === '🐶 Dog');
      if (isDogSign) {
        if (!cloneHoldActive && !clonesTriggered) {
          cloneHoldActive = true;
          const startTime = Date.now();
          if (cloneHoldTimer) clearInterval(cloneHoldTimer);
          cloneHoldTimer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= CLONE_HOLD_REQUIRED && !clonesTriggered) {
              clearInterval(cloneHoldTimer);
              cloneHoldTimer = null;
              cloneHoldActive = false;
              clonesTriggered = true;
              cloneStartTime = performance.now();
              burstSmoke(canvas.width/2, canvas.height/2);
              statusEl.textContent = '💨 SHADOW CLONE JUTSU! White smoke burst! Clones for 30s.';
              if (cloneAutoResetTimer) clearTimeout(cloneAutoResetTimer);
              cloneAutoResetTimer = setTimeout(() => {
                resetClones();
                statusEl.textContent = 'Clones faded after 30 seconds. Recast with Dog sign.';
                setTimeout(() => {
                  if(statusEl.textContent.includes('faded')) statusEl.textContent = 'Camera ready';
                }, 2000);
              }, CLONE_DURATION);
            }
          }, 50);
        }
      } else {
        if (cloneHoldActive) {
          clearInterval(cloneHoldTimer);
          cloneHoldTimer = null;
          cloneHoldActive = false;
        }
      }
    } else {
      if (cloneHoldActive) {
        clearInterval(cloneHoldTimer);
        cloneHoldTimer = null;
        cloneHoldActive = false;
      }
    }

    // draw clones if triggered
    if (clonesTriggered && cloneStartTime && personCutout) {
      updateCloneSmokes(cloneStartTime);
      drawClonesAndLeader(personCutout, cloneStartTime);
      drawSmokes();
    } else if (personCutout) {
      ctx.drawImage(personCutout, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    // ----- RASENGAN with hand‑size‑proportional scaling -----
    if (jutsuActive) {
      if (!handFound) {
        deactivateJutsu();
      } else {
        const lm = activeHandLandmarks;
        rasenTargetScale = getHandScaleFactor(lm);
        rasenScale = rasenScale * 0.92 + rasenTargetScale * 0.08;
        rasenScale = Math.min(1.6, Math.max(0.3, rasenScale));
        
        const palmX = (lm[0].x + lm[5].x + lm[9].x + lm[13].x)/4;
        const palmY = (lm[0].y + lm[5].y + lm[9].y + lm[13].y)/4;
        const dx = lm[9].x - lm[0].x;
        const dy = lm[9].y - lm[0].y;
        rasenTargetX = (palmX + dx*0.35) * 640;
        rasenTargetY = (palmY + dy*0.35) * 480;
        rasenX += (rasenTargetX - rasenX) * 0.20;
        rasenY += (rasenTargetY - rasenY) * 0.20;
        rasenAngle += 0.09;
        
        drawSkeleton(lm, 0.15);
        drawRasengan(rasenX, rasenY, rasenAngle, rasenScale);
        signDisplay.textContent = '';
        statusEl.textContent = `🌀 RASENGAN (size: ${Math.round(rasenScale*100)}%) — scales with your hand`;
        return;
      }
    }

    // Normal hand sign detection for combo
    if (!handFound) {
      signDisplay.textContent = 'Waiting for hand...';
      statusEl.textContent = 'Show either hand for signs';
      holdStart = null;
      lastSign = '';
      return;
    }

    const lm = activeHandLandmarks;
    const handedness = handednessLabel;
    drawSkeleton(lm, 1);
    const sign = detectSign(lm, handedness);
    signDisplay.textContent = sign;
    statusEl.textContent = `Hand: ${handedness}  |  Combo: ${COMBO[comboIndex] || 'done'}`;

    if (!sign.includes('Keep trying') && sign === COMBO[comboIndex]) {
      if (sign !== lastSign) {
        holdStart = Date.now();
        lastSign = sign;
      }
      if (holdStart) {
        const elapsed = Date.now() - holdStart;
        if (elapsed >= HOLD_MS) {
          holdStart = null;
          comboIndex++;
          updateComboUI();
          if (comboIndex >= COMBO.length) {
            const palmX = (lm[0].x + lm[5].x + lm[9].x + lm[13].x)/4;
            const palmY = (lm[0].y + lm[5].y + lm[9].y + lm[13].y)/4;
            const dx = lm[9].x - lm[0].x;
            const dy = lm[9].y - lm[0].y;
            activateJutsu((palmX + dx*0.35)*640, (palmY + dy*0.35)*480, lm);
          }
        }
      }
    } else {
      if (sign !== lastSign) {
        lastSign = sign;
        holdStart = null;
        if (!sign.includes('Keep trying') && sign !== COMBO[comboIndex]) {
          comboIndex = (sign === COMBO[0]) ? 1 : 0;
          updateComboUI();
        }
      }
    }
  });

  updateComboUI();

  // Camera initialization
  const camera = new Camera(video, {
    onFrame: async () => {
      await selfieSeg.send({ image: video });
      await hands.send({ image: video });
    },
    width: 640,
    height: 480
  });
  camera.start().then(() => {
    statusEl.textContent = 'Camera ready! Hold 🐶 Dog sign 1 second → white smoke burst + clones (30s). Rasengan size follows your hand.';
  }).catch(e => {
    statusEl.textContent = 'Camera error: ' + e.message;
  });

  resetClonesBtn.addEventListener('click', () => {
    resetClones();
  });
})();