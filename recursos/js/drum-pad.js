/**
 * DrumLab VR — Motor de Audio de Baja Latencia y Componente drum-pad
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Arquitectura:
 * - DrumLabAudioEngine: Web Audio API (<15ms) con muestras .wav y síntesis procedural pura
 * - Componente AFRAME 'drum-pad': Autómata Finito de 3 Estados (INACTIVO, ACTIVO_ESPERA, DISPARANDO)
 */

/* ==========================================================================
   1. MOTOR DE AUDIO DE BAJA LATENCIA (Web Audio API)
   ========================================================================== */
class DrumLabAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isUnlocked = false;
    this.sampleBuffers = new Map();
    this.samplePaths = {
      crash: 'assets/audio/crash.wav',
      hihat: 'assets/audio/hihat.wav',
      snare: 'assets/audio/snare.wav',
      kick: 'assets/audio/kick.wav'
    };

    // Bindings de contexto
    this.getContext = this.getContext.bind(this);
    this.unlock = this.unlock.bind(this);
    this.play = this.play.bind(this);
    this.playBuffer = this.playBuffer.bind(this);
  }

  /**
   * Obtiene o inicializa el AudioContext respetando las políticas de autoplay
   */
  getContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[DrumLabAudio] Web Audio API no está disponible en este navegador.');
      return null;
    }

    this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    this.preloadSamples();
    return this.ctx;
  }

  /**
   * Desbloquea el contexto tras una interacción de usuario (clic o teclado)
   */
  unlock() {
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        this.isUnlocked = true;
      });
      return;
    }
    this.isUnlocked = true;
  }

  /**
   * Precarga los archivos WAV disponibles en recursos/assets/audio/
   * Degrada silenciosamente a síntesis procedural si no están disponibles
   */
  async preloadSamples() {
    const ctx = this.getContext();
    if (!ctx) return;

    for (const [voice, url] of Object.entries(this.samplePaths)) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.sampleBuffers.set(voice, audioBuffer);
        console.log(`[DrumLabAudio] Muestra de audio cargada con éxito: ${voice}`);
      } catch (err) {
        console.warn(`[DrumLabAudio] Fallback procedural activo para: ${voice}`);
      }
    }
  }

  /**
   * Reproduce un sonido de percusión por voz:
   * Prioriza la muestra de audio cargada; si no existe, ejecuta síntesis procedural instantánea.
   * @param {'crash' | 'hihat' | 'snare' | 'kick'} voice 
   */
  play(voice) {
    this.unlock();
    const ctx = this.getContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Si disponemos de buffer precargado, lo reproducimos directamente
    if (this.sampleBuffers.has(voice)) {
      this.playBuffer(this.sampleBuffers.get(voice));
      return;
    }

    // Síntesis procedural pura de respaldo
    const now = ctx.currentTime;
    switch (voice) {
      case 'kick':
        this.synthesizeKick(ctx, now);
        break;
      case 'snare':
        this.synthesizeSnare(ctx, now);
        break;
      case 'hihat':
        this.synthesizeHiHat(ctx, now);
        break;
      case 'crash':
        this.synthesizeCrash(ctx, now);
        break;
      default:
        console.warn(`[DrumLabAudio] Voz percusiva desconocida: ${voice}`);
        break;
    }
  }

  playBuffer(buffer) {
    const ctx = this.getContext();
    if (!ctx || !buffer) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.masterGain || ctx.destination);
      source.start(0);
    } catch (e) {
      console.error('[DrumLabAudio] Error al reproducir buffer:', e);
    }
  }

  /**
   * SÍNTESIS PROCEDURAL: BOMBO (KICK)
   */
  synthesizeKick(ctx, now) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.08);

    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain || ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  }

  /**
   * SÍNTESIS PROCEDURAL: CAJA (SNARE)
   */
  synthesizeSnare(ctx, now) {
    // Componente tonal
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain || ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);

    // Componente de bordonero (ruido blanco filtrado)
    const bufferSize = Math.floor(ctx.sampleRate * 0.2);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, now);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain || ctx.destination);

    noise.start(now);
    noise.stop(now + 0.19);
  }

  /**
   * SÍNTESIS PROCEDURAL: CHARLES / HI-HAT
   */
  synthesizeHiHat(ctx, now) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.08);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7500, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain || ctx.destination);

    noise.start(now);
    noise.stop(now + 0.065);
  }

  /**
   * SÍNTESIS PROCEDURAL: PLATO CRASH
   */
  synthesizeCrash(ctx, now) {
    const bufferSize = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3600, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain || ctx.destination);

    noise.start(now);
    noise.stop(now + 1.21);
  }
}

// Instancia única global del motor de sonido
window.DrumLabAudio = new DrumLabAudioEngine();

// Eventos de desbloqueo proactivo
const unlockAudioGlobal = () => {
  if (window.DrumLabAudio) {
    window.DrumLabAudio.unlock();
  }
};
window.addEventListener('click', unlockAudioGlobal);
window.addEventListener('touchstart', unlockAudioGlobal);
window.addEventListener('keydown', unlockAudioGlobal);


/* ==========================================================================
   2. CONTROLADOR DE PADS SOBRE EL MODELO 3D GLTF REAL
   ========================================================================== */

/**
 * Controlador de Pad físico integrado en la geometría del modelo GLTF:
 * Autómata finito de 3 estados (INACTIVO, ACTIVO_ESPERA, DISPARANDO) con
 * micro-compresión física 3D en el pad del modelo y feedback emisivo tímbrico.
 */
class PadMeshController {
  constructor(options) {
    this.row = options.row;
    this.col = options.col;
    this.voice = options.voice;
    this.mesh = options.mesh;
    this.activeColor = options.activeColor;
    this.defaultColor = options.defaultColor || '#334155';
    this.flashColor = options.flashColor || '#ffffff';
    this.state = 'INACTIVO';
    this.originalLocalY = this.mesh ? this.mesh.position.y : 0;
    this.flashTimeout = null;

    this.onClick = this.onClick.bind(this);
    this.triggerDisparo = this.triggerDisparo.bind(this);
    this.resetFromDisparo = this.resetFromDisparo.bind(this);
    this.applyStateVisuals = this.applyStateVisuals.bind(this);

    this.applyStateVisuals();
  }

  onClick(evt) {
    if (evt && evt.stopPropagation) evt.stopPropagation();
    if (window.DrumLabAudio) {
      window.DrumLabAudio.unlock();
    }
    const nextState = (this.state === 'INACTIVO') ? 'ACTIVO_ESPERA' : 'INACTIVO';
    this.triggerDisparo(nextState);
  }

  triggerDisparo(returnState = null) {
    const finalState = returnState || ((this.state === 'INACTIVO') ? 'INACTIVO' : 'ACTIVO_ESPERA');
    this.state = 'DISPARANDO';

    if (window.DrumLabAudio) {
      window.DrumLabAudio.play(this.voice);
    }

    if (this.mesh && this.mesh.material) {
      this.mesh.material.color.set(this.flashColor);
      this.mesh.material.emissive.set(this.flashColor);
      this.mesh.material.emissiveIntensity = 2.0;
      this.mesh.position.y = this.originalLocalY - 0.008;
    }

    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.state = finalState;
      this.resetFromDisparo();
    }, 100);
  }

  resetFromDisparo() {
    if (this.mesh) {
      this.mesh.position.y = this.originalLocalY;
    }
    this.applyStateVisuals();
  }

  applyStateVisuals() {
    if (!this.mesh || !this.mesh.material) return;
    if (this.state === 'INACTIVO') {
      this.mesh.material.color.set(this.defaultColor);
      this.mesh.material.emissive.set('#000000');
      this.mesh.material.emissiveIntensity = 0;
      this.mesh.material.roughness = 0.55;
      this.mesh.material.metalness = 0.15;
    } else if (this.state === 'ACTIVO_ESPERA') {
      this.mesh.material.color.set(this.activeColor);
      this.mesh.material.emissive.set(this.activeColor);
      this.mesh.material.emissiveIntensity = 0.85;
      this.mesh.material.roughness = 0.3;
      this.mesh.material.metalness = 0.1;
    }
  }

  setState(newState) {
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    this.state = newState;
    if (this.mesh) {
      this.mesh.position.y = this.originalLocalY;
    }
    this.applyStateVisuals();
  }

  isStepActive() {
    return this.state === 'ACTIVO_ESPERA';
  }
}

window.PadMeshController = PadMeshController;


/* ==========================================================================
   3. COMPONENTE A-FRAME: drum-pad (Autómata Finito para Entidades DOM)
   ========================================================================== */

/**
 * Estados del FSM:
 * - 'INACTIVO': Gris oscuro apagado, escala Z = 1. No suena en el reloj.
 * - 'ACTIVO_ESPERA': Color tímbrico emisivo. Suena cuando el reloj llega a su columna.
 * - 'DISPARANDO': Destello blanco brillante + micro-compresión física Z durante 100 ms + disparo sonoro.
 */
AFRAME.registerComponent('drum-pad', {
  schema: {
    row: { type: 'int', default: 0 },         // 0: Crash, 1: Hi-Hat, 2: Snare, 3: Kick
    col: { type: 'int', default: 0 },         // 0..3 (Tiempos 1 a 4 del compás 4/4)
    voice: { type: 'string', default: 'kick' },
    defaultColor: { type: 'color', default: '#1e293b' },
    activeColor: { type: 'color', default: '#38bdf8' },
    flashColor: { type: 'color', default: '#ffffff' },
    label: { type: 'string', default: '' },
    shortcutKey: { type: 'string', default: '' }
  },

  init: function () {
    this.state = 'INACTIVO';                  // Estado inicial
    this.originalScale = { x: 1, y: 1, z: 1 };
    this.flashTimeout = null;

    // Vinculación de métodos
    this.onClick = this.onClick.bind(this);
    this.triggerDisparo = this.triggerDisparo.bind(this);
    this.resetFromDisparo = this.resetFromDisparo.bind(this);
    this.applyStateVisuals = this.applyStateVisuals.bind(this);

    // Guardar escala original del elemento
    const currentScale = this.el.getAttribute('scale') || { x: 1, y: 1, z: 1 };
    this.originalScale = { x: currentScale.x, y: currentScale.y, z: currentScale.z };

    // Establecer visuales de reposo
    this.applyStateVisuals();

    // Eventos de interacción con el ratón / raycaster / toque
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('touchend', this.onClick);
    this.el.addEventListener('mouseenter', () => {
      document.body.style.cursor = 'pointer';
    });
    this.el.addEventListener('mouseleave', () => {
      document.body.style.cursor = 'default';
    });
  },

  /**
   * Manejador de clic: conmuta el estado de programación del paso y percute de inmediato
   */
  onClick: function (evt) {
    if (evt) evt.stopPropagation();

    // Desbloquear audio si está suspendido
    if (window.DrumLabAudio) {
      window.DrumLabAudio.unlock();
    }

    // Conmutación de paso en el secuenciador:
    const nextProgrammedState = (this.state === 'INACTIVO') ? 'ACTIVO_ESPERA' : 'INACTIVO';

    // Dispara sonido + destello y retorna al nuevo estado programado
    this.triggerDisparo(nextProgrammedState);
  },

  /**
   * Transición a DISPARANDO:
   * 1. Sonido inmediato (<15ms)
   * 2. Destello emisivo blanco intenso
   * 3. Micro-compresión física en el eje Z durante 100 ms
   * @param {'INACTIVO' | 'ACTIVO_ESPERA'} returnState Estado al que volver tras los 100 ms
   */
  triggerDisparo: function (returnState = null) {
    const finalState = returnState || ((this.state === 'INACTIVO') ? 'INACTIVO' : 'ACTIVO_ESPERA');

    this.state = 'DISPARANDO';

    // 1. Disparo de sonido inmediato
    if (window.DrumLabAudio) {
      window.DrumLabAudio.play(this.data.voice);
    }

    // 2. Destello visual emisivo
    this.el.setAttribute('material', {
      color: this.data.flashColor,
      emissive: this.data.flashColor,
      emissiveIntensity: 1.5,
      roughness: 0.2
    });

    // 3. Micro-compresión física en el eje Z
    this.el.setAttribute('scale', {
      x: this.originalScale.x,
      y: this.originalScale.y,
      z: this.originalScale.z * 0.4
    });

    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
    }

    this.flashTimeout = setTimeout(() => {
      this.state = finalState;
      this.resetFromDisparo();
    }, 100);
  },

  /**
   * Restablece la geometría y color tras la micro-compresión
   */
  resetFromDisparo: function () {
    this.el.setAttribute('scale', {
      x: this.originalScale.x,
      y: this.originalScale.y,
      z: this.originalScale.z
    });

    this.applyStateVisuals();
  },

  /**
   * Aplica las propiedades de material correspondientes al estado actual
   */
  applyStateVisuals: function () {
    if (this.state === 'INACTIVO') {
      this.el.setAttribute('material', {
        color: this.data.defaultColor,
        emissive: '#000000',
        emissiveIntensity: 0,
        roughness: 0.6,
        metalness: 0.3
      });
      return;
    }

    if (this.state === 'ACTIVO_ESPERA') {
      this.el.setAttribute('material', {
        color: this.data.activeColor,
        emissive: this.data.activeColor,
        emissiveIntensity: 0.85,
        roughness: 0.3,
        metalness: 0.2
      });
      return;
    }
  },

  /**
   * Establece externamente el estado del pad (ej. botón CLEAR)
   */
  setState: function (newState) {
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
    this.state = newState;
    this.el.setAttribute('scale', this.originalScale);
    this.applyStateVisuals();
  },

  /**
   * Consulta si el paso está programado para sonar en el compás
   */
  isStepActive: function () {
    return this.state === 'ACTIVO_ESPERA';
  },

  remove: function () {
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
    }
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('touchend', this.onClick);
  }
});
