#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de empaquetado para la entrega final UOC — DrumLab VR
# Genera Práctica_Fuentes_Alejandro.zip desde la raíz del proyecto incluyendo
# únicamente index.html y recursos/, verificando la estructura y el límite <12MB.
# ==============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly ZIP_NAME="Práctica_Fuentes_Alejandro.zip"
readonly MAX_BYTES=12582912 # 12 MB (12 * 1024 * 1024 bytes)

cd "${REPO_ROOT}"

# 1. Validar que existen los elementos obligatorios en la raíz
if [[ ! -f "index.html" || ! -d "recursos" ]]; then
  echo "ERROR: Deben existir 'index.html' y 'recursos/' en la raíz: ${REPO_ROOT}" >&2
  exit 1
fi

# 2. Eliminar cualquier paquete previo
if [[ -f "${ZIP_NAME}" ]]; then
  rm -f "${ZIP_NAME}"
fi

# 3. Empaquetar únicamente index.html y recursos/ excluyendo temporales del SO
echo "Empaquetando '${ZIP_NAME}' desde '${REPO_ROOT}'..."
zip -r -9 -q "${ZIP_NAME}" index.html recursos \
  -x "*.DS_Store" \
  -x "*__MACOSX*" \
  -x "*.swp" \
  -x "*.swo" \
  -x "*~" \
  -x "recursos/.git*"

# 4. Verificar mediante unzip -l que index.html está en la raíz y existe recursos/
readonly ZIP_LISTING="$(unzip -l "${ZIP_NAME}")"

if ! echo "${ZIP_LISTING}" | grep -qE '[[:space:]]index\.html$'; then
  echo "ERROR: 'index.html' no se encuentra directamente en la raíz de '${ZIP_NAME}'." >&2
  exit 1
fi

if ! echo "${ZIP_LISTING}" | grep -qE '[[:space:]]recursos/'; then
  echo "ERROR: No se encuentra la carpeta 'recursos/' dentro de '${ZIP_NAME}'." >&2
  exit 1
fi

# 5. Calcular el tamaño real en bytes y comprobar el límite estricto de 12 MB
readonly ZIP_BYTES="$(wc -c < "${ZIP_NAME}" | tr -d '[:space:]')"
readonly ZIP_MB="$(awk "BEGIN { printf \"%.2f\", ${ZIP_BYTES} / 1048576 }")"

if (( ZIP_BYTES > MAX_BYTES )); then
  echo "ERROR: '${ZIP_NAME}' pesa ${ZIP_BYTES} bytes (${ZIP_MB} MB), superando el máximo permitido de 12 MB (${MAX_BYTES} bytes)." >&2
  exit 1
fi

echo "------------------------------------------------------------------"
echo "Paquete generado correctamente: ${ZIP_NAME}"
echo "Tamaño exacto: ${ZIP_BYTES} bytes (${ZIP_MB} MB / límite 12.00 MB)"
echo "------------------------------------------------------------------"
unzip -l "${ZIP_NAME}"
