/**
 * DrumLab VR — Secuenciador de Pasos 4/4 y Control de Transporte
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Responsabilidades:
 * - Integración directa con el modelo 3D GLTF real (oversized_drum_pad.glb).
 * - Descomposición de la geometría de pads del modelo en 16 pulsadores interactivos (4 voces x 4 pasos).
 * - Reloj métrico cuaternario (4 tiempos por compás) con tempo seleccionable (90 / 120 / 140 BPM).
 * - Doble Interfaz Física: Entrada isomórfica de teclado (1-4, Q-R, A-F, Z-V) + Espacio + Clic/Raycast en el modelo 3D.
 * - Coordinación de los LEDs de compás y activación de pads en estado ACTIVO_ESPERA.
 */

AFRAME.registerComponent('step-sequencer', {
  schema: {
    bpm: { type: 'int', default: 120 },
    tempoLedsSelector: { type: 'string', default: '.tempo-led' }
  },

  init: function () {
    this.isPlaying = false;
    this.currentStep = -1;                     // Paso activo (0, 1, 2, 3)
    this.timerId = null;
    this.bpmOptions = [90, 120, 140];
    this.currentBpmIndex = 1;                  // 120 BPM por defecto
    this.padMatrix = new Map();                // Clave: "row_col", Valor: PadMeshController
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
    this.bindTransportButtons = this.bindTransportButtons.bind(this);
    this.initModelPads = this.initModelPads.bind(this);

    // Mapeo isomórfico del teclado físico
    this.buildKeyMapping();

    // Inicialización de botones de transporte y pads del modelo GLTF
    this.bindTransportButtons();

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
   * Descompone los 4 objetos de malla del modelo 3D GLTF en 16 pads interactivos.
   * Utiliza la geometría nativa del modelo lukus1 (CC BY 4.0), asociando a cada pad
   * un controlador PadMeshController con feedback visual y háptico-visual en tiempo real.
   */
  initModelPads: function (modelEl) {
    if (this.modelPadsInitialized) return;
    const rootMesh = modelEl.getObject3D('mesh');
    if (!rootMesh) return;

    // Columna 0: Object_8 (izquierda)
    // Columna 1: Object_11
    // Columna 2: Object_14
    // Columna 3: Object_17 (derecha)
    const colMeshNames = ['Object_8', 'Object_11', 'Object_14', 'Object_17'];
    const padCenters = [0.0, 2.4, 4.8, 7.2, 9.6];

    // Configuración tímbrica por fila (0..3 de atrás hacia adelante)
    const voiceConfigs = [
      { voice: 'crash', color: '#f59e0b' },  // Fila 0: Crash (Ámbar)
      { voice: 'hihat', color: '#10b981' },  // Fila 1: Hi-Hat (Esmeralda)
      { voice: 'snare', color: '#38bdf8' },  // Fila 2: Snare (Azul Cobalto)
      { voice: 'kick',  color: '#ec4899' }   // Fila 3: Kick (Magenta/Rosa)
    ];

    colMeshNames.forEach((name, cIdx) => {
      const colMesh = rootMesh.getObjectByName(name);
      if (!colMesh) return;

      // Ocultamos la malla original combinada
      colMesh.visible = false;

      const geom = colMesh.geometry;
      const posAttr = geom.attributes.position;
      const normAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      const indexAttr = geom.index;

      // Agrupamos triángulos por el centro X local
      const padTris = [[], [], [], [], []];
      for (let i = 0; i < indexAttr.count; i += 3) {
        const a = indexAttr.getX(i);
        const b = indexAttr.getX(i + 1);
        const c = indexAttr.getX(i + 2);

        const avgX = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3.0;
        let bestP = 0;
        let minD = 999;
        for (let p = 0; p < 5; p++) {
          const d = Math.abs(padCenters[p] - avgX);
          if (d < minD) {
            minD = d;
            bestP = p;
          }
        }
        padTris[bestP].push(a, b, c);
      }

      // Creamos submallas para cada uno de los pads
      for (let pIdx = 0; pIdx < 5; pIdx++) {
        const tris = padTris[pIdx];
        const subGeom = new THREE.BufferGeometry();
        const oldToNew = new Map();
        const newPos = [];
        const newNorm = [];
        const newUv = [];
        const newIdx = [];

        tris.forEach((oldIdx) => {
          if (!oldToNew.has(oldIdx)) {
            const newI = newPos.length / 3;
            oldToNew.set(oldIdx, newI);
            newPos.push(posAttr.getX(oldIdx), posAttr.getY(oldIdx), posAttr.getZ(oldIdx));
            if (normAttr) newNorm.push(normAttr.getX(oldIdx), normAttr.getY(oldIdx), normAttr.getZ(oldIdx));
            if (uvAttr) newUv.push(uvAttr.getX(oldIdx), uvAttr.getY(oldIdx));
          }
          newIdx.push(oldToNew.get(oldIdx));
        });

        subGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
        if (normAttr) subGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
        if (uvAttr) subGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
        subGeom.setIndex(newIdx);

        const isExtraPad = (pIdx === 4);
        const mat = new THREE.MeshStandardMaterial({
          color: isExtraPad ? '#1e293b' : '#334155',
          emissive: '#000000',
          emissiveIntensity: 0,
          roughness: 0.55,
          metalness: 0.15
        });

        const padMesh = new THREE.Mesh(subGeom, mat);
        padMesh.name = `real_pad_${pIdx}_${cIdx}`;
        colMesh.parent.add(padMesh);

        if (!isExtraPad) {
          const rIdx = pIdx; // Fila 0..3 (Crash, Hi-Hat, Snare, Kick)
          const voiceCfg = voiceConfigs[rIdx];

          const padController = new window.PadMeshController({
            row: rIdx,
            col: cIdx,
            voice: voiceCfg.voice,
            activeColor: voiceCfg.color,
            defaultColor: '#334155',
            flashColor: '#ffffff',
            mesh: padMesh
          });

          padMesh.userData = {
            isPad: true,
            row: rIdx,
            col: cIdx,
            pad: padController
          };

          this.padMatrix.set(`${rIdx}_${cIdx}`, padController);
        }
      }
    });

    // Delegación de eventos de clic y raycast sobre el modelo GLTF
    modelEl.classList.add('interactable');
    const onModelClick = (evt) => {
      const hitMesh = evt.detail?.intersection?.object;
      if (hitMesh && hitMesh.userData?.pad) {
        hitMesh.userData.pad.onClick(evt);
      }
    };

    modelEl.addEventListener('click', onModelClick);
    modelEl.addEventListener('touchend', onModelClick);

    // Feedback de cursor en ratón
    modelEl.addEventListener('mouseenter', () => {
      document.body.style.cursor = 'pointer';
    });
    modelEl.addEventListener('mouseleave', () => {
      document.body.style.cursor = 'default';
    });

    this.modelPadsInitialized = true;
    console.log('[DrumLab] 16 pads interactivos del modelo 3D inicializados con éxito.');
  },

  /**
   * Vincula los botones 3D de transporte situados en el controlador
   */
  bindTransportButtons: function () {
    const btnPlay = document.getElementById('btn-play-stop');
    const btnClear = document.getElementById('btn-clear');
    const btnBpm = document.getElementById('btn-bpm');

    if (btnPlay && !btnPlay.dataset.bound) {
      btnPlay.dataset.bound = 'true';
      const onPlay = (e) => {
        if (e) e.stopPropagation();
        this.togglePlay();
      };
      btnPlay.addEventListener('click', onPlay);
      btnPlay.addEventListener('touchend', onPlay);
    }

    if (btnClear && !btnClear.dataset.bound) {
      btnClear.dataset.bound = 'true';
      const onClear = (e) => {
        if (e) e.stopPropagation();
        this.clearPattern();
      };
      btnClear.addEventListener('click', onClear);
      btnClear.addEventListener('touchend', onClear);
    }

    if (btnBpm && !btnBpm.dataset.bound) {
      btnBpm.dataset.bound = 'true';
      const onBpm = (e) => {
        if (e) e.stopPropagation();
        this.cycleBpm();
      };
      btnBpm.addEventListener('click', onBpm);
      btnBpm.addEventListener('touchend', onBpm);
    }
  },

  /**
   * Manejador de eventos de teclado físico (doble interfaz)
   */
  onKeyDown: function (evt) {
    if (evt.target && (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA')) {
      return;
    }

    const key = evt.key.toLowerCase();

    // 1. Barra espaciadora: Play / Stop
    if (evt.code === 'Space' || key === ' ') {
      evt.preventDefault();
      this.togglePlay();
      return;
    }

    // 2. Tecla 'b': Conmutar BPM
    if (key === 'b') {
      evt.preventDefault();
      this.cycleBpm();
      return;
    }

    // 3. Tecla 'Delete' o 'Backspace' o 'c': Limpiar patrón
    if (key === 'delete' || key === 'backspace' || key === 'c') {
      evt.preventDefault();
      this.clearPattern();
      return;
    }

    // 4. Teclas isomórficas de la matriz 4x4 (1-4, Q-R, A-F, Z-V)
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
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
  },

  startPlayback: function () {
    if (this.isPlaying) return;

    if (window.DrumLabAudio) {
      window.DrumLabAudio.unlock();
    }

    this.isPlaying = true;
    this.currentStep = -1;
    this.updatePlayButtonVisual(true);

    const stepIntervalMs = (60 / this.data.bpm) * 1000;
    this.onTick();
    this.timerId = setInterval(this.onTick, stepIntervalMs);
  },

  stopPlayback: function () {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.currentStep = -1;
    this.updateTempoLeds(-1);
    this.updatePlayButtonVisual(false);
  },

  /**
   * Pulso del reloj secuenciador: avanza la columna activa y dispara los pads activos
   */
  onTick: function () {
    // Avanza cíclicamente a través de los 4 tiempos (0, 1, 2, 3)
    this.currentStep = (this.currentStep + 1) % 4;

    // Actualiza los indicadores LED del compás
    this.updateTempoLeds(this.currentStep);

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
   * Actualiza el estado visual de los 4 LEDs de compás (Columnas 0 a 3)
   */
  updateTempoLeds: function (activeCol) {
    const leds = document.querySelectorAll(this.data.tempoLedsSelector);
    leds.forEach((ledEl) => {
      const colAttr = parseInt(ledEl.getAttribute('data-col'), 10);
      if (colAttr === activeCol) {
        ledEl.setAttribute('material', {
          color: '#ffffff',
          emissive: '#38bdf8',
          emissiveIntensity: 1.8
        });
      } else {
        ledEl.setAttribute('material', {
          color: '#334155',
          emissive: '#000000',
          emissiveIntensity: 0
        });
      }
    });
  },

  /**
   * Alterna entre los valores de tempo: 90 -> 120 -> 140 -> 90 BPM
   */
  cycleBpm: function () {
    this.currentBpmIndex = (this.currentBpmIndex + 1) % this.bpmOptions.length;
    this.data.bpm = this.bpmOptions[this.currentBpmIndex];

    const bpmTextEl = document.getElementById('text-bpm-val');
    if (bpmTextEl) {
      bpmTextEl.setAttribute('value', `${this.data.bpm} BPM`);
    }

    if (this.isPlaying) {
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
   * Actualiza el botón 3D Play/Stop entre verde/rojo y su texto
   */
  updatePlayButtonVisual: function (isPlaying) {
    const btnPlay = document.getElementById('btn-play-stop');
    const playText = document.getElementById('text-play-val');
    if (!btnPlay || !playText) return;

    if (isPlaying) {
      btnPlay.setAttribute('material', {
        color: '#b91c1c',
        emissive: '#ef4444',
        emissiveIntensity: 0.6
      });
      playText.setAttribute('value', 'STOP');
    } else {
      btnPlay.setAttribute('material', {
        color: '#059669',
        emissive: '#10b981',
        emissiveIntensity: 0.4
      });
      playText.setAttribute('value', 'PLAY');
    }
  },

  remove: function () {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    window.removeEventListener('keydown', this.onKeyDown);
  }
});
