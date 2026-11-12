# Práctica: DrumLab VR — Secuenciador Rítmico Espacial 4/4 en WebXR

**Asignatura:** Realidad Virtual (Semestre 2627/1)  
**Estudiante:** Alejandro Fuentes Pérez (`alfupe@uoc.edu`)  
**Grado:** Grado de Multimedia - Universitat Oberta de Catalunya (UOC)  

---

## Acceso al proyecto

El proyecto se encuentra publicado y operativo en **GitHub Pages** bajo protocolo HTTPS (necesario para el acceso a las APIs WebXR y Web Audio):

🔗 **[https://alfupe.github.io/practica_realidad-virtual/](https://alfupe.github.io/practica_realidad-virtual/)**

<p align="center">
  <img src="recursos/assets/qr-github-pages.png" alt="Código QR GitHub Pages — DrumLab VR" width="190">
</p>

* **Repositorio en GitHub:** [https://github.com/alfupe/practica_realidad-virtual](https://github.com/alfupe/practica_realidad-virtual)

---

## Descripción y fundamentación teórica

**DrumLab VR** es una aplicación interactiva de experimentación rítmica y secuenciación espacial construida con **HTML5, CSS3 (metodología BEM), JavaScript modular, A-Frame 1.6.0 (WebXR) y Web Audio API**.

El diseño del proyecto aborda los pilares teóricos fundamentales de la asignatura:

1. **Continuo de Milgram-Kishino y transición de contenidos planos a espaciales:**  
   La arquitectura integra una capa web plana informativa y didáctica (presentación general, guía del compás de 4/4 y tabla de licencias) que alberga la ventana inmersiva a través de un `<iframe>`, permitiendo una progresión natural desde el hipertexto convencional 2D hacia el entorno de Realidad Virtual.
2. **Inmersión y Presencia mediante feedback multisensorial:**  
   Se estimulan de forma simultánea el canal visual (iluminación dinámica, destellos emisivos y micro-compresión geométrica de los pads) y el auditivo (motor de percusión de baja latencia <15 ms), reforzando la sensación de presencia y causalidad física del sujeto en el entorno virtual.
3. **Niveles de interactividad diferenciados:**  
   * **Nivel 1 — Explorativo ([`recursos/escena-estudio.html`](recursos/escena-estudio.html)):** Entorno sintético de estudio de producción musical low-poly donde el usuario inspecciona el espacio, explora la mesa de mezclas con el modelo 3D *Maschine Native Instruments* y accede al nivel de manipulación.
   * **Nivel 2 — Manipulativo y Contributivo ([`recursos/escena-secuenciador.html`](recursos/escena-secuenciador.html)):** Cámara ergonómica en plano picado enfocada sobre el controlador matricial 4×4. El usuario no solo acciona los pulsadores, sino que programa secuencias temporales activas que componen un bucle rítmico continuo en compás cuaternario.

---

## Funcionalidades y arquitectura técnica

### 1. Secuenciador Matricial 4×4 y Reloj Temporal
La cuadrícula de 16 pads no responde a un disparador de muestras sueltas (*finger drumming*), sino a un **Secuenciador por Pasos (Step Sequencer)** que cruza el eje tímbrico (4 voces) con el eje temporal (los 4 pulsos del compás de 4/4):

```text
               Columna 1      Columna 2      Columna 3      Columna 4
              (Tiempo 1)     (Tiempo 2)     (Tiempo 3)     (Tiempo 4)
             ┌──────────────┬──────────────┬──────────────┬──────────────┐
Fila 0: CRASH│    Pad 0     │    Pad 1     │    Pad 2     │    Pad 3     │ Teclas: 1 - 2 - 3 - 4
             ├──────────────┼──────────────┼──────────────┼──────────────┤
Fila 1: HIHAT│    Pad 4     │    Pad 5     │    Pad 6     │    Pad 7     │ Teclas: Q - W - E - R
             ├──────────────┼──────────────┼──────────────┼──────────────┤
Fila 2: SNARE│    Pad 8     │    Pad 9     │    Pad 10    │    Pad 11    │ Teclas: A - S - D - F
             ├──────────────┼──────────────┼──────────────┼──────────────┤
Fila 3: KICK │    Pad 12    │    Pad 13    │    Pad 14    │    Pad 15    │ Teclas: Z - X - C - V
             └──────────────┴──────────────┴──────────────┴──────────────┘
               [ LED 1 ]      [ LED 2 ]      [ LED 3 ]      [ LED 4 ]
                                 ▲
                          Cabezal (Playhead)
```

* **4 voces percusivas:** Plato Crash (Fila 0), Charles/Hi-Hat cerrado (Fila 1), Caja/Snare (Fila 2) y Bombo/Kick (Fila 3).
* **4 subdivisiones de pulso:** Tiempos 1, 2, 3 y 4 del compás de 4/4.
* **Cabezal visual de tiempo (Playhead):** 4 LEDs emisivos sincronizados en la parte superior del controlador que indican el pulso activo del compás en tiempo real.
* **Controles de transporte 3D:**
  * `PLAY / STOP`: Inicia o pausa el reloj del secuenciador.
  * `CLEAR`: Limpia de golpe la matriz de programación.
  * `BPM`: Selector de tempo cíclico conmutando entre **90 BPM**, **120 BPM** y **140 BPM**.
  * `VOLVER AL ESTUDIO`: Navegación espacial de regreso al Nivel 1.

### 2. Autómata Finito de 3 Estados (`drum-pad`)
Cada pulsador de la matriz se gestiona mediante un autómata finito formal:
* **`INACTIVO`:** Pad en reposo (color pizarra oscuro, escala en Z = 1).
* **`ACTIVO_ESPERA`:** Pad programado en el secuenciador; emite brillo tímbrico característico (Ámbar, Verde, Azul o Magenta) a la espera del pulso del reloj.
* **`DISPARANDO`:** Disparo percusivo inmediato. Produce un destello blanco emisivo intenso, compresión física en el eje Z (escala = 0.4) durante 100 ms y reproducción acústica instantánea.

### 3. Doble Interfaz Física de Entrada
* **Ratón y Raycaster WebXR:** Clic interactivo sobre los pulsadores para programar/desprogramar y reproducir en tiempo real.
* **Teclado Isomórfico (mapeo ergonómico de 4 filas):**
  * Fila 0 (Crash): Teclas `1`, `2`, `3`, `4`
  * Fila 1 (Hi-Hat): Teclas `Q`, `W`, `E`, `R`
  * Fila 2 (Snare): Teclas `A`, `S`, `D`, `F`
  * Fila 3 (Kick): Teclas `Z`, `X`, `C`, `V`
  * Transporte: `Espacio` (Play/Stop), `B` (Ciclo de BPM), `Shift + C` o `Supr` (Borrar patrón).

### 4. Motor de Audio Híbrido (`Web Audio API`)
* **Muestras de percusión WAV:** Carga de muestras acústicas y electrónicas de alta fidelidad alojadas en `recursos/assets/audio/`.
* **Síntesis procedural nativa de respaldo:** Algoritmos procedurales puros con osciladores y filtros en tiempo real, garantizando que el secuenciador funcione con latencia imperceptible (<15 ms) incluso si los archivos externos no estuvieran disponibles.

---

## Estructura de archivos

Cumple con la restricción estricta de entrega académica de la UOC:

```text
Práctica_Fuentes_Alejandro/
├── index.html                    # ÚNICO archivo en el directorio raíz (Visor y presentación)
├── README.md                     # Documentación general del repositorio
├── Práctica_Fuentes_Alejandro.txt # Documento de entrega con URLs
└── recursos/                     # Subcarpeta contenedora de todos los recursos
    ├── css/
    │   └── styles.css            # Estilos BEM, maquetación adaptativa y temas
    ├── js/
    │   ├── app.js                # Orquestador del visor, sincronización de escenas y telemetría
    │   ├── drum-pad.js           # Motor Web Audio y autómata de 3 estados
    │   └── step-sequencer.js     # Secuenciador 4/4, reloj y teclado isomórfico
    ├── escena-estudio.html        # Nivel 1: Estudio explorativo (A-Frame)
    ├── escena-secuenciador.html   # Nivel 2: Secuenciador manipulativo 4x4 (A-Frame)
    ├── guia-ritmica.html          # Documento didáctico: teoría musical de 4/4 y voces
    ├── licencias.html             # Documento normativo de propiedad intelectual
    ├── assets/
    │   ├── audio/                # Muestras WAV de percusión (kick, snare, hihat, crash)
    │   ├── models/               # Modelo 3D del controlador (maschine_native_instruments.glb)
    │   └── qr-github-pages.png   # Código QR para acceso móvil
    └── docs/
        ├── Práctica_Fuentes_Alejandro.txt
        └── README.md
```

---

## Ejecución en entorno local

Las especificaciones de WebXR, Web Audio API y la importación de modelos 3D (`.glb`) requieren ejecución bajo protocolo HTTP/HTTPS local (no mediante `file://`):

### Opción 1: Extensión Live Server (VS Code)
1. Abrir la carpeta del proyecto en VS Code.
2. Hacer clic derecho sobre `index.html` y seleccionar **Open with Live Server**.

### Opción 2: Servidor HTTP integrado de Python
```bash
# Desde el directorio raíz del proyecto:
python3 -m http.server 8080
```
Abrir en el navegador: [http://localhost:8080/](http://localhost:8080/)

---

## Recursos de terceros y licencias

| Recurso | Archivo / Uso | Autor / Fuente | Licencia | Enlace de referencia |
| :--- | :--- | :--- | :---: | :--- |
| **"Maschine Native Instruments"** | `recursos/assets/models/maschine_native_instruments.glb` | **jmccopus** | **CC BY 4.0** | [Sketchfab (skfb.ly/6YTGQ)](https://skfb.ly/oAOvO) |
| **"Neon Photostudio"** | `recursos/assets/textures/studio_neon_360.jpg` (Entorno 360° Escena 1) | **Sergej Majboroda** | **CC0 1.0** | [Poly Haven](https://polyhaven.com/a/neon_photostudio) |
| **JavaScript Drum Kit** | `recursos/assets/audio/*.wav` (kick, snare, hihat, crash) | **Arun Michael Dsouza** | **MIT License** | [GitHub Repository](https://github.com/ArunMichaelDsouza/javascript-30-course) |
| **A-Frame WebXR Framework** | Framework 3D / WebXR v1.6.0 | Supermedium, Diego Marcos, Kevin Ngo | **MIT License** | [GitHub (aframevr/aframe)](https://github.com/aframevr/aframe) |
| **Web Audio & WebXR APIs** | Motor de sonido y renderizado inmersivo | W3C Consortium | **Estándar Abierto W3C** | [W3C Web Audio API](https://www.w3.org/TR/webaudio/) |

> **Atribución CC BY 4.0 requerida:**  
> *"Maschine Native Instruments" (https://skfb.ly/oAOvO) by jmccopus is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).*
