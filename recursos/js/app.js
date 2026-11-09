/**
 * DrumLab VR — Orquestador de Aplicación y Visor WebXR (app.js)
 * 
 * Asignatura: Realidad Virtual (Semestre 2627/1)
 * Titulación: Grado en Multimedia, Universitat Oberta de Catalunya (UOC)
 * Estudiante: Alex Fuentes (alfupe@uoc.edu)
 * 
 * Arquitectura Clean Code y Principios SOLID:
 * - Single Responsibility Principle (SRP): Cada módulo coordina un dominio aislado:
 *   1. SceneNavigationController: Alternancia de vistas 3D, ARIA y telemetría.
 *   2. ViewerActionsController: Pantalla completa y recarga de contexto WebGL.
 *   3. KeyboardBridgeController: Enrutamiento isomórfico de teclado hacia WebXR.
 *   4. UrlHistoryManager: Enlaces profundos (deep linking) y sincronización con History API.
 *   5. SpatialMessagingBridge: Comunicación postMessage con escenas virtuales hijas.
 * - High Cohesion & Loose Coupling: Componentes desacoplados con contratos explícitos.
 * - Robustez y Resiliencia: Gestión de excepciones en iframes cruzados y accesibilidad completa.
 */

'use strict';

/**
 * Constantes semánticas de configuración del sistema
 */
const SCENE_CONFIG = Object.freeze({
  STUDIO: 1,
  SEQUENCER: 2,
  PARAM_KEY: 'escena',
  LABELS: {
    1: 'ESCENA 1 · ESTUDIO DE PRODUCCIÓN',
    2: 'ESCENA 2 · SECUENCIADOR 4×4 OPERATIVO'
  }
});

/**
 * Controlador de navegación y visibilidad entre las escenas WebXR
 */
class SceneNavigationController {
  constructor() {
    this.container1 = document.getElementById('contenedor-1');
    this.container2 = document.getElementById('contenedor-2');
    this.button1 = document.getElementById('btn-scene1');
    this.button2 = document.getElementById('btn-scene2');
    this.frame1 = document.getElementById('frame-scene1');
    this.frame2 = document.getElementById('frame-scene2');
    this.sceneLabel = document.getElementById('current-scene-label') || document.getElementById('status-text');
    this.activeScene = SCENE_CONFIG.STUDIO;

    this.initEventListeners();
  }

  /**
   * Vincula los escuchadores de clic nativos de la barra de control de la consola
   */
  initEventListeners() {
    if (this.button1) {
      this.button1.addEventListener('click', () => this.switchScene(SCENE_CONFIG.STUDIO));
    }
    if (this.button2) {
      this.button2.addEventListener('click', () => this.switchScene(SCENE_CONFIG.SEQUENCER));
    }
  }

  /**
   * Conmuta la escena activa actualizando interfaz, visibilidad CSS y accesibilidad
   * @param {number} sceneNumber - Número de la escena a activar (1 o 2)
   * @param {boolean} [updateHistory=true] - Si se debe persistir el cambio en la URL
   */
  switchScene(sceneNumber, updateHistory = true) {
    if (sceneNumber !== SCENE_CONFIG.STUDIO && sceneNumber !== SCENE_CONFIG.SEQUENCER) {
      return;
    }

    this.activeScene = sceneNumber;
    const isStudio = (sceneNumber === SCENE_CONFIG.STUDIO);

    // 1. Transición suave de contenedores sin reconstrucción del canvas WebGL (cero parpadeo)
    if (this.container1) {
      this.container1.classList.toggle('active', isStudio);
    }
    if (this.container2) {
      this.container2.classList.toggle('active', !isStudio);
    }

    // 2. Estados de accesibilidad ARIA y clases activas en los botones de pestaña
    if (this.button1) {
      this.button1.classList.toggle('active', isStudio);
      this.button1.setAttribute('aria-selected', isStudio ? 'true' : 'false');
    }
    if (this.button2) {
      this.button2.classList.toggle('active', !isStudio);
      this.button2.setAttribute('aria-selected', !isStudio ? 'true' : 'false');
    }

    // 3. Etiqueta de telemetría de estado en el HUD
    if (this.sceneLabel) {
      this.sceneLabel.textContent = SCENE_CONFIG.LABELS[sceneNumber] || '';
    }

    // 4. Notificación al iframe activo para recalcular dimensiones de Three.js y asegurar foco
    const activeFrame = isStudio ? this.frame1 : this.frame2;
    if (activeFrame && activeFrame.contentWindow) {
      try {
        activeFrame.contentWindow.dispatchEvent(new Event('resize'));
        activeFrame.contentWindow.focus();
      } catch (err) {
        console.debug('Aviso al enfocar marco de escena:', err);
      }
    }

    // 5. Sincronización del historial con la History API de HTML5
    if (updateHistory && window.history && typeof window.history.pushState === 'function') {
      const url = new URL(window.location.href);
      url.searchParams.set(SCENE_CONFIG.PARAM_KEY, sceneNumber);
      window.history.pushState({ escena: sceneNumber }, '', url);
    }
  }

  /**
   * Retorna el elemento iframe que se encuentra visible actualmente
   * @returns {HTMLIFrameElement|null}
   */
  getActiveIframe() {
    return (this.activeScene === SCENE_CONFIG.STUDIO) ? this.frame1 : this.frame2;
  }
}

/**
 * Controlador de acciones sobre el marco del visor (Pantalla completa y Recarga)
 */
class ViewerActionsController {
  constructor(navigationController) {
    this.navigation = navigationController;
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.btnReload = document.getElementById('btn-reload');

    this.init();
  }

  init() {
    if (this.btnFullscreen) {
      this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }
    if (this.btnReload) {
      this.btnReload.addEventListener('click', () => this.reloadActiveScene());
    }
  }

  /**
   * Activa el modo pantalla completa sobre el marco iframe de la escena activa
   */
  toggleFullscreen() {
    const iframe = this.navigation.getActiveIframe();
    if (!iframe) return;

    if (iframe.requestFullscreen) {
      iframe.requestFullscreen().catch(() => {});
    } else if (iframe.webkitRequestFullscreen) {
      iframe.webkitRequestFullscreen();
    }
  }

  /**
   * Recarga el contexto de la escena activa sin forzar la recarga de toda la página
   */
  reloadActiveScene() {
    const iframe = this.navigation.getActiveIframe();
    if (!iframe) return;

    try {
      iframe.src = iframe.src;
    } catch (e) {
      iframe.contentWindow?.location.reload();
    }
  }
}

/**
 * Enrutador isomórfico de eventos de teclado hacia el iframe del secuenciador
 */
class KeyboardBridgeController {
  constructor(navigationController) {
    this.navigation = navigationController;
    this.init();
  }

  init() {
    window.addEventListener('keydown', (event) => this.handleKeydown(event), { passive: false });
  }

  /**
   * Filtra y reenvía pulsaciones de teclado hacia el secuenciador para permitir interacción isomórfica
   * @param {KeyboardEvent} event 
   */
  handleKeydown(event) {
    // Preservar atajos del navegador con modificadores (Ctrl, Cmd, Alt)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const frame2 = document.getElementById('frame-scene2');
    if (!frame2 || !frame2.contentWindow) return;

    try {
      frame2.contentWindow.dispatchEvent(new KeyboardEvent('keydown', {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true
      }));
    } catch (err) {
      console.debug('Error en reenvío isomórfico de teclado:', err);
    }
  }
}

/**
 * Gestor de sincronización de URL y soporte para botones Atrás/Adelante del navegador
 */
class UrlHistoryManager {
  constructor(navigationController) {
    this.navigation = navigationController;
    this.init();
  }

  init() {
    // 1. Lectura del parámetro ?escena=2 al cargar la página (Deep linking directo)
    const initialParams = new URLSearchParams(window.location.search);
    const escenaParam = initialParams.get(SCENE_CONFIG.PARAM_KEY);
    if (escenaParam === '2') {
      this.navigation.switchScene(SCENE_CONFIG.SEQUENCER, false);
    }

    // 2. Soporte para navegación con los botones del navegador (Popstate)
    window.addEventListener('popstate', (event) => {
      const stateScene = event.state && event.state.escena;
      if (stateScene) {
        this.navigation.switchScene(stateScene, false);
      } else {
        const currentParams = new URLSearchParams(window.location.search);
        const sceneNum = currentParams.get(SCENE_CONFIG.PARAM_KEY) === '2' ? 2 : 1;
        this.navigation.switchScene(sceneNum, false);
      }
    });
  }
}

/**
 * Puente de mensajería (postMessage) para la navegación espacial 3D iniciada desde WebGL
 */
class SpatialMessagingBridge {
  constructor(navigationController) {
    this.navigation = navigationController;
    this.init();
  }

  init() {
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.action === 'cambiarEscena') {
        const sceneNum = Number(event.data.escena);
        this.navigation.switchScene(sceneNum, true);
      }
    });
  }
}

/**
 * Fachada principal de la aplicación DrumLab VR
 */
class DrumLabApp {
  constructor() {
    this.navigation = new SceneNavigationController();
    this.viewer = new ViewerActionsController(this.navigation);
    this.keyboard = new KeyboardBridgeController(this.navigation);
    this.urlHistory = new UrlHistoryManager(this.navigation);
    this.messaging = new SpatialMessagingBridge(this.navigation);
  }

  /**
   * API pública para cambiar de escena desde elementos de marcado o scripts externos
   * @param {number} num - Número de escena (1 o 2)
   * @param {boolean} [updateUrl=true] - Si se debe actualizar el historial URL
   */
  cambiarEscena(num, updateUrl = true) {
    this.navigation.switchScene(num, updateUrl);
  }
}

// Inicialización controlada tras la carga del DOM
let appInstance = null;
function initApp() {
  if (appInstance) return;
  appInstance = new DrumLabApp();

  // Exposición en el espacio global para compatibilidad isomórfica y marcos hijos
  window.DrumLabApp = appInstance;
  window.cambiarEscena = (num, updateUrl = true) => appInstance.cambiarEscena(num, updateUrl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
