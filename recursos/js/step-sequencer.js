/**
 * DrumLab VR — Secuenciador de Pasos 4/4 y Control de Transporte
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Responsabilidades:
 * - Integración física nativa sobre el modelo 3D GLTF de Native Instruments Maschine MK3 (jmccopus, CC BY 4.0).
 * - Descomposición de la malla de pads (Object_12) en 16 pulsadores interactivos (4 voces x 4 pasos) con PadMeshController.
 * - Descomposición de la botonera táctil (Object_8) en pulsadores físicos para Transporte (Play/Stop, BPM, Clear) y LEDs de compás.
 * - Pantalla LCD retroiluminada interactiva sobre Object_10 con textura dinámica en tiempo real.
 * - Doble Interfaz Física: Entrada isomórfica de teclado (1-4, Q-R, A-F, Z-V) + Espacio + Clic nativo Three.js / WebXR.
 * - Reloj métrico cuaternario (4 tiempos por compás) con tempo seleccionable (90 / 120 / 140 BPM).
 * - Cero cajas flotantes o interfaces artificiales: 100% integrado en la anatomía del hardware.
 */

AFRAME.registerComponent('step-sequencer', {
  schema: {
    bpm: { type: 'int', default: 120 }
  },

  init: function () {
    this.isSequencerRunning = false;
    this.currentStep = -1;                     // Paso activo (0, 1, 2, 3)
    this.timerId = null;
    this.bpmOptions = [90, 120, 140];
    this.currentBpmIndex = 1;                  // 120 BPM por defecto
    this.padMatrix = new Map();                // Clave: "row_col", Valor: PadMeshController
    this.padMeshes = [];                       // Array de Three.js Mesh de los pads para raycasting directo
    this.hardwareButtonMeshes = [];            // Array de Three.js Mesh de los botones físicos (Play, Clear, BPM)
    this.tempoLedMeshes = [];                  // Array con los 4 LEDs físicos sobre las columnas (0..3)
    this.btnPlayMesh = null;
    this.btnStopMesh = null;
    this.btnClearMesh = null;
    this.btnBpmMesh = null;
    this.screenMesh = null;
    this.screenCanvas = null;
    this.screenContext = null;
    this.screenTexture = null;
    this.keyMap = new Map();                   // Clave: tecla, Valor: "row_col"
    this.modelPadsInitialized = false;

    // Bindings de contexto
    this.onTick = this.onTick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.togglePlay = this.togglePlay.bind(this);
    this.startPlayback = this.startPlayback.bind(this);
    this.stopPlayback = this.stopPlayback.bind(this);
    this.clearPattern = this.clearPattern.bind(this);
    this.cycleBpm = this.cycleBpm.bind(this);
    this.initModelPads = this.initModelPads.bind(this);
    this.setupDirectRaycasting = this.setupDirectRaycasting.bind(this);
    this.updateScreenDisplay = this.updateScreenDisplay.bind(this);
    this.updatePlayButtonVisual = this.updatePlayButtonVisual.bind(this);
    this.updateTempoLeds = this.updateTempoLeds.bind(this);

    // Mapeo isomórfico del teclado físico
    this.buildKeyMapping();

    const modelEl = document.getElementById('gltf-controller');
    if (modelEl) {
      if (modelEl.getObject3D('mesh')) {
        this.initModelPads(modelEl);
      } else {
        modelEl.addEventListener('model-loaded', () => {
          this.initModelPads(modelEl);
        });
      }
    }

    // Escucha de eventos de teclado físico
    window.addEventListener('keydown', this.onKeyDown);
  },

  /**
   * Mapeo isomórfico directo del teclado QWERTY a la matriz de 4x4:
   * Fila 0 (Crash): 1 - 2 - 3 - 4
   * Fila 1 (Hi-Hat): Q - W - E - R
   * Fila 2 (Snare): A - S - D - F
   * Fila 3 (Kick): Z - X - C - V
   */
  buildKeyMapping: function () {
    // Fila 0 (Crash): 1, 2, 3, 4
    this.keyMap.set('1', '0_0');
    this.keyMap.set('2', '0_1');
    this.keyMap.set('3', '0_2');
    this.keyMap.set('4', '0_3');

    // Fila 1 (Hi-Hat): Q, W, E, R
    this.keyMap.set('q', '1_0');
    this.keyMap.set('w', '1_1');
    this.keyMap.set('e', '1_2');
    this.keyMap.set('r', '1_3');

    // Fila 2 (Snare): A, S, D, F
    this.keyMap.set('a', '2_0');
    this.keyMap.set('s', '2_1');
    this.keyMap.set('d', '2_2');
    this.keyMap.set('f', '2_3');

    // Fila 3 (Kick): Z, X, C, V
    this.keyMap.set('z', '3_0');
    this.keyMap.set('x', '3_1');
    this.keyMap.set('c', '3_2');
    this.keyMap.set('v', '3_3');
  },

  /**
   * Descompone e inicializa el modelo 3D GLTF de la Maschine MK3:
   * 1. Oculta el modelo de referencia blanco duplicado (mallas no-oficiales).
   * 2. Centra el chasis de la Maschine en el origen local (0, -3.835, 0.636).
   * 3. Descompone Object_12 en 16 pads independientes asignando PadMeshController.
   * 4. Descompone Object_8 extrayendo los botones táctiles de Play, Clear, BPM y los 4 LEDs.
   * 5. Activa la pantalla LCD interactiva en Object_10.
   */
  initModelPads: function (modelEl) {
    if (this.modelPadsInitialized) return;
    const rootMesh = modelEl.getObject3D('mesh');
    if (!rootMesh) return;

    // 1. Ocultar mallas duplicadas/blancas de referencia (mantener solo el controlador real)
    const realMeshes = new Set(['Object_6', 'Object_8', 'Object_10', 'Object_12', 'Object_14']);
    rootMesh.traverse((child) => {
      if (child.isMesh && !realMeshes.has(child.name)) {
        child.visible = false;
      }
    });

    // 2. Centrar el chasis de la Maschine MK3
    rootMesh.position.set(0, -3.835, 0.636);

    // Configuración tímbrica por fila (0..3 de atrás hacia adelante en la superficie)
    const voiceConfigs = [
      { voice: 'crash', color: '#f59e0b' },  // Fila 0: Crash (Ámbar)
      { voice: 'hihat', color: '#10b981' },  // Fila 1: Hi-Hat (Esmeralda)
      { voice: 'snare', color: '#38bdf8' },  // Fila 2: Snare (Azul Cobalto)
      { voice: 'kick',  color: '#ec4899' }   // Fila 3: Kick (Magenta/Rosa)
    ];

    // 3. Descomposición de Object_12 (Los 16 Pads Nativos)
    const padContainer = rootMesh.getObjectByName('Object_12');
    if (padContainer) {
      padContainer.visible = false; // Ocultamos la malla combinada

      const geom = padContainer.geometry;
      const posAttr = geom.attributes.position;
      const normAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      const indexAttr = geom.index;

      const numTris = indexAttr.count / 3;
      const vertToTri = new Map();
      for (let i = 0; i < numTris; i++) {
        for (let k = 0; k < 3; k++) {
          const v = indexAttr.getX(i * 3 + k);
          if (!vertToTri.has(v)) vertToTri.set(v, []);
          vertToTri.get(v).push(i);
        }
      }

      const visited = new Uint8Array(numTris);
      const components = [];
      for (let i = 0; i < numTris; i++) {
        if (visited[i]) continue;
        const comp = [];
        const queue = [i];
        visited[i] = 1;
        while (queue.length > 0) {
          const curr = queue.pop();
          comp.append ? comp.push(curr) : comp.push(curr);
          for (let k = 0; k < 3; k++) {
            const v = indexAttr.getX(curr * 3 + k);
            const nbs = vertToTri.get(v);
            for (let j = 0; j < nbs.length; j++) {
              const nb = nbs[j];
              if (!visited[nb]) {
                visited[nb] = 1;
                queue.push(nb);
              }
            }
          }
        }
        components.push(comp);
      }

      this.padMeshes = [];

      components.forEach((comp) => {
        let sx = 0, sy = 0, sz = 0, count = 0;
        comp.forEach((t) => {
          for (let k = 0; k < 3; k++) {
            const v = indexAttr.getX(t * 3 + k);
            sx += posAttr.getX(v);
            sy += posAttr.getY(v);
            sz += posAttr.getZ(v);
            count++;
          }
        });
        const lx = sx / count;
        const lz = sz / count;

        // Mapeo exacto por coordenadas locales de la matriz 4x4
        const r = lx < -6 ? 0 : (lx < 0 ? 1 : (lx < 6 ? 2 : 3));
        const c = lz < -0.6 ? 0 : (lz < 0 ? 1 : (lz < 0.6 ? 2 : 3));
        const voiceCfg = voiceConfigs[r];

        // Construcción de la submalla individual del pad
        const subGeom = new THREE.BufferGeometry();
        const oldToNew = new Map();
        const newPos = [];
        const newNorm = [];
        const newUv = [];
        const newIdx = [];

        comp.forEach((t) => {
          for (let k = 0; k < 3; k++) {
            const oldI = indexAttr.getX(t * 3 + k);
            if (!oldToNew.has(oldI)) {
              const newI = newPos.length / 3;
              oldToNew.set(oldI, newI);
              newPos.push(posAttr.getX(oldI), posAttr.getY(oldI), posAttr.getZ(oldI));
              if (normAttr) newNorm.push(normAttr.getX(oldI), normAttr.getY(oldI), normAttr.getZ(oldI));
              if (uvAttr) newUv.push(uvAttr.getX(oldI), uvAttr.getY(oldI));
            }
            newIdx.push(oldToNew.get(oldI));
          }
        });

        subGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
        if (normAttr) subGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
        if (uvAttr) subGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
        subGeom.setIndex(newIdx);
        subGeom.computeVertexNormals();
        subGeom.computeBoundingBox();
        subGeom.computeBoundingSphere();

        const mat = new THREE.MeshStandardMaterial({
          color: '#334155',
          emissive: '#000000',
          emissiveIntensity: 0,
          roughness: 0.45,
          metalness: 0.15,
          side: THREE.DoubleSide
        });

        const padMesh = new THREE.Mesh(subGeom, mat);
        padMesh.name = `real_pad_${r}_${c}`;
        padMesh.el = modelEl;
        padContainer.parent.add(padMesh);

        const padController = new window.PadMeshController({
          row: r,
          col: c,
          voice: voiceCfg.voice,
          activeColor: voiceCfg.color,
          defaultColor: '#334155',
          flashColor: '#ffffff',
          mesh: padMesh
        });

        padMesh.userData = {
          isPad: true,
          row: r,
          col: c,
          pad: padController
        };

        this.padMatrix.set(`${r}_${c}`, padController);
        this.padMeshes.push(padMesh);
      });

      // Eliminamos la malla combinada del grafo para que no interfiera ni bloquee los raycasts
      padContainer.raycast = () => {};
      if (padContainer.parent) {
        padContainer.parent.remove(padContainer);
      }
    }

    // 4. Descomposición de Object_8 (Botonera Hardware, Transporte y LEDs de Paso)
    const btnMesh = rootMesh.getObjectByName('Object_8');
    if (btnMesh) {
      btnMesh.visible = false; // Ocultamos la malla combinada para evitar solapamientos

      const geom = btnMesh.geometry;
      const posAttr = geom.attributes.position;
      const normAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      const indexAttr = geom.index;

      const numTris = indexAttr.count / 3;
      const vertToTri = new Map();
      for (let i = 0; i < numTris; i++) {
        for (let k = 0; k < 3; k++) {
          const v = indexAttr.getX(i * 3 + k);
          if (!vertToTri.has(v)) vertToTri.set(v, []);
          vertToTri.get(v).push(i);
        }
      }

      const visited = new Uint8Array(numTris);
      const btnComponents = [];
      for (let i = 0; i < numTris; i++) {
        if (visited[i]) continue;
        const comp = [];
        const queue = [i];
        visited[i] = 1;
        while (queue.length > 0) {
          const curr = queue.pop();
          comp.push(curr);
          for (let k = 0; k < 3; k++) {
            const v = indexAttr.getX(curr * 3 + k);
            const nbs = vertToTri.get(v);
            for (let j = 0; j < nbs.length; j++) {
              const nb = nbs[j];
              if (!visited[nb]) {
                visited[nb] = 1;
                queue.push(nb);
              }
            }
          }
        }
        if (comp.length >= 200) {
          btnComponents.push(comp);
        }
      }

      this.hardwareButtonMeshes = [];
      this.tempoLedMeshes = [null, null, null, null];

      btnComponents.forEach((comp, bIdx) => {
        let sx = 0, sy = 0, sz = 0, count = 0;
        comp.forEach((t) => {
          for (let k = 0; k < 3; k++) {
            const v = indexAttr.getX(t * 3 + k);
            sx += posAttr.getX(v);
            sy += posAttr.getY(v);
            sz += posAttr.getZ(v);
            count++;
          }
        });
        const lx = sx / count;
        const lz = sz / count;

        // Roles de botones por coordenadas exactas del hardware Maschine MK3
        const isPlay = (lx > 13.0 && lz < -1.4 && lz > -1.7);
        const isStop = (lx > 13.0 && lz < -0.3 && lz > -0.7);
        const isClear = (lx > 10.5 && lx < 11.5 && lz < -1.4 && lz > -1.7);
        const isBpm = (lx > 10.5 && lx < 11.5 && lz < -0.8 && lz > -1.2);
        const isLed1 = (lx < -10.5 && lz > 1.3 && lz < 1.7);
        const isLed2 = (lx < -10.5 && lz > 2.0 && lz < 2.4);
        const isLed3 = (lx < -10.5 && lz > 2.7 && lz < 3.1);
        const isLed4 = (lx < -10.5 && lz > 3.3 && lz < 3.8);

        const subGeom = new THREE.BufferGeometry();
        const oldToNew = new Map();
        const newPos = [];
        const newNorm = [];
        const newUv = [];
        const newIdx = [];
        comp.forEach((t) => {
          for (let k = 0; k < 3; k++) {
            const oldI = indexAttr.getX(t * 3 + k);
            if (!oldToNew.has(oldI)) {
              const newI = newPos.length / 3;
              oldToNew.set(oldI, newI);
              newPos.push(posAttr.getX(oldI), posAttr.getY(oldI), posAttr.getZ(oldI));
              if (normAttr) newNorm.push(normAttr.getX(oldI), normAttr.getY(oldI), normAttr.getZ(oldI));
              if (uvAttr) newUv.push(uvAttr.getX(oldI), uvAttr.getY(oldI));
            }
            newIdx.push(oldToNew.get(oldI));
          }
        });
        subGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
        if (normAttr) subGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
        if (uvAttr) subGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
        subGeom.setIndex(newIdx);
        subGeom.computeVertexNormals();
        subGeom.computeBoundingBox();
        subGeom.computeBoundingSphere();

        let color = '#2c333f';
        let emissive = '#000000';
        let emissiveIntensity = 0;
        let role = 'generic';

        if (isPlay) {
          role = 'play';
          color = '#059669';
          emissive = '#10b981';
          emissiveIntensity = 0.4;
        } else if (isStop) {
          role = 'stop';
          color = '#334155';
        } else if (isClear) {
          role = 'clear';
          color = '#b91c1c';
          emissive = '#ef4444';
          emissiveIntensity = 0.4;
        } else if (isBpm) {
          role = 'bpm';
          color = '#0284c7';
          emissive = '#38bdf8';
          emissiveIntensity = 0.4;
        } else if (isLed1) {
          role = 'led_0';
          color = '#334155';
        } else if (isLed2) {
          role = 'led_1';
          color = '#334155';
        } else if (isLed3) {
          role = 'led_2';
          color = '#334155';
        } else if (isLed4) {
          role = 'led_3';
          color = '#334155';
        }

        const mat = new THREE.MeshStandardMaterial({
          color: color,
          emissive: emissive,
          emissiveIntensity: emissiveIntensity,
          roughness: 0.4,
          metalness: 0.15,
          side: THREE.DoubleSide
        });

        const capMesh = new THREE.Mesh(subGeom, mat);
        capMesh.name = `btn_cap_${role}_${bIdx}`;
        capMesh.el = modelEl;
        btnMesh.parent.add(capMesh);

        if (isPlay) {
          this.btnPlayMesh = capMesh;
          capMesh.userData = { isButton: true, action: 'togglePlay' };
          this.hardwareButtonMeshes.push(capMesh);
        } else if (isStop) {
          this.btnStopMesh = capMesh;
          capMesh.userData = { isButton: true, action: 'stop' };
          this.hardwareButtonMeshes.push(capMesh);
        } else if (isClear) {
          this.btnClearMesh = capMesh;
          capMesh.userData = { isButton: true, action: 'clear' };
          this.hardwareButtonMeshes.push(capMesh);
        } else if (isBpm) {
          this.btnBpmMesh = capMesh;
          capMesh.userData = { isButton: true, action: 'bpm' };
          this.hardwareButtonMeshes.push(capMesh);
        } else if (isLed1) {
          this.tempoLedMeshes[0] = capMesh;
        } else if (isLed2) {
          this.tempoLedMeshes[1] = capMesh;
        } else if (isLed3) {
          this.tempoLedMeshes[2] = capMesh;
        } else if (isLed4) {
          this.tempoLedMeshes[3] = capMesh;
        }
      });

      // Eliminamos la malla combinada de botones para que no interfiera en la interacción
      btnMesh.raycast = () => {};
      if (btnMesh.parent) {
        btnMesh.parent.remove(btnMesh);
      }
    }

    // 5. Pantalla LCD dinámica en Object_10
    const screenMesh = rootMesh.getObjectByName('Object_10');
    if (screenMesh) {
      screenMesh.visible = true;
      this.screenMesh = screenMesh;
      this.screenCanvas = document.createElement('canvas');
      this.screenCanvas.width = 512;
      this.screenCanvas.height = 128;
      this.screenContext = this.screenCanvas.getContext('2d');
      this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);

      screenMesh.material = new THREE.MeshBasicMaterial({
        map: this.screenTexture,
        side: THREE.DoubleSide
      });

      this.updateScreenDisplay();
    }

    // 6. Configuración de Raycasting Directo Three.js (Ratón, Pantalla Táctil y Láser VR)
    this.setupDirectRaycasting(modelEl);

    this.modelPadsInitialized = true;
    console.log('[DrumLab] Controlador Maschine MK3 100% integrado y operativo.');
  },

  /**
   * Actualiza la pantalla digital LCD del controlador con estilo retro-futurista
   */
  updateScreenDisplay: function () {
    if (!this.screenContext || !this.screenTexture) return;
    const ctx = this.screenContext;

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 128);

    // Líneas de trama LCD sutiles
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let y = 0; y < 128; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Cabecera institucional
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('DRUMLAB VR // MASCHINE MK3', 20, 36);

    // Estado de Reproducción
    ctx.font = 'bold 42px monospace';
    if (this.isSequencerRunning) {
      ctx.fillStyle = '#10b981';
      ctx.fillText('PLAY', 20, 96);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillText('STOP', 20, 96);
    }

    // Tempo BPM
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${this.data.bpm} BPM`, 175, 96);

    // Paso activo del compás
    ctx.fillStyle = this.isSequencerRunning ? '#f59e0b' : '#475569';
    ctx.font = 'bold 28px monospace';
    const stepText = (this.currentStep >= 0) ? `STEP ${this.currentStep + 1}/4` : 'STEP --/4';
    ctx.fillText(stepText, 365, 96);

    this.screenTexture.needsUpdate = true;
  },

  /**
   * Sistema de Raycasting directo de Three.js:
   * Interactúa con los 16 pads nativos y los botones de hardware físico
   */
  setupDirectRaycasting: function (modelEl) {
    const sceneEl = this.el.sceneEl;
    const raycaster = new THREE.Raycaster();

    const getHitTarget = (clientX, clientY) => {
      const canvas = sceneEl.canvas || document.querySelector('canvas');
      const camera = sceneEl.camera;
      if (!canvas || !camera) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(mouse, camera);

      // 1. Probar primero con los 16 pads
      const padHits = raycaster.intersectObjects(this.padMeshes, false);
      if (padHits.length > 0) {
        return { type: 'pad', target: padHits[0].object.userData?.pad || null };
      }

      // 2. Probar con los botones de hardware de transporte
      const btnHits = raycaster.intersectObjects(this.hardwareButtonMeshes, false);
      if (btnHits.length > 0) {
        return { type: 'button', target: btnHits[0].object.userData?.action || null };
      }

      // 3. Probar con el botón 3D de retorno al estudio
      const backBtnEl = document.getElementById('btn-back-studio');
      if (backBtnEl && backBtnEl.object3D) {
        const backHits = raycaster.intersectObject(backBtnEl.object3D, true);
        if (backHits.length > 0) {
          return { type: 'backToStudio' };
        }
      }

      return null;
    };

    this.lastBtnTime = 0;
    this.lastNavTime = 0;
    let lastPointerHandledTime = 0;

    const handleAction = (hit) => {
      if (!hit) return;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      if (hit.type === 'pad' && hit.target) {
        hit.target.onClick();
      } else if (hit.type === 'button') {
        if (now - this.lastBtnTime < 140) return;
        this.lastBtnTime = now;
        if (hit.target === 'togglePlay') this.togglePlay();
        else if (hit.target === 'stop') this.stopPlayback();
        else if (hit.target === 'clear') this.clearPattern();
        else if (hit.target === 'bpm') this.cycleBpm();
      } else if (hit.type === 'backToStudio') {
        if (now - this.lastNavTime < 350) return;
        this.lastNavTime = now;
        this.navigateBackToStudio();
      }
    };

    // Manejador unificado de puntero para ratón y pantallas táctiles
    const onPointerDown = (evt) => {
      if (evt.target && evt.target.tagName !== 'CANVAS' && evt.target !== document.body && evt.target !== document.documentElement) {
        return;
      }
      const hit = getHitTarget(evt.clientX, evt.clientY);
      if (hit) {
        if (evt.stopPropagation) evt.stopPropagation();
        lastPointerHandledTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        handleAction(hit);
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: false });

    // Manejador de puntero para cursor interactivo
    const onPointerMove = (evt) => {
      if (evt.target && evt.target.tagName !== 'CANVAS' && evt.target !== document.body && evt.target !== document.documentElement) {
        return;
      }
      const hit = getHitTarget(evt.clientX, evt.clientY);
      if (hit) {
        document.body.style.cursor = 'pointer';
      } else {
        document.body.style.cursor = 'default';
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // Delegación para láseres WebXR de VR y compatibilidad de eventos A-Frame
    modelEl.classList.add('interactable');
    const onAFrameClick = (evt) => {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      // Si el evento proviene de una interacción de ratón o táctil ya procesada de inmediato en pointerdown, descartar duplicado
      if (now - lastPointerHandledTime < 450) {
        return;
      }

      const hitMesh = evt.detail?.intersection?.object;
      if (!hitMesh) return;

      if (hitMesh.userData?.pad) {
        hitMesh.userData.pad.onClick(evt);
      } else if (hitMesh.userData?.action) {
        if (now - this.lastBtnTime < 140) return;
        this.lastBtnTime = now;
        const action = hitMesh.userData.action;
        if (action === 'togglePlay') this.togglePlay();
        else if (action === 'stop') this.stopPlayback();
        else if (action === 'clear') this.clearPattern();
        else if (action === 'bpm') this.cycleBpm();
      }
    };

    modelEl.addEventListener('click', onAFrameClick);
    modelEl.addEventListener('touchend', onAFrameClick);
  },

  /**
   * Manejador de eventos de teclado físico (doble interfaz)
   */
  onKeyDown: function (evt) {
    if (evt.target && (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA')) {
      return;
    }

    const key = evt.key.toLowerCase();

    // 0. Ayuda y Leyenda modal: Tecla 'h' o '?' para alternar, 'escape' para cerrar
    if (key === 'h' || key === '?') {
      evt.preventDefault();
      if (typeof window.toggleHelpModal === 'function') {
        window.toggleHelpModal();
      }
      return;
    }

    if (key === 'escape') {
      if (typeof window.closeHelpModal === 'function') {
        window.closeHelpModal();
      }
      return;
    }

    // Si el modal de ayuda está abierto, pausamos la captura de notas del secuenciador
    if (typeof window.isHelpModalOpen === 'function' && window.isHelpModalOpen()) {
      return;
    }

    // 1. Barra espaciadora: Play / Stop
    if (evt.code === 'Space' || key === ' ') {
      evt.preventDefault();
      this.togglePlay();
      return;
    }

    // 2. Tecla 'b': Conmutar BPM cíclico (90 -> 120 -> 140)
    if (key === 'b') {
      evt.preventDefault();
      this.cycleBpm();
      return;
    }

    // 3. Limpiar patrón (Clear): Delete, Backspace o Shift + C
    // Resuelve el conflicto: 'c' sola ahora activa el Bombo (Kick paso 3)
    if (key === 'delete' || key === 'backspace' || (key === 'c' && evt.shiftKey)) {
      evt.preventDefault();
      this.clearPattern();
      return;
    }

    // 4. Teclas isomórficas de la matriz 4x4 (1-4, Q-R, A-F, Z-V)
    // Fila 0 Crash (1-4) | Fila 1 Hi-Hat (Q-R) | Fila 2 Snare (A-F) | Fila 3 Kick (Z, X, C, V)
    if (this.keyMap.has(key)) {
      const coords = this.keyMap.get(key);
      const pad = this.padMatrix.get(coords);
      if (!pad) return;
      pad.onClick();
    }
  },

  /**
   * Conmuta la reproducción
   */
  togglePlay: function () {
    if (this.isSequencerRunning) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  },

  startPlayback: function () {
    if (this.isSequencerRunning) return;

    if (window.DrumLabAudio) {
      window.DrumLabAudio.unlock();
    }

    this.isSequencerRunning = true;
    this.currentStep = -1;
    this.updatePlayButtonVisual(true);
    this.updateScreenDisplay();

    const stepIntervalMs = (60 / this.data.bpm) * 1000;
    this.onTick();
    this.timerId = setInterval(this.onTick, stepIntervalMs);
  },

  stopPlayback: function () {
    if (!this.isSequencerRunning) return;

    this.isSequencerRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.currentStep = -1;
    this.updateTempoLeds(-1);
    this.updatePlayButtonVisual(false);
    this.updateScreenDisplay();
  },

  /**
   * Pulso del reloj secuenciador: avanza la columna activa y dispara los pads activos
   */
  onTick: function () {
    // Avanza cíclicamente a través de los 4 tiempos (0, 1, 2, 3)
    this.currentStep = (this.currentStep + 1) % 4;

    // Actualiza los LEDs de paso y la pantalla LCD
    this.updateTempoLeds(this.currentStep);
    this.updateScreenDisplay();

    // Dispara todos los pads programados en esta columna (0 a 3)
    for (let row = 0; row < 4; row++) {
      const key = `${row}_${this.currentStep}`;
      const pad = this.padMatrix.get(key);
      if (!pad) continue;

      if (pad.isStepActive()) {
        pad.triggerDisparo('ACTIVO_ESPERA');
      }
    }
  },

  /**
   * Actualiza el estado visual de los 4 LEDs físicos sobre las columnas (0 a 3)
   */
  updateTempoLeds: function (activeCol) {
    for (let i = 0; i < 4; i++) {
      const ledMesh = this.tempoLedMeshes[i];
      if (!ledMesh || !ledMesh.material) continue;

      if (i === activeCol) {
        ledMesh.material.color.set('#ffffff');
        ledMesh.material.emissive.set('#38bdf8');
        ledMesh.material.emissiveIntensity = 2.0;
      } else {
        ledMesh.material.color.set('#2c333f');
        ledMesh.material.emissive.set('#000000');
        ledMesh.material.emissiveIntensity = 0;
      }
    }
  },

  /**
   * Alterna entre los valores de tempo: 90 -> 120 -> 140 -> 90 BPM
   */
  cycleBpm: function () {
    this.currentBpmIndex = (this.currentBpmIndex + 1) % this.bpmOptions.length;
    this.data.bpm = this.bpmOptions[this.currentBpmIndex];

    // Destello de feedback táctil en el botón BPM
    if (this.btnBpmMesh && this.btnBpmMesh.material) {
      this.btnBpmMesh.material.emissiveIntensity = 1.8;
      setTimeout(() => {
        if (this.btnBpmMesh && this.btnBpmMesh.material) {
          this.btnBpmMesh.material.emissiveIntensity = 0.4;
        }
      }, 120);
    }

    this.updateScreenDisplay();

    if (this.isSequencerRunning) {
      clearInterval(this.timerId);
      const stepIntervalMs = (60 / this.data.bpm) * 1000;
      this.timerId = setInterval(this.onTick, stepIntervalMs);
    }
  },

  /**
   * Borra la programación de todos los pads (reseteo a INACTIVO)
   */
  clearPattern: function () {
    this.padMatrix.forEach((pad) => {
      pad.setState('INACTIVO');
    });

    // Destello de feedback táctil en el botón Clear
    if (this.btnClearMesh && this.btnClearMesh.material) {
      this.btnClearMesh.material.emissiveIntensity = 1.8;
      setTimeout(() => {
        if (this.btnClearMesh && this.btnClearMesh.material) {
          this.btnClearMesh.material.emissiveIntensity = 0.4;
        }
      }, 120);
    }

    this.updateScreenDisplay();

    try {
      if (window.DrumLabAudio) {
        const ctx = window.DrumLabAudio.getContext();
        if (ctx) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.setValueAtTime(320, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.08);
          g.gain.setValueAtTime(0.15, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.09);
        }
      }
    } catch (e) {}
  },

  /**
   * Actualiza el botón de hardware Play entre verde activo e inactivo
   */
  updatePlayButtonVisual: function (isPlaying) {
    if (!this.btnPlayMesh || !this.btnPlayMesh.material) return;

    if (isPlaying) {
      this.btnPlayMesh.material.color.set('#10b981');
      this.btnPlayMesh.material.emissive.set('#10b981');
      this.btnPlayMesh.material.emissiveIntensity = 1.6;
    } else {
      this.btnPlayMesh.material.color.set('#059669');
      this.btnPlayMesh.material.emissive.set('#10b981');
      this.btnPlayMesh.material.emissiveIntensity = 0.4;
    }
  },

  /**
   * Navegación espacial 3D de regreso al Estudio de Producción (Escena 1)
   */
  navigateBackToStudio: function () {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        const ctx = new AudioCtxClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) {}

    // Notificación al marco padre si está embebido en index.html
    if (window.parent && window.parent !== window) {
      try {
        if (typeof window.parent.cambiarEscena === 'function') {
          window.parent.cambiarEscena(1);
          return;
        }
      } catch (e) {}
      window.parent.postMessage({ action: 'cambiarEscena', escena: 1 }, '*');
    }
    window.location.href = 'escena-estudio.html';
  },

  remove: function () {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    window.removeEventListener('keydown', this.onKeyDown);
  }
});
