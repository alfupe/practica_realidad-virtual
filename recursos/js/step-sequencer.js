/**
 * DrumLab VR — Secuenciador de Pasos 4/4 y Control de Transporte
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Responsabilidades:
 * - Integración física nativa sobre el modelo 3D GLTF de Native Instruments Maschine MK3 (jmccopus, CC BY 4.0).
 * - Descomposición de la malla de pads (Object_12) en 16 pulsadores interactivos (4 voces x 4 pasos) con PadMeshController.
 * - Descomposición de la botonera táctil (Object_8) en Transporte (Play/Stop, BPM, Clear), LEDs de compás y 8 botones de gestión multi-compás (4 Loop ON/OFF + 4 Edit Bar 1-4).
 * - Pantalla LCD central retroiluminada encajada en el bisel del chasis con BPM, estado, compás y pasos en tiempo real.
 * - Doble Interfaz Física: Entrada isomórfica de teclado (1-4, Q-R, A-F, Z-V) + Espacio + Clic nativo Three.js / WebXR.
 * - Reloj métrico cuaternario de hasta 4 compases con loop dinámico y tempo seleccionable (90 / 120 / 140 BPM).
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

    // Secuenciador multi-compás (4 compases x 4 voces x 4 pasos)
    this.patterns = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => [false, false, false, false])
    );
    this.enabledBars = [true, false, false, false]; // Por defecto, Compás 1 activo en loop
    this.editBar = 0;                               // Compás visible/editable en los 16 pads (0..3)
    this.playBar = 0;                               // Compás en reproducción actual (0..3)

    this.padMatrix = new Map();                // Clave: "row_col", Valor: PadMeshController
    this.padMeshes = [];                       // Array de Three.js Mesh de los pads para raycasting directo
    this.hardwareButtonMeshes = [];            // Array de Three.js Mesh de los botones físicos
    this.tempoLedMeshes = [];                  // Array con los 4 LEDs físicos sobre las columnas (0..3)
    this.loopBarButtonMeshes = [null, null, null, null]; // Fila superior LCD: activar/desactivar compás en loop
    this.editBarButtonMeshes = [null, null, null, null]; // Fila inferior LCD: seleccionar compás a editar
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
    this.onPadToggled = this.onPadToggled.bind(this);
    this.selectEditBar = this.selectEditBar.bind(this);
    this.toggleLoopBar = this.toggleLoopBar.bind(this);
    this.togglePlay = this.togglePlay.bind(this);
    this.startPlayback = this.startPlayback.bind(this);
    this.stopPlayback = this.stopPlayback.bind(this);
    this.clearPattern = this.clearPattern.bind(this);
    this.cycleBpm = this.cycleBpm.bind(this);
    this.initModelPads = this.initModelPads.bind(this);
    this.setupDirectRaycasting = this.setupDirectRaycasting.bind(this);
    this.updateScreenDisplay = this.updateScreenDisplay.bind(this);
    this.updatePlayButtonVisual = this.updatePlayButtonVisual.bind(this);
    this.updateBarButtonsVisual = this.updateBarButtonsVisual.bind(this);
    this.updateTempoLeds = this.updateTempoLeds.bind(this);
    this.updateHudTelemetry = this.updateHudTelemetry.bind(this);

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
      { voice: 'hihat', color: '#22c55e' },  // Fila 1: Hi-Hat (Verde brillante)
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
          mesh: padMesh,
          onToggle: this.onPadToggled
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
      this.loopBarButtonMeshes = [null, null, null, null];
      this.editBarButtonMeshes = [null, null, null, null];

      const mapButtonCol = (lzVal) => {
        if (lzVal < -1.25) return 0;
        if (lzVal < -0.75) return 1;
        if (lzVal < -0.20) return 2;
        return 3;
      };

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

        // Botones sobre la pantalla LCD: Activar/Desactivar Compás 1..4 en el Loop
        const isLoopBar = (lx > -1.8 && lx < -0.5 && lz < 0.3);
        const loopBarIdx = isLoopBar ? mapButtonCol(lz) : -1;

        // Botones bajo la pantalla LCD: Seleccionar Compás 1..4 a editar en los 16 pads
        const isEditBar = (lx > 6.0 && lx < 7.4 && lz < 0.3);
        const editBarIdx = isEditBar ? mapButtonCol(lz) : -1;

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
        } else if (isLoopBar) {
          role = `loop_bar_${loopBarIdx}`;
        } else if (isEditBar) {
          role = `edit_bar_${editBarIdx}`;
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
        } else if (isLoopBar && loopBarIdx >= 0) {
          this.loopBarButtonMeshes[loopBarIdx] = capMesh;
          capMesh.userData = { isButton: true, action: 'toggleLoopBar', barIndex: loopBarIdx };
          this.hardwareButtonMeshes.push(capMesh);
        } else if (isEditBar && editBarIdx >= 0) {
          this.editBarButtonMeshes[editBarIdx] = capMesh;
          capMesh.userData = { isButton: true, action: 'selectEditBar', barIndex: editBarIdx };
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

      this.updateBarButtonsVisual();

      // Eliminamos la malla combinada de botones para que no interfiera en la interacción
      btnMesh.raycast = () => {};
      if (btnMesh.parent) {
        btnMesh.parent.remove(btnMesh);
      }
    }

    // 5. Pantalla LCD central de alta resolución encajada en el bisel de Object_6
    // Nota: Object_10 en el GLB es el indicador superior izquierdo; la pantalla dual central está en [-2.718..-0.752, 3.378..4.012]
    const miniStripMesh = rootMesh.getObjectByName('Object_10');
    if (miniStripMesh) {
      miniStripMesh.visible = true;
      miniStripMesh.material = new THREE.MeshStandardMaterial({
        color: '#0ea5e9',
        emissive: '#0284c7',
        emissiveIntensity: 0.65,
        roughness: 0.25,
        side: THREE.DoubleSide
      });
    }

    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 680;
    this.screenCanvas.height = 204;
    this.screenContext = this.screenCanvas.getContext('2d');
    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.anisotropy = 4;

    const lcdGeom = new THREE.PlaneGeometry(1.88, 0.50);
    const lcdMat = new THREE.MeshBasicMaterial({
      map: this.screenTexture,
      side: THREE.DoubleSide
    });
    this.screenMesh = new THREE.Mesh(lcdGeom, lcdMat);
    this.screenMesh.name = 'maschine_central_lcd';
    // Posicionada a ras sobre el rebaje del chasis (+2.3 deg sigue la inclinación real del panel frontal hacia arriba)
    this.screenMesh.position.set(-1.735, 3.69, -0.540);
    this.screenMesh.rotation.x = THREE.MathUtils.degToRad(2.3);
    rootMesh.add(this.screenMesh);

    this.updateScreenDisplay();
    this.updateHudTelemetry();

    // 6. Configuración de Raycasting Directo Three.js (Ratón, Pantalla Táctil y Láser VR)
    this.setupDirectRaycasting(modelEl);

    this.modelPadsInitialized = true;
    console.log('[DrumLab] Controlador Maschine MK3 100% integrado y operativo.');
  },

  /**
   * Sincroniza cualquier cambio manual en un pad hacia el compás en edición actual
   */
  onPadToggled: function (row, col, isProgrammed) {
    if (row >= 0 && row < 4 && col >= 0 && col < 4) {
      this.patterns[this.editBar][row][col] = !!isProgrammed;
    }
  },

  /**
   * Retorna el índice del primer compás habilitado en el loop (0..3)
   */
  getFirstEnabledBar: function () {
    const idx = this.enabledBars.findIndex(Boolean);
    return idx >= 0 ? idx : 0;
  },

  /**
   * Retorna el siguiente compás habilitado en el loop circular
   */
  getNextEnabledBar: function (currentBar) {
    for (let offset = 1; offset <= 4; offset++) {
      const candidate = (currentBar + offset) % 4;
      if (this.enabledBars[candidate]) {
        return candidate;
      }
    }
    return currentBar;
  },

  /**
   * Activa o desactiva un compás (0..3) dentro del bucle de reproducción
   */
  toggleLoopBar: function (barIndex) {
    if (barIndex < 0 || barIndex > 3) return;
    const activeCount = this.enabledBars.filter(Boolean).length;
    // Garantizar que siempre quede al menos 1 compás activo para el bucle
    if (this.enabledBars[barIndex] && activeCount <= 1) {
      return;
    }
    this.enabledBars[barIndex] = !this.enabledBars[barIndex];

    // Si se desactivó el compás que estaba sonando, saltar limpiamente al primero activo
    if (this.isSequencerRunning && !this.enabledBars[this.playBar]) {
      this.playBar = this.getFirstEnabledBar();
    }

    this.updateBarButtonsVisual();
    this.updateScreenDisplay();
    this.updateHudTelemetry();
  },

  /**
   * Cambia el compás visible y editable en los 16 pads físicos de la Maschine
   */
  selectEditBar: function (barIndex) {
    if (barIndex < 0 || barIndex > 3) return;
    this.editBar = barIndex;

    // Reflejar inmediatamente el patrón guardado de ese compás en la matriz 4x4 sin disparar audio
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const pad = this.padMatrix.get(`${r}_${c}`);
        if (pad) {
          pad.setState(this.patterns[this.editBar][r][c] ? 'ACTIVO_ESPERA' : 'INACTIVO');
        }
      }
    }

    this.updateBarButtonsVisual();
    this.updateScreenDisplay();
    this.updateHudTelemetry();
  },

  /**
   * Actualiza los colores emisivos de las dos filas de botones multi-compás
   */
  updateBarButtonsVisual: function () {
    for (let i = 0; i < 4; i++) {
      // Fila superior LCD: Estado ON/OFF de cada compás en el Loop
      const loopMesh = this.loopBarButtonMeshes[i];
      if (loopMesh && loopMesh.material) {
        const isPlayingThis = this.isSequencerRunning && (this.playBar === i);
        if (this.enabledBars[i]) {
          loopMesh.material.color.set(isPlayingThis ? '#4ade80' : '#16a34a');
          loopMesh.material.emissive.set('#22c55e');
          loopMesh.material.emissiveIntensity = isPlayingThis ? 1.5 : 0.75;
        } else {
          loopMesh.material.color.set('#2c333f');
          loopMesh.material.emissive.set('#000000');
          loopMesh.material.emissiveIntensity = 0;
        }
      }

      // Fila inferior LCD (círculo verde): Compás actualmente seleccionado para editar
      const editMesh = this.editBarButtonMeshes[i];
      if (editMesh && editMesh.material) {
        if (this.editBar === i) {
          editMesh.material.color.set('#38bdf8');
          editMesh.material.emissive.set('#38bdf8');
          editMesh.material.emissiveIntensity = 1.25;
        } else if (this.enabledBars[i]) {
          editMesh.material.color.set('#334155');
          editMesh.material.emissive.set('#0284c7');
          editMesh.material.emissiveIntensity = 0.22;
        } else {
          editMesh.material.color.set('#2c333f');
          editMesh.material.emissive.set('#000000');
          editMesh.material.emissiveIntensity = 0;
        }
      }
    }
  },

  /**
   * Actualiza la pantalla digital LCD central del controlador (BPM, Loop, Compás y Step)
   */
  updateScreenDisplay: function () {
    if (!this.screenContext || !this.screenTexture) return;
    const ctx = this.screenContext;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;

    // Fondo OLED profundo
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, W, H);

    // Marco interior sutil
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    const colW = (W - 24) / 4;

    // 1. Tira superior: Estado LOOP 1..4 (alineada bajo los 4 botones superiores)
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * colW + 4;
      const w = colW - 8;
      const isEnabled = this.enabledBars[i];
      const isPlayingBar = this.isSequencerRunning && (this.playBar === i);

      ctx.fillStyle = isEnabled ? (isPlayingBar ? '#22c55e' : '#14532d') : '#0f172a';
      ctx.fillRect(x, 8, w, 34);
      ctx.strokeStyle = isPlayingBar ? '#ffffff' : (isEnabled ? '#22c55e' : '#334155');
      ctx.lineWidth = isPlayingBar ? 2.5 : 1.5;
      ctx.strokeRect(x, 8, w, 34);

      ctx.fillStyle = isEnabled ? '#ffffff' : '#64748b';
      ctx.font = 'bold 17px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`LOOP ${i + 1}`, x + w / 2, 25);
    }

    // 2. Franja central: PLAY/STOP + STEP + BPM GRANDE
    ctx.textAlign = 'left';
    ctx.font = 'bold 40px monospace';
    if (this.isSequencerRunning) {
      ctx.fillStyle = '#22c55e';
      ctx.fillText('PLAY', 18, 102);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillText('STOP', 18, 102);
    }

    // Compás en reproducción y paso
    ctx.fillStyle = this.isSequencerRunning ? '#f59e0b' : '#475569';
    ctx.font = 'bold 26px monospace';
    const barStepText = this.isSequencerRunning && this.currentStep >= 0
      ? `B${this.playBar + 1}:S${this.currentStep + 1}`
      : `BAR ${this.editBar + 1}`;
    ctx.fillText(barStepText, 160, 102);

    // BPM grande de altísimo contraste a la derecha
    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(`${this.data.bpm} BPM`, W - 18, 102);

    // 3. Tira inferior: Selector EDIT 1..4 (alineada sobre los 4 botones del círculo verde)
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * colW + 4;
      const w = colW - 8;
      const isEditing = (this.editBar === i);

      ctx.fillStyle = isEditing ? '#0284c7' : '#0f172a';
      ctx.fillRect(x, H - 42, w, 34);
      ctx.strokeStyle = isEditing ? '#7dd3fc' : '#334155';
      ctx.lineWidth = isEditing ? 2.5 : 1.5;
      ctx.strokeRect(x, H - 42, w, 34);

      ctx.fillStyle = isEditing ? '#ffffff' : '#94a3b8';
      ctx.font = 'bold 17px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`EDIT ${i + 1}`, x + w / 2, H - 25);
    }

    this.screenTexture.needsUpdate = true;
  },

  /**
   * Sincroniza la lectura de BPM y compás en la barra HUD HTML superior
   */
  updateHudTelemetry: function () {
    const hudBpmEl = document.getElementById('hudBpmBadge');
    if (hudBpmEl) {
      const activeBars = this.enabledBars
        .map((on, idx) => (on ? idx + 1 : null))
        .filter(Boolean)
        .join(',');
      hudBpmEl.textContent = `${this.data.bpm} BPM · Edit B${this.editBar + 1} · Loop [${activeBars}]`;
    }
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

      // 2. Probar con los botones de hardware (Transporte y Compases)
      const btnHits = raycaster.intersectObjects(this.hardwareButtonMeshes, false);
      if (btnHits.length > 0) {
        const ud = btnHits[0].object.userData || {};
        return { type: 'button', target: ud.action || null, barIndex: ud.barIndex };
      }

      // 3. Probar con el botón 3D de retorno al estudio (solo para estado hover de cursor; el clic se procesa en pointerup)
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
    let lastPointerHandledTime = 0;

    const dispatchHardwareAction = (action, barIndex) => {
      if (action === 'togglePlay') this.togglePlay();
      else if (action === 'stop') this.stopPlayback();
      else if (action === 'clear') this.clearPattern();
      else if (action === 'bpm') this.cycleBpm();
      else if (action === 'toggleLoopBar') this.toggleLoopBar(barIndex);
      else if (action === 'selectEditBar') this.selectEditBar(barIndex);
    };

    const handleAction = (hit) => {
      if (!hit) return;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      if (hit.type === 'pad' && hit.target) {
        hit.target.onClick();
      } else if (hit.type === 'button') {
        if (now - this.lastBtnTime < 140) return;
        this.lastBtnTime = now;
        dispatchHardwareAction(hit.target, hit.barIndex);
      }
    };

    // Manejador unificado de puntero para ratón y pantallas táctiles
    const onPointerDown = (evt) => {
      if (evt.target && evt.target.tagName !== 'CANVAS' && evt.target !== document.body && evt.target !== document.documentElement) {
        return;
      }
      const hit = getHitTarget(evt.clientX, evt.clientY);
      if (hit && hit.type !== 'backToStudio') {
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
        dispatchHardwareAction(hitMesh.userData.action, hitMesh.userData.barIndex);
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
    this.playBar = this.getFirstEnabledBar();
    this.currentStep = -1;
    this.updatePlayButtonVisual(true);
    this.updateBarButtonsVisual();
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
    this.updateBarButtonsVisual();
    this.updateScreenDisplay();
  },

  /**
   * Pulso del reloj secuenciador: avanza por los pasos 1-4 y salta entre compases habilitados en loop
   */
  onTick: function () {
    const prevStep = this.currentStep;
    this.currentStep = (this.currentStep + 1) % 4;

    // Al completar el paso 4 del compás actual, avanzar al siguiente compás activo en el bucle
    if (prevStep === 3 && this.currentStep === 0) {
      this.playBar = this.getNextEnabledBar(this.playBar);
    }

    // Actualiza LEDs de paso, iluminación de compases y pantalla LCD
    this.updateTempoLeds(this.currentStep);
    this.updateBarButtonsVisual();
    this.updateScreenDisplay();

    // Dispara todas las voces programadas en la columna actual del compás en reproducción
    const barPattern = this.patterns[this.playBar];
    if (!barPattern) return;

    for (let row = 0; row < 4; row++) {
      if (!barPattern[row][this.currentStep]) continue;

      const key = `${row}_${this.currentStep}`;
      const pad = this.padMatrix.get(key);
      if (!pad) continue;

      if (this.playBar === this.editBar) {
        // El compás en reproducción coincide con el visible en los pads: destello físico + audio
        pad.triggerDisparo('ACTIVO_ESPERA');
      } else if (window.DrumLabAudio) {
        // El usuario está editando otro compás distinto: reproducir audio sin destellar pads ajenos
        window.DrumLabAudio.play(pad.voice);
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
    this.updateHudTelemetry();

    if (this.isSequencerRunning) {
      clearInterval(this.timerId);
      const stepIntervalMs = (60 / this.data.bpm) * 1000;
      this.timerId = setInterval(this.onTick, stepIntervalMs);
    }
  },

  /**
   * Borra la programación del compás en edición actual (reseteo a INACTIVO)
   */
  clearPattern: function () {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        this.patterns[this.editBar][r][c] = false;
      }
    }

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
    this.updateHudTelemetry();

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
