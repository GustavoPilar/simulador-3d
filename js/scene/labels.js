/**
 * Rótulos de texto (sprites) e linhas de cota exibidos no modo construção.
 */
import * as THREE from 'three';

/** Família tipográfica usada nos rótulos (com alternativas caso a fonte web não carregue). */
const LABEL_FONT = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

/**
 * @typedef {Object} LabelStyle
 * @property {number} [scale] Multiplicador do tamanho padrão na tela.
 * @property {string} [color] Cor do texto.
 * @property {string} [background] Cor de fundo.
 */

/** Altura padrão do rótulo como fração da altura da tela (independe da distância da câmera). */
const LABEL_SCREEN_HEIGHT = 0.032;

/**
 * Cria um rótulo sempre voltado para a câmera, desenhado por cima da geometria e com tamanho constante na tela.
 * @param {string} text Texto.
 * @param {LabelStyle} [style] Estilo.
 * @returns {THREE.Sprite} Sprite do rótulo.
 */
export function createTextSprite(text, style = {}) {
    /** @type {number} */
    const screenHeight = LABEL_SCREEN_HEIGHT * (style.scale ?? 1);
    /** @type {number} */
    const fontSize = 64;
    /** @type {number} */
    const padding = 18;
    /** @type {HTMLCanvasElement} */
    const canvas = document.createElement('canvas');
    /** @type {CanvasRenderingContext2D} */
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.font = `600 ${fontSize}px ${LABEL_FONT}`;
    /** @type {number} */
    const textWidth = Math.ceil(context.measureText(text).width);
    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 1.4;
    // Redimensionar o canvas reinicia o contexto, então a fonte precisa ser redefinida
    context.font = `600 ${fontSize}px ${LABEL_FONT}`;
    context.fillStyle = style.background ?? '#f5c518';
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, 10);
    context.fill();
    context.fillStyle = style.color ?? '#1b232b';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 3);

    /** @type {THREE.CanvasTexture} */
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    /** @type {THREE.SpriteMaterial} */
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false });
    material.userData.owned = true;
    /** @type {THREE.Sprite} */
    const sprite = new THREE.Sprite(material);
    sprite.scale.set((screenHeight * canvas.width) / canvas.height, screenHeight, 1);
    // Escala de referência: na vista Planta (ortográfica) o tamanho é recalculado a partir dela
    sprite.userData.baseScale = { x: sprite.scale.x, y: sprite.scale.y };
    sprite.renderOrder = 1000;
    return sprite;
}

/**
 * Cria uma linha de cota com marcações nas extremidades e o valor no centro.
 * @param {THREE.Vector3} start Início.
 * @param {THREE.Vector3} end Fim.
 * @param {THREE.Vector3} tickDirection Direção das marcações perpendiculares (unitária).
 * @param {string} text Texto da medida.
 * @param {THREE.LineBasicMaterial} material Material da linha.
 * @returns {THREE.Group} Grupo com linha, marcações e rótulo.
 */
export function createDimensionLine(start, end, tickDirection, text, material) {
    /** @type {THREE.Group} */
    const group = new THREE.Group();
    /** @type {THREE.Vector3} */
    const tick = tickDirection.clone().multiplyScalar(0.12);
    /** @type {THREE.Vector3[]} */
    const points = [
        start, end,
        start.clone().add(tick), start.clone().sub(tick),
        end.clone().add(tick), end.clone().sub(tick)
    ];
    /** @type {THREE.LineSegments} */
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material);
    lines.renderOrder = 999;
    group.add(lines);
    /** @type {THREE.Sprite} */
    const label = createTextSprite(text);
    label.position.copy(start).add(end).multiplyScalar(0.5);
    group.add(label);
    return group;
}
