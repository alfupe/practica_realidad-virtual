/**
 * DrumLab VR — Secuenciador de Pasos 4/4 y Control de Transporte
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Responsabilidades:
 * - Reloj métrico cuaternario (4 tiempos por compás) con tempo seleccionable (90 / 120 / 140 BPM).
 * - Sincronización con el motor Web Audio y avance del cabezal de reproducción.
 * - Doble Interfaz Física: Entrada isomórfica de teclado (1-4, Q-R, A-F, Z-V) + Espacio + Clic 3D.
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
    this.padMatrix = new Map();                // Clave: "row_col", Valor: componente drum-pad
    this.keyMap = new Map();                   // Clave: tecla, Valor: "row_col"

    // Bindings de contexto
    this.onTick = this.onTick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.togglePlay = this.togglePlay.bind(this);
    this.startPlayback = this.startPlayback.bind(this);
    this.stopPlayback = this.stopPlayback.bind(this);
    this.clearPattern = this.clearPattern.bind(this);
    this.cycleBpm = this.cycleBpm.bind(this);
    this.registerPads = this.registerPads.bind(this);
    this.bindTransportButtons = this.bindTransportButtons.bind(this);

    // Mapeo isomórfico del teclado físico
    this.buildKeyMapping();

    // Inicialización de pads y botones
    const setup = () => {
      this.registerPads();
      this.bindTransportButtons();
    };

    if (this.el.sceneEl && this.el.sceneEl.hasLoaded) {
      setup();
    } else if (this.el.sceneEl) {
      this.el.sceneEl.addEventListener('loaded', setup);
    }
    // Doble comprobación defensiva
    setTimeout(setup, 200);

    // Escucha de eventos de teclado físico
    window.addEventListener('keydown', this.onKeyDown);
  },

  /**
   * Mapeo isomórfico directo del teclado QWERTY a la matriz de 4x4
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
   * Indexa todos los pads presentes en el DOM 3D de la escena
   */
  registerPads: function () {
    const padElements = document.querySelectorAll('[drum-pad]');
    padElements.forEach((padEl) => {
      const padComp = padEl.components['drum-pad'];
      if (!padComp) return;
      const key = `${padComp.data.row}_${padComp.data.col}`;
      this.padMatrix.set(key, padComp);
    });
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

      const nextState = (pad.state === 'INACTIVO') ? 'ACTIVO_ESPERA' : 'INACTIVO';
      pad.triggerDisparo(nextState);
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
    // Asegurar que los pads estén indexados
    if (this.padMatrix.size === 0) {
      this.registerPads();
    }

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
