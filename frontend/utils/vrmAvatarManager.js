// vrmAvatarManager.js — Local 3D VRM avatar rendering with audio-driven lip-sync.
// Loads Three.js + @pixiv/three-vrm from CDN on demand. Zero CDN cost when not used.

// Resting arm pose values (mirrored; Z brings arms down from T-pose)
const POSE_LIBRARY = {
  idle: {
    bones: {
      head:  { x: 0,     y: 0,     z:  0.0  },
      neck:  { x: 0,     y: 0,     z:  0.0  },
      spine:  { x: 0,     y: 0,     z:  0.0  },
      chest:  { x: 0,     y: 0,     z:  0.0  },

      leftShoulder:  { x: 0,     y: 0,     z:  0.1  },
      rightShoulder: { x: 0,     y: 0,     z: -0.1  },
      leftUpperArm:  { x: 0.15,  y: 0,     z:  1.2  },
      rightUpperArm: { x: 0.15,  y: 0,     z: -1.2  },
      leftLowerArm:  { x: 0,     y: 0,     z:  0.25 },
      rightLowerArm: { x: 0,     y: 0,     z: -0.25 },
    },
    duration: null,
  },
  wave: {
    bones: {
      rightShoulder: { x: 0.0,  y: 1.2,  z: -1.00 },
      rightUpperArm: { x: -0.03, y: -0.22, z: 0.68 },
      rightLowerArm: { x: 0.0, y: 0.0, z: 0.0 },
    },
    duration: 3.0,
    oscillate: {
      bone: 'rightLowerArm',
      axis: 'z',
      center: 2.0,
      amplitude: 0.18,
      frequency: 2.7
    },
  },
  listening: {
    bones: {
      head:          { x:  0.03, y:  0.04, z:  0.10 },
      neck:          { x:  0.01, y:  0.02, z:  0.04 },
      spine:         { x:  0.02, y:  0.00, z:  0.01 },
      chest:         { x:  0.02, y:  0.00, z:  0.01 },
    },
    duration: null,
  },
  thinking: {
    bones: {
      head:          { x:  0.30, y:  0.0, z:  0.10 },
      neck:          { x:  0.03, y:  0.02, z:  0.04 },
      spine:         { x:  0.02, y:  0.00, z:  0.01 },
      chest:         { x:  0.02, y:  0.00, z:  0.01 },
    },
    duration: null,
  },
  heart: {
    bones: {
      leftShoulder:  { x: 0,    y: 0.2,   z:  0.2  },
      rightShoulder: { x: 0,    y: -0.2,  z: -0.2  },
      leftUpperArm:  { x: 0.8,  y: -0.8,  z:  0.5  },
      rightUpperArm: { x: 0.8,  y:  0.8,  z: -0.5  },
      leftLowerArm:  { x: -1.0, y:  1.2,  z:  0.8  },
      rightLowerArm: { x: -1.0, y: -1.2,  z: -0.8  },
    },
    duration: null,
  },
  speaking: {
    bones: {
      rightShoulder: { x: 0.0, y: 0.2,  z: -0.2 },
      rightUpperArm: { x: 0.0, y: 0.3,  z: -0.5 },
      rightLowerArm: { x: 0.0, y: 0.0,  z:  1.5 },
    },
    duration: null,
  },
  shakehand: {
    bones: {
      rightShoulder: {x: 0.1, y: 0.7, z: -0.7},
      rightUpperArm: {x: 0.3, y: 0.8, z: 0.1},
      rightLowerArm: {x: 1.05, y: 0.0, z: -0.25}
    },
    duration: null
  }
};

class VrmAvatarManager {
  constructor() {
    // Three.js
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.vrm = null;
    this.clock = null;
    this.animationId = null;
    this._resizeObserver = null;

    // Web Audio
    this.audioContext = null;
    this.analyser = null;
    this.frequencyData = null;
    this._pendingAudioTrack = null;
    this._visibilityHandler = null;
    this._audioSource = null;

    // Agent state
    this.agentState = 'idle';

    // Animation state
    this._blinkTimer = 3.0;
    this._blinkPhase = 'idle';
    this._blinkProgress = 0;
    this._breathPhase = 0;
    this._headTarget = { x: 0, y: 0 };
    this._headCurrent = { x: 0, y: 0 };
    this._headSwayPhase = 0;
    this._targetExpression = 'neutral';

    // Lip-sync dynamics
    this._energyEnvelope = 0;
    this._speechTime = 0;

    // Pose animation
    this._poseActive = null;
    this._poseCurrent = {};
    this._poseElapsed = 0;
    this._poseOscPhase = 0;
    this._poseReturning = false;
  }

  // Dynamically inject Three.js + three-vrm via import map + module script.
  // Exposes window.THREE, window.GLTFLoader, window.VRMLoaderPlugin, window.VRMUtils.
  _loadDependencies() {
    return new Promise((resolve, reject) => {
      if (window.THREE && window.VRMLoaderPlugin) {
        resolve();
        return;
      }

      const importMap = document.createElement('script');
      importMap.type = 'importmap';
      importMap.textContent = JSON.stringify({
        imports: {
          'three': CONFIG.VRM_CDN.THREE,
          'three/addons/': CONFIG.VRM_CDN.THREE_ADDONS,
          '@pixiv/three-vrm': CONFIG.VRM_CDN.THREE_VRM,
        },
      });
      document.head.appendChild(importMap);

      const loaderScript = document.createElement('script');
      loaderScript.type = 'module';
      loaderScript.textContent = `
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
        window.THREE = THREE;
        window.GLTFLoader = GLTFLoader;
        window.VRMLoaderPlugin = VRMLoaderPlugin;
        window.VRMUtils = VRMUtils;
        window.dispatchEvent(new Event('vrm-libs-ready'));
      `;
      document.head.appendChild(loaderScript);

      const onReady = () => {
        clearTimeout(timeout);
        console.log('[VRM] CDN libraries loaded');
        resolve();
      };

      const timeout = setTimeout(() => {
        window.removeEventListener('vrm-libs-ready', onReady);
        reject(new Error('[VRM] CDN libraries failed to load within 15 seconds'));
      }, 15000);

      window.addEventListener('vrm-libs-ready', onReady, { once: true });
    });
  }

  _setupScene(container) {
    const { THREE } = window;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.zIndex = '1';
    container.appendChild(canvas);

    // Tap avatar → wave gesture
    canvas.addEventListener('click', () => {
      this.playPose('wave');
    });

    // Hide placeholder while VRM is showing
    const placeholder = container.querySelector('.avatar-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    this.camera = new THREE.PerspectiveCamera(
      20,
      container.clientWidth / container.clientHeight,
      0.1,
      20
    );
    this.camera.position.set(0, 1.35, 2.5);
    this.camera.lookAt(0, 1.25, 0);

    this.scene = new THREE.Scene();

    // Cyberpunk three-point lighting
    const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
    keyLight.position.set(2, 3, 2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8b2fc9, 0.3);
    fillLight.position.set(-2, 1, 1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00c8d8, 0.4);
    rimLight.position.set(0, 2, -2);
    this.scene.add(rimLight);

    const ambient = new THREE.AmbientLight(0x404050, 0.5);
    this.scene.add(ambient);

    this.clock = new THREE.Clock();

    this._resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(w, h);
    });
    this._resizeObserver.observe(container);

    console.log('[VRM] Scene set up');
  }

  _loadVRM(url, onProgress) {
    return new Promise((resolve, reject) => {
      const { GLTFLoader, VRMLoaderPlugin, VRMUtils } = window;
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));

      loader.load(
        url,
        (gltf) => {
          try {
            const vrm = gltf.userData.vrm;
            if (!vrm) {
              reject(new Error('[VRM] Loaded file is not a VRM model'));
              return;
            }
            VRMUtils.removeUnnecessaryJoints(vrm.scene);
            VRMUtils.removeUnnecessaryVertices(vrm.scene);
            vrm.scene.rotation.y = Math.PI;
            this.scene.add(vrm.scene);
            this.vrm = vrm;
            console.log('[VRM] Model loaded');
            if (onProgress) onProgress(100);
            resolve(vrm);
          } catch (e) {
            reject(e);
          }
        },
        (progress) => {
          if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[VRM] Loading model: ${pct}%`);
            if (onProgress) onProgress(pct);
          }
        },
        (err) => reject(new Error('[VRM] Model load failed: ' + err.message))
      );
    });
  }

  // Map frequency bands to VRM viseme weights using dynamic bin calculation.
  _computeVisemes(deltaTime) {
    if (!this.analyser || !this.frequencyData || !this.audioContext) {
      return { aa: 0, oh: 0, ih: 0, ee: 0, ou: 0 };
    }
    this.analyser.getByteFrequencyData(this.frequencyData);
    const sampleRate = this.audioContext.sampleRate;
    const binWidth = sampleRate / this.analyser.fftSize;
    const bandEnergy = (freqLow, freqHigh) => {
      const startBin = Math.floor(freqLow / binWidth);
      const endBin = Math.min(Math.floor(freqHigh / binWidth), this.frequencyData.length - 1);
      if (startBin > endBin) return 0;
      let sum = 0;
      for (let i = startBin; i <= endBin; i++) sum += this.frequencyData[i];
      return sum / ((endBin - startBin + 1) * 255);
    };
    const totalEnergy = bandEnergy(0, 5000);
    const gate = totalEnergy > 0.10 ? 1.0 : 0.0;

    const envelopeUp = 6.0, envelopeDown = 1.5;
    const envelopeSpeed = totalEnergy > this._energyEnvelope ? envelopeUp : envelopeDown;
    this._energyEnvelope += (totalEnergy - this._energyEnvelope) * Math.min(1, envelopeSpeed * deltaTime);

    const envelopeSafe = Math.max(this._energyEnvelope, 0.05);
    let dynamicMod = Math.min(1.0, totalEnergy / envelopeSafe);

    this._speechTime += deltaTime;
    const syllableWobble = 0.85 + 0.15 * Math.sin(this._speechTime * Math.PI * 2 * 7);
    dynamicMod *= syllableWobble;

    return {
      aa: Math.min(0.55, bandEnergy(0, 400) * 0.6 * gate * dynamicMod),
      oh: Math.min(0.50, bandEnergy(400, 1000) * 0.5 * gate * dynamicMod),
      ih: Math.min(0.45, bandEnergy(1000, 2000) * 0.5 * gate * dynamicMod),
      ee: Math.min(0.40, bandEnergy(2000, 3500) * 0.45 * gate * dynamicMod),
      ou: Math.min(0.35, bandEnergy(3500, 5000) * 0.35 * gate * dynamicMod),
    };
  }

  _applyVisemes(visemes, deltaTime) {
    if (!this.vrm?.expressionManager) return;
    const speed = 12.0;
    for (const name of ['aa', 'ih', 'ou', 'ee', 'oh']) {
      const current = this.vrm.expressionManager.getValue(name) || 0;
      const next = current + (visemes[name] - current) * Math.min(1, speed * deltaTime);
      this.vrm.expressionManager.setValue(name, next);
    }
  }

  _relaxVisemes(deltaTime) {
    if (!this.vrm?.expressionManager) return;
    const speed = 5.0;
    for (const name of ['aa', 'ih', 'ou', 'ee', 'oh']) {
      const current = this.vrm.expressionManager.getValue(name) || 0;
      if (current > 0.001) {
        this.vrm.expressionManager.setValue(name, current - current * Math.min(1, speed * deltaTime));
      } else {
        this.vrm.expressionManager.setValue(name, 0);
      }
    }
  }

  _updateBlink(deltaTime) {
    if (!this.vrm?.expressionManager) return;

    if (this._blinkPhase === 'idle') {
      this._blinkTimer -= deltaTime;
      if (this._blinkTimer <= 0) {
        this._blinkPhase = 'closing';
        this._blinkProgress = 0;
      }
    } else if (this._blinkPhase === 'closing') {
      this._blinkProgress += deltaTime / 0.06;
      if (this._blinkProgress >= 1) {
        this._blinkProgress = 1;
        this._blinkPhase = 'holding';
        this._blinkTimer = 0.04;
      }
      this.vrm.expressionManager.setValue('blink', this._blinkProgress);
    } else if (this._blinkPhase === 'holding') {
      this._blinkTimer -= deltaTime;
      if (this._blinkTimer <= 0) {
        this._blinkPhase = 'opening';
        this._blinkProgress = 1;
      }
    } else if (this._blinkPhase === 'opening') {
      this._blinkProgress -= deltaTime / 0.1;
      if (this._blinkProgress <= 0) {
        this._blinkProgress = 0;
        this._blinkPhase = 'idle';
        this._blinkTimer = 4.0 + Math.random() * 4.0;
      }
      this.vrm.expressionManager.setValue('blink', this._blinkProgress);
    }
  }

  _updateBreathing(deltaTime) {
    if (!this.vrm?.humanoid) return;
    this._breathPhase += deltaTime * 0.8;
    const breath = Math.sin(this._breathPhase * Math.PI * 2) * 0.005;
    const spineNode = this.vrm.humanoid.getNormalizedBoneNode('spine');
    if (spineNode) spineNode.rotation.x = breath;
  }

  _updateHeadMovement(deltaTime) {
    if (!this.vrm?.humanoid) return;

    this._headSwayPhase += deltaTime;

    switch (this.agentState) {
      case 'idle':
        this._headTarget.x = Math.sin(this._headSwayPhase * 0.3) * 0.04;
        this._headTarget.y = Math.sin(this._headSwayPhase * 0.2) * 0.06;
        break;
      case 'listening':
        this._headTarget.x = 0.04;
        this._headTarget.y = Math.sin(this._headSwayPhase * 0.15) * 0.03;
        break;
      case 'thinking':
        this._headTarget.x = Math.sin(this._headSwayPhase * 0.4) * 0.05;
        this._headTarget.y = Math.sin(this._headSwayPhase * 0.1) * 0.02;
        break;
      case 'speaking':
        this._headTarget.x = Math.sin(this._headSwayPhase * 0.6) * 0.03;
        this._headTarget.y = Math.sin(this._headSwayPhase * 0.5) * 0.05;
        break;
      default:
        break;
    }

    const speed = 3.0;
    this._headCurrent.x += (this._headTarget.x - this._headCurrent.x) * Math.min(1, speed * deltaTime);
    this._headCurrent.y += (this._headTarget.y - this._headCurrent.y) * Math.min(1, speed * deltaTime);

    const headNode = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (headNode) {
      headNode.rotation.x = this._headCurrent.x;
      headNode.rotation.y = this._headCurrent.y;
    }
  }

  _updateExpressions(deltaTime) {
    if (!this.vrm?.expressionManager) return;

    let happyTarget = 0;
    switch (this.agentState) {
      case 'listening': happyTarget = 0.15; break;
      case 'speaking':  happyTarget = 0.10; break;
      default:          happyTarget = 0;    break;
    }

    const speed = 2.0;
    const currentHappy = this.vrm.expressionManager.getValue('happy') || 0;
    this.vrm.expressionManager.setValue(
      'happy',
      currentHappy + (happyTarget - currentHappy) * Math.min(1, speed * deltaTime)
    );
  }

  _animate() {
    if (!this.renderer) return;
    this.animationId = requestAnimationFrame(() => this._animate());
    const delta = this.clock.getDelta();

    if (this.vrm) {
      this.vrm.update(delta);

      if (this.agentState === 'speaking' && this.analyser) {
        this._applyVisemes(this._computeVisemes(delta), delta);
      } else {
        this._relaxVisemes(delta);
        this._speechTime = 0;
        this._energyEnvelope = 0;
      }

      this._updateBlink(delta);
      this._updateBreathing(delta);
      this._updateHeadMovement(delta);
      this._updateExpressions(delta);
      this._updatePoseAnimation(delta);
    }

    this.renderer.render(this.scene, this.camera);
  }

  playPose(name) {
    if (!POSE_LIBRARY[name]) { console.warn('[VRM] Unknown pose:', name); return; }
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;
    const def = POSE_LIBRARY[name];

    const allBones = new Set([
      ...Object.keys(def.bones),
      ...Object.keys(POSE_LIBRARY.idle.bones),
    ]);
    if (def.oscillate) allBones.add(def.oscillate.bone);

    this._poseCurrent = {};
    for (const bone of allBones) {
      const node = h.getNormalizedBoneNode(bone);
      if (node) this._poseCurrent[bone] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
    }

    this._poseActive = name;
    this._poseElapsed = 0;
    this._poseOscPhase = 0;
    this._poseReturning = name === 'idle';
  }

  _updatePoseAnimation(deltaTime) {
    if (!this._poseActive) return;
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;
    const def = POSE_LIBRARY[this._poseActive];
    const SPEED = 4.0;

    this._poseElapsed += deltaTime;

    if (def.duration !== null && this._poseElapsed >= def.duration && !this._poseReturning) {
      this._poseReturning = true;
      for (const bone of Object.keys(this._poseCurrent)) {
        const node = h.getNormalizedBoneNode(bone);
        if (node) this._poseCurrent[bone] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
      }
    }

    const targetBones = this._poseReturning ? POSE_LIBRARY.idle.bones : def.bones;

    for (const [boneName, cur] of Object.entries(this._poseCurrent)) {
      if (!this._poseReturning && def.oscillate?.bone === boneName) continue;

      const tgt = targetBones[boneName] ?? POSE_LIBRARY.idle.bones[boneName];
      if (!tgt) continue;
      const node = h.getNormalizedBoneNode(boneName);
      if (!node) continue;

      cur.x += (tgt.x - cur.x) * Math.min(1, SPEED * deltaTime);
      cur.y += (tgt.y - cur.y) * Math.min(1, SPEED * deltaTime);
      cur.z += (tgt.z - cur.z) * Math.min(1, SPEED * deltaTime);
      node.rotation.x = cur.x;
      node.rotation.y = cur.y;
      node.rotation.z = cur.z;
    }

    if (def.oscillate && !this._poseReturning) {
      const osc = def.oscillate;
      this._poseOscPhase += deltaTime * osc.frequency * Math.PI * 2;
      const value = osc.center + Math.sin(this._poseOscPhase) * osc.amplitude;
      const node = h.getNormalizedBoneNode(osc.bone);
      if (node) {
        node.rotation[osc.axis] = value;
        if (this._poseCurrent[osc.bone]) this._poseCurrent[osc.bone][osc.axis] = value;
      }
    }

    if (this._poseReturning) {
      let err = 0;
      const idle = POSE_LIBRARY.idle.bones;
      for (const [boneName, cur] of Object.entries(this._poseCurrent)) {
        const tgt = idle[boneName];
        if (!tgt) continue;
        const dx = tgt.x - cur.x, dy = tgt.y - cur.y, dz = tgt.z - cur.z;
        err += dx * dx + dy * dy + dz * dz;
      }
      if (err < 0.0005) {
        this._poseActive = null;
        this._poseReturning = false;
      }
    }
  }

  _applyRestingPose() {
    if (!this.vrm?.humanoid) return;
    const h = this.vrm.humanoid;
    const setPose = (boneName, rx, ry, rz) => {
      const node = h.getNormalizedBoneNode(boneName);
      if (!node) return;
      node.rotation.x = rx;
      node.rotation.y = ry;
      node.rotation.z = rz;
    };

    setPose('leftShoulder',   0,     0,  0.1);
    setPose('rightShoulder',  0,     0, -0.1);
    setPose('leftUpperArm',   0.15,  0,  1.2);
    setPose('rightUpperArm',  0.15,  0, -1.2);
    setPose('leftLowerArm',   0,     0,  0.25);
    setPose('rightLowerArm',  0,     0, -0.25);
  }

  _fitCameraToModel() {
    if (!this.vrm || !this.camera) return;
    const { THREE } = window;

    this.vrm.update(0);

    let targetY;
    const headNode = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (headNode) {
      const headPos = new THREE.Vector3();
      headNode.getWorldPosition(headPos);
      targetY = headPos.y;
    } else {
      const box = new THREE.Box3().setFromObject(this.vrm.scene);
      targetY = box.max.y - (box.max.y - box.min.y) * 0.12;
    }

    this.camera.position.set(0, targetY - 0.05, 3.5);
    this.camera.lookAt(0, targetY, 0);
    console.log('[VRM] Camera fitted to model head at y =', targetY.toFixed(3));
  }

  // Initialise scene, load model, start render loop.
  // containerId: DOM id of the container element
  // modelUrl: URL of the VRM file to load (defaults to CONFIG.VRM_MODEL_URL)
  // onProgress(pct): optional callback called with integer 0-100
  async init(containerId, modelUrl, onProgress) {
    console.log('[VRM] Initialising local 3D avatar');
    await this._loadDependencies();
    if (onProgress) onProgress(20);

    const container = document.getElementById(containerId);
    if (!container) throw new Error(`[VRM] Container #${containerId} not found`);

    this._setupScene(container);

    const url = modelUrl || CONFIG.VRM_MODEL_URL;
    await this._loadVRM(url, onProgress ? (p) => onProgress(20 + Math.round(p * 0.8)) : null);

    this._applyRestingPose();
    this._fitCameraToModel();
    this._animate();
    console.log('[VRM] Render loop started');

    if (this._pendingAudioTrack) {
      this.connectAudioTrack(this._pendingAudioTrack);
      this._pendingAudioTrack = null;
    }
  }

  // Switch to a different VRM model at runtime.
  // Works during idle or active conversation — audio pipeline is independent of the VRM model.
  async switchModel(newUrl, onProgress) {
    if (!this.scene) {
      console.warn('[VRM] Cannot switch model — scene not initialized');
      return;
    }

    // Remove current VRM from scene
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      this.vrm = null;
    }

    // Load new model
    await this._loadVRM(newUrl, onProgress);
    this._applyRestingPose();
    this._fitCameraToModel();

    // Reapply current pose if one was active
    if (this._poseActive) {
      this.playPose(this._poseActive);
    }

    console.log('[VRM] Model switched to:', newUrl);
  }

  // Pipe an Agora remote audio track into Web Audio for lip-sync analysis.
  connectAudioTrack(agoraAudioTrack) {
    if (this.audioContext) {
      this.disconnectAudio();
    }

    if (!agoraAudioTrack) return;

    if (!this.renderer) {
      this._pendingAudioTrack = agoraAudioTrack;
      return;
    }

    try {
      const mediaStreamTrack = agoraAudioTrack.getMediaStreamTrack();
      const mediaStream = new MediaStream([mediaStreamTrack]);

      this.audioContext = new AudioContext();
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(err => {
          console.warn('[VRM] AudioContext resume failed:', err);
        });
      }

      const source = this.audioContext.createMediaStreamSource(mediaStream);
      this._audioSource = source;

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect source → analyser only (NOT to destination — Agora handles playback)
      source.connect(this.analyser);

      this._visibilityHandler = () => {
        if (document.visibilityState === 'visible' && this.audioContext?.state === 'suspended') {
          this.audioContext.resume().catch(err => {
            console.warn('[VRM] AudioContext visibility-resume failed:', err);
          });
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);

      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
      console.log('[VRM] Audio analysis pipeline connected. Sample rate:', this.audioContext.sampleRate);
    } catch (err) {
      console.warn('[VRM] Failed to connect audio track:', err);
    }
  }

  // Tear down the Web Audio pipeline.
  disconnectAudio() {
    if (this._audioSource) {
      this._audioSource.disconnect();
      this._audioSource = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    this.analyser = null;
    this.frequencyData = null;
    this._pendingAudioTrack = null;
    console.log('[VRM] Audio pipeline disconnected');
  }

  // Drive expressions and head movement based on agent state.
  setAgentState(state) {
    this.agentState = state;
    console.log('[VRM] Agent state:', state);
  }

  // Stop render loop and remove canvas.
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }
    this.vrm = null;
    this.scene = null;
    this.camera = null;
    this.clock = null;

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    // Reset animation state for clean re-init
    this._blinkTimer = 3.0;
    this._blinkPhase = 'idle';
    this._blinkProgress = 0;
    this._breathPhase = 0;
    this._headTarget = { x: 0, y: 0 };
    this._headCurrent = { x: 0, y: 0 };
    this._headSwayPhase = 0;
    this._energyEnvelope = 0;
    this._speechTime = 0;
    this._poseActive = null;
    this._poseCurrent = {};
    this._poseElapsed = 0;
    this._poseOscPhase = 0;
    this._poseReturning = false;

    // Restore placeholder
    const container = document.getElementById('avatar-container');
    if (container) {
      const placeholder = container.querySelector('.avatar-placeholder');
      if (placeholder) placeholder.style.display = '';
    }

    console.log('[VRM] Disposed');
  }
}
