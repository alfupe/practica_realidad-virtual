#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de empaquetado para la entrega final UOC — DrumLab VR
# Genera Práctica_Fuentes_Alejandro.zip respetando la pauta oficial:
#   Práctica_Fuentes_Alejandro/
#     ├── index.html
#     └── recursos/
# Con tamaño estricto < 12 MB (12.582.912 bytes).
# ==============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly FOLDER_NAME="Práctica_Fuentes_Alejandro"
readonly ZIP_NAME="${FOLDER_NAME}.zip"
readonly MAX_BYTES=12582912 # 12 MB (12 * 1024 * 1024 bytes)

cd "${REPO_ROOT}"

# 1. Validar que existen los elementos obligatorios en la raíz
if [[ ! -f "index.html" || ! -d "recursos" ]]; then
  echo "ERROR: Deben existir 'index.html' y 'recursos/' en la raíz: ${REPO_ROOT}" >&2
  exit 1
fi

# 2. Eliminar cualquier paquete previo
rm -f "${ZIP_NAME}"

# 3. Preparar carpeta temporal denominada Práctica_Fuentes_Alejandro/
readonly STAGING_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${STAGING_ROOT}"
}
trap cleanup EXIT

readonly TARGET_DIR="${STAGING_ROOT}/${FOLDER_NAME}"
mkdir -p "${TARGET_DIR}"

cp "index.html" "${TARGET_DIR}/index.html"
cp -R "recursos" "${TARGET_DIR}/recursos"

# Limpiar posibles archivos ocultos o temporales del sistema dentro de recursos/
find "${TARGET_DIR}" \( -name ".DS_Store" -o -name "._*" -o -name "*.swp" -o -name "*.swo" -o -name "*~" \) -delete

# 4. Comprimir la carpeta Práctica_Fuentes_Alejandro/ manteniendo el directorio raíz con su nombre
echo "Empaquetando '${ZIP_NAME}' con carpeta raíz '${FOLDER_NAME}/'..."
(
  cd "${STAGING_ROOT}"
  zip -r -9 -q "${REPO_ROOT}/${ZIP_NAME}" "${FOLDER_NAME}"
)

# 5. Verificar mediante unzip -l la estructura exacta exigida por la UOC
readonly ZIP_LISTING="$(unzip -l "${ZIP_NAME}")"

if ! echo "${ZIP_LISTING}" | grep -qE "[[:space:]]${FOLDER_NAME}/index\.html$"; then
  echo "ERROR: No se encuentra '${FOLDER_NAME}/index.html' dentro de '${ZIP_NAME}'." >&2
  exit 1
fi

if ! echo "${ZIP_LISTING}" | grep -qE "[[:space:]]${FOLDER_NAME}/recursos/"; then
  echo "ERROR: No se encuentra '${FOLDER_NAME}/recursos/' dentro de '${ZIP_NAME}'." >&2
  exit 1
fi

# 6. Calcular el tamaño real en bytes y comprobar el límite estricto de 12 MB
readonly ZIP_BYTES="$(wc -c < "${ZIP_NAME}" | tr -d '[:space:]')"
readonly ZIP_MB="$(awk "BEGIN { printf \"%.2f\", ${ZIP_BYTES} / 1048576 }")"

if (( ZIP_BYTES > MAX_BYTES )); then
  echo "ERROR: '${ZIP_NAME}' pesa ${ZIP_BYTES} bytes (${ZIP_MB} MB), superando el máximo permitido de 12 MB (${MAX_BYTES} bytes)." >&2
  exit 1
fi

echo "------------------------------------------------------------------"
echo "Paquete generado correctamente: ${ZIP_NAME}"
echo "Carpeta raíz interna: ${FOLDER_NAME}/"
echo "Tamaño exacto: ${ZIP_BYTES} bytes (${ZIP_MB} MB / límite 12.00 MB)"
echo "------------------------------------------------------------------"
unzip -l "${ZIP_NAME}"
