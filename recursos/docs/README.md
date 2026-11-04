# Práctica: DrumLab VR — Secuenciador Rítmico Espacial 4/4 en WebXR

**Asignatura:** Realidad Virtual (Semestre 2627/1)  
**Estudiante:** Alejandro Fuentes Pérez (`alfupe@uoc.edu`)  
**Grado:** Grado de Multimedia - Universitat Oberta de Catalunya (UOC)  

---

## 1. Acceso y Ejecución del Proyecto

El proyecto está diseñado como una aplicación web estática ejecutable directamente bajo cualquier servidor HTTP local (como **Live Server** en Visual Studio Code o Python `http.server`):

```bash
# Ejemplo de ejecución local con Python (desde la raíz del proyecto):
python3 -m http.server 8080
# Abrir en el navegador: http://localhost:8080/
```

Repositorio en GitHub y despliegue:
🔗 **[https://alfupe.github.io/pec4_realidad-virtual/](https://alfupe.github.io/pec4_realidad-virtual/)**

---

## 2. Arquitectura del Proyecto

### A. Capa Web 2D (HTML5 Semántico y Metodología BEM)
El hipertexto plano organiza la experiencia formativa y divulgativa:
1. `index.html` (en la raíz): Punto de entrada con presentación, leyenda rápida de controles y contenedor `<iframe>` para la escena inmersiva.
2. `recursos/guia-ritmica.html`: Explicación didáctica de la estructura métrica en compás cuaternario 4/4, subdivisión en 4 columnas y función tímbrica de las 4 voces (Crash, Hi-Hat, Snare y Kick).
3. `recursos/licencias.html`: Tabla de atribución y propiedad intelectual (licencias CC BY 4.0, CC0, MIT y estándares W3C).

### B. Capa de Realidad Mixta / WebXR (A-Frame 1.6.0)
La experiencia espacial se divide en dos niveles complementarios:
1. `recursos/escena-estudio.html` (**Nivel Explorativo**):
   - Sala de producción sintética minimalista low-poly construida con primitivas optimizadas de A-Frame (`<a-plane>`, `<a-box>`, `<a-sky>`, luces direccionales y puntuales).
   - Mesa de producción con el controlador 3D *Oversized Drum Pad* y marcador interactivo flotante con animación senoidal continua.
   - Navegación al nivel manipulativo haciendo clic sobre el controlador o el cartel.
2. `recursos/escena-secuenciador.html` (**Nivel Manipulativo y Contributivo**):
   - Cámara en plano picado ergonómico (`rotation="-50 0 0"`) enfocada sobre el controlador.
   - Matriz 4&times;4 de drum pads interactivos (`.drum-pad`, `.interactable`) con micro-compresión física Z y destello luminoso.
   - 4 LEDs superiores de compás sincronizados con el cabezal de lectura.
   - Botones 3D de transporte: `Play/Stop`, `Clear` y conmutador cíclico de tempo (`90 / 120 / 140 BPM`).
   - Botón lateral para regresar al estudio.

### C. Motor de Sonido y Autómata Finito (`recursos/js/`)
1. **Motor Web Audio API (<15 ms):**
   - Módulo `DrumLabAudioEngine` con síntesis procedural instantánea sin dependencias externas:
     * *Kick*: Barrido exponencial de frecuencia (160 Hz &rarr; 42 Hz) y caída rápida.
     * *Snare*: Tono fundamental en 185 Hz + ruido blanco filtrado con paso banda en 1200 Hz.
     * *Hi-Hat*: Ruido blanco filtrado en alta frecuencia (7500 Hz) con decaimiento percusivo de 55 ms.
     * *Crash*: Ruido blanco y textura resonante filtrada (>3600 Hz) con envolvente de 1.2 segundos.
   - Carga transparente de archivos `.wav` desde `recursos/assets/audio/` con fallback garantizado a síntesis procedural.
2. **Componente `drum-pad` (Autómata Finito de 3 Estados):**
   - `INACTIVO`: Color pizarra oscuro apagado, escala física Z = 1.
   - `ACTIVO_ESPERA`: Color tímbrico emisivo (Ámbar, Esmeralda, Cian o Magenta) esperando el pulso del reloj.
   - `DISPARANDO`: Destello blanco brillante de alta intensidad + compresión física en Z (escala = 0.4) durante 100 ms + disparo sonoro de baja latencia.
3. **Doble Interfaz Física:**
   - **Ratón / Raycaster**: Conmuta el estado de programación de cada pad y dispara la percusión inmediata.
   - **Teclado Isomórfico**:
     * Fila 0 (Crash): `1`, `2`, `3`, `4`
     * Fila 1 (Hi-Hat): `Q`, `W`, `E`, `R`
     * Fila 2 (Snare): `A`, `S`, `D`, `F`
     * Fila 3 (Kick): `Z`, `X`, `C`, `V`
     * Transporte: `Espacio` (Play/Stop), `B` (Cambiar BPM), `Shift+C` o `Supr` (Borrar patrón).

---

## 3. Estructura de Archivos (Restricción de Entrega)

```text
.
├── index.html                    # ÚNICO archivo en el directorio raíz
└── recursos/                     # Todo el resto de componentes y activos
    ├── css/
    │   └── styles.css            # Estilos BEM y variables CSS3
    ├── js/
    │   ├── drum-pad.js           # Motor Web Audio y autómata de 3 estados
    │   └── step-sequencer.js     # Secuenciador 4/4, LEDs de compás y teclado isomórfico
    ├── escena-estudio.html        # Escena 1: Estudio de producción (Nivel explorativo)
    ├── escena-secuenciador.html   # Escena 2: Secuenciador 4x4 (Nivel manipulativo)
    ├── guia-ritmica.html          # Documento didáctico del compás 4/4 y las 4 voces
    ├── licencias.html             # Tabla de autoría y propiedad intelectual
    ├── assets/
    │   ├── audio/                # Directorio para muestras opcionales (.wav)
    │   └── models/               # Directorio para modelos 3D (.glb)
    └── docs/
        ├── Práctica_Fuentes_Alejandro.txt
        └── README.md
```
