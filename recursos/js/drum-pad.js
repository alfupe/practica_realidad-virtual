/**
 * DrumLab VR — Motor de Audio de Baja Latencia y Componente drum-pad
 * Proyecto Académico: Realidad Virtual (UOC) - Práctica
 * Estudiante: Alejandro Fuentes Pérez
 * 
 * Arquitectura:
 * - DrumLabAudioEngine: Síntesis procedural pura (Web Audio API <15ms) + soporte de muestras .wav
 * - Componente AFRAME 'drum-pad': Autómata Finito de 3 Estados (INACTIVO, ACTIVO_ESPERA, DISPARANDO)
 */

/* ==========================================================================
   1. MOTOR DE AUDIO DE BAJA LATENCIA (Web Audio API)
   ========================================================================== */
class DrumLabAudioEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
    this.sampleBuffers = new Map();
    this.samplePaths = {
      crash: 'assets/audio/crash.wav',
      hihat: 'assets/audio/hihat.wav',
      snare: 'assets/audio/snare.wav',
      kick: 'assets/audio/kick.wav'
    };

    // Inicialización perezosa (lazy) con el primer gesto del usuario
    this.initAudioContext = this.initAudioContext.bind(this);
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
   * Intenta precargar archivos WAV si están presentes en recursos/assets/audio/
   * Degrada silenciosamente a síntesis procedural si no existen (sin bloquear la ejecución).
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
        // Fallback a síntesis procedural garantizado
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

    // Si disponemos de buffer precargado, lo reproducimos directamente
    if (this.sampleBuffers.has(voice)) {
      this.playBuffer(this.sampleBuffers.get(voice));
      return;
    }

    // De lo contrario, síntesis procedural de alta fidelidad (<15ms)
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
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }

  /**
   * SÍNTESIS PROCEDURAL: BOMBO (KICK)
   * Senoide profunda barriendo de 160Hz a 42Hz + decaimiento exponencial + transitorio punchy
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
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  }

  /**
   * SÍNTESIS PROCEDURAL: CAJA (SNARE)
   * Tono fundamental (~185Hz) + buffer de ruido blanco filtrado paso banda (~1200Hz)
   */
  synthesizeSnare(ctx, now) {
    // 1. Componente tonal del cuerpo
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.07);
    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // 2. Componente de bordón (ruido blanco filtrado)
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(1.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 0.21);
  }

  /**
   * SÍNTESIS PROCEDURAL: CHARLES / HI-HAT
   * Ruido blanco a través de filtro paso alto (7500Hz) con decaimiento percusivo rápido (0.055s)
   */
  synthesizeHiHat(ctx, now) {
    const bufferSize = ctx.sampleRate * 0.06;
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
    gain.gain.setValueAtTime(0.75, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 0.06);
  }

  /**
   * SÍNTESIS PROCEDURAL: PLATO CRASH
   * Ruido blanco y textura metálica con filtro resonante y decaimiento envolvente (~1.2s)
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
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + 1.21);
  }
}

// Instancia única global del motor de sonido
window.DrumLabAudio = new DrumLabAudioEngine();

// Eventos de desbloqueo proactivo en la ventana superior
window.addEventListener('click', () => window.DrumLabAudio.unlock(), { once: true });
window.addEventListener('keydown', () => window.DrumLabAudio.unlock(), { once: true });


/* ==========================================================================
   2. COMPONENTE A-FRAME: drum-pad (Autómata Finito de 3 Estados)
   ========================================================================== */

/**
 * Estados del FSM:
 * - 'INACTIVO': Gris oscuro apagado, escala Z = 1. No suena en el reloj.
 * - 'ACTIVO_ESPERA': Color tímbrico emisivo (Cian/Ámbar/Esmeralda/Magenta). Suena cuando el reloj llega a su columna.
 * - 'DISPARANDO': Destello blanco brillante + micro-compresión física Z durante 100 ms + disparo sonoro.
 */
AFRAME.registerComponent('drum-pad', {
  schema: {
    row: { type: 'int', default: 0 },         // 0: Crash, 1: Hi-Hat, 2: Snare, 3: Kick
    col: { type: 'int', default: 0 },         // 0..3 (Tiempos 1 a 4 del compás 4/4)
    voice: { type: 'string', default: 'kick' },
    label: { type: 'string', default: '' },
    shortcutKey: { type: 'string', default: '' }
  },

  init: function () {
    this.state = 'INACTIVO';                  // Estado inicial
    this.originalScale = { x: 1, y: 1, z: 1 };
    this.flashTimeout = null;

    // Configuración visual por voz tímbrica
    this.voiceColors = {
      crash: { base: '#2b2413', active: '#ffb703', flash: '#ffffff' },
      hihat: { base: '#122b1e', active: '#00f59b', flash: '#ffffff' },
      snare: { base: '#122638', active: '#00e5ff', flash: '#ffffff' },
      kick:  { base: '#331323', active: '#ff2a85', flash: '#ffffff' }
    };

    // Color asignado a este pad
    this.colorConfig = this.voiceColors[this.data.voice] || this.voiceColors.kick;

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

    // Eventos de interacción con el ratón / raycaster
    this.el.addEventListener('click', this.onClick);
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

    // Conmutación de paso en el secuenciador:
    // Si estaba inactivo pasa a activo; si estaba activo pasa a inactivo
    const nextProgrammedState = (this.state === 'INACTIVO') ? 'ACTIVO_ESPERA' : 'INACTIVO';

    // Dispara sonido + destello y retorna al nuevo estado programado
    this.triggerDisparo(nextProgrammedState);
  },

  /**
   * Transición a DISPARANDO:
   * 1. Sonido inmediato (<15ms)
   * 2. Destello emisivo blanco intenso
   * 3. Micro-compresión geométrica en el eje Z (o profundidad del botón) durante 100 ms
   * @param {'INACTIVO' | 'ACTIVO_ESPERA'} returnState Estado al que volver tras los 100 ms
   */
  triggerDisparo: function (returnState = null) {
    // Si no se especifica estado de retorno, preserva el estado de programación previo
    const finalState = returnState || ((this.state === 'INACTIVO') ? 'INACTIVO' : 'ACTIVO_ESPERA');

    this.state = 'DISPARANDO';

    // 1. Disparo de sonido inmediato
    window.DrumLabAudio.play(this.data.voice);

    // 2. Destello visual emisivo
    this.el.setAttribute('material', {
      color: this.colorConfig.flash,
      emissive: this.colorConfig.flash,
      emissiveIntensity: 1.6,
      roughness: 0.2
    });

    // 3. Micro-compresión física en el eje Z (escala Z reducida a 0.4 durante 100 ms)
    this.el.setAttribute('scale', {
      x: this.originalScale.x,
      y: this.originalScale.y,
      z: this.originalScale.z * 0.4
    });

    // Si había un temporizador previo en vuelo, se cancela (early return)
    if (this.flashTimeout) {
      clearTimeout(this.flashTimeout);
    }

    // Regreso tras 100 ms
    this.flashTimeout = setTimeout(() => {
      this.state = finalState;
      this.resetFromDisparo();
    }, 100);
  },

  /**
   * Restablece la geometría y color tras la micro-compresión
   */
  resetFromDisparo: function () {
    // Restaurar escala física Z = 1
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
        color: '#1a2233',
        emissive: '#0b101c',
        emissiveIntensity: 0.1,
        roughness: 0.6,
        metalness: 0.3
      });
      return;
    }

    if (this.state === 'ACTIVO_ESPERA') {
      this.el.setAttribute('material', {
        color: this.colorConfig.active,
        emissive: this.colorConfig.active,
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
  }
});
