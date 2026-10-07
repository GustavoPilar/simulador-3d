/**
 * Constantes da aplicação.
 *
 * Convenção de escala: 1 unidade do mundo 3D = 1 metro.
 * Eixos: X = largura do ambiente, Z = comprimento, Y = altura.
 * A origem (0, 0, 0) fica no canto interno do ambiente, sobre o piso.
 */

/** Versão do formato do arquivo JSON exportado. */
export const SCHEMA_VERSION = 3;

/** Chave usada para o salvamento automático no navegador. */
export const AUTOSAVE_KEY = 'sim3d.autosave.v1';

/** Limites do ambiente (em metros). */
export const ENVIRONMENT_LIMITS = Object.freeze({
    MIN_SIDE: 0.5,
    MAX_SIDE: 100,
    MIN_HEIGHT: 1.0,
    MAX_HEIGHT: 20,
    MIN_WALL_THICKNESS: 0.05,
    MAX_WALL_THICKNESS: 1.0
});

/** Limites genéricos para dimensões de elementos (em metros). */
export const DIMENSION_LIMITS = Object.freeze({
    MIN: 0.01,
    MAX: 50,
    MIN_POSITION: -200,
    MAX_POSITION: 200
});

/** Valores padrão do ambiente. */
export const DEFAULT_ENVIRONMENT = Object.freeze({
    width: 5,
    length: 8,
    height: 2.7,
    wallThickness: 0.15
});

/** Valores padrão do personagem (escala humana média). */
export const DEFAULT_PLAYER = Object.freeze({
    height: 1.75,
    width: 0.45,
    depth: 0.30,
    walkSpeed: 1.4,
    runSpeed: 3.0,
    fov: 70
});

/** Preferências de visualização padrão. */
export const DEFAULT_SETTINGS = Object.freeze({
    gridStep: 1,
    snapToGrid: true,
    showCeiling: true,
    showLabels: true,
    sectionCut: false,
    sectionHeight: 1.5,
    showUsageZones: false
});

/** Parâmetros físicos do controlador em primeira pessoa. */
export const PHYSICS = Object.freeze({
    GRAVITY: 9.81,
    // Velocidade inicial que gera um pulo de ~0,5 m, próximo de um pulo humano real
    JUMP_SPEED: 3.2,
    // Degrau máximo que o personagem sobe sem pular (soleiras, tapetes, rodapés)
    STEP_HEIGHT: 0.25,
    // Deslocamento máximo por sub-passo: menor que a parede mais fina para evitar atravessá-la
    MAX_SUBSTEP: 0.04,
    // Os olhos ficam a ~93% da altura total de uma pessoa
    EYE_HEIGHT_RATIO: 0.93,
    MOUSE_SENSITIVITY: 0.0022,
    MAX_PITCH_DEG: 85,
    INTERACTION_DISTANCE: 2.5
});

/** Valores padrão de paredes internas. */
export const DEFAULT_WALL = Object.freeze({
    length: 3,
    thickness: 0.12
});

/** Valores padrão de portas (porta interna comum no Brasil: 0,80 × 2,10 m). */
export const DEFAULT_DOOR = Object.freeze({
    width: 0.8,
    height: 2.1,
    thickness: 0.04
});

/** Valores padrão de janelas. */
export const DEFAULT_WINDOW = Object.freeze({
    width: 1.2,
    height: 1.0,
    sillHeight: 1.1
});

/** Folga mínima entre aberturas e as extremidades da parede. */
export const OPENING_MARGIN = 0.05;

/** Paleta das cores sugeridas para cômodos. */
export const ROOM_COLORS = Object.freeze(['#7fb3d5', '#a9cf8f', '#f0c674', '#d7a1c9', '#9fd8cf', '#f2a477']);

/**
 * Catálogo de objetos pré-configurados.
 * width = largura (X local), depth = profundidade/comprimento (Z local), height = altura (Y).
 * A frente do objeto aponta para +Z local.
 */
export const OBJECT_CATALOG = Object.freeze([
    { kind: 'bed', name: 'Cama de casal', width: 1.38, depth: 1.88, height: 0.5, y: 0, color: '#9c8466' },
    { kind: 'sofa', name: 'Sofá 3 lugares', width: 2.0, depth: 0.9, height: 0.85, y: 0, color: '#5f7187' },
    { kind: 'table', name: 'Mesa', width: 1.4, depth: 0.8, height: 0.75, y: 0, color: '#a0784f' },
    { kind: 'chair', name: 'Cadeira', width: 0.45, depth: 0.5, height: 0.9, y: 0, color: '#7d5f42' },
    { kind: 'wardrobe', name: 'Armário', width: 1.6, depth: 0.55, height: 2.1, y: 0, color: '#c9b796' },
    { kind: 'tv', name: 'Televisão 55"', width: 1.23, depth: 0.25, height: 0.78, y: 0.5, color: '#2b2f33' },
    { kind: 'fridge', name: 'Geladeira', width: 0.7, depth: 0.72, height: 1.85, y: 0, color: '#e4e7ea' },
    { kind: 'stove', name: 'Fogão', width: 0.52, depth: 0.6, height: 0.88, y: 0, color: '#d5d9dd' },
    { kind: 'sink', name: 'Pia', width: 1.2, depth: 0.55, height: 0.9, y: 0, color: '#eeeae2' },
    { kind: 'toilet', name: 'Vaso sanitário', width: 0.38, depth: 0.65, height: 0.78, y: 0, color: '#f4f4f4' },
    { kind: 'shower', name: 'Chuveiro (box)', width: 0.9, depth: 0.9, height: 2.0, y: 0, color: '#9cc7d9' },
    { kind: 'box', name: 'Caixa', width: 0.5, depth: 0.5, height: 0.5, y: 0, color: '#c49a62' },
    // Elementos técnicos: mount 'full' ocupa piso a teto; 'ceiling' fica encostado no teto
    { kind: 'column', name: 'Pilar / shaft', width: 0.3, depth: 0.3, height: 2.7, y: 0, color: '#9aa3ab', group: 'technical', mount: 'full' },
    { kind: 'soffit', name: 'Rebaixo de teto', width: 1.0, depth: 0.6, height: 0.25, y: 0, color: '#f4f2ed', group: 'technical', mount: 'ceiling' },
    { kind: 'light', name: 'Ponto de luz', width: 0.15, depth: 0.15, height: 0.04, y: 0, color: '#ffe7a3', group: 'technical', mount: 'ceiling' },
    { kind: 'outlet', name: 'Tomada', width: 0.1, depth: 0.03, height: 0.1, y: 0.3, color: '#ffffff', group: 'technical' },
    { kind: 'switch', name: 'Interruptor', width: 0.1, depth: 0.03, height: 0.1, y: 1.1, color: '#ffffff', group: 'technical' },
    { kind: 'water', name: 'Ponto de água', width: 0.08, depth: 0.04, height: 0.08, y: 0.6, color: '#4fa3d1', group: 'technical' }
]);

/** Pontos de instalação: são marcadores e não bloqueiam a passagem. */
export const NON_COLLIDING_KINDS = Object.freeze(new Set(['outlet', 'switch', 'light', 'water']));

/** Largura mínima recomendada para uma passagem (m). */
export const CIRCULATION_MIN = 0.6;

/**
 * Áreas de uso recomendadas por tipo de móvel (m): espaço livre necessário à frente, atrás
 * e em pelo menos uma das laterais. São valores usuais de ergonomia doméstica e podem ser editados por objeto.
 */
export const USAGE_DEFAULTS = Object.freeze({
    bed: { usageFront: 0, usageBack: 0, usageSide: 0.5 },
    sofa: { usageFront: 0.45, usageBack: 0, usageSide: 0 },
    chair: { usageFront: 0, usageBack: 0.6, usageSide: 0 },
    wardrobe: { usageFront: 0.6, usageBack: 0, usageSide: 0 },
    fridge: { usageFront: 0.8, usageBack: 0, usageSide: 0 },
    stove: { usageFront: 0.8, usageBack: 0, usageSide: 0 },
    sink: { usageFront: 0.8, usageBack: 0, usageSide: 0 },
    toilet: { usageFront: 0.6, usageBack: 0, usageSide: 0 },
    shower: { usageFront: 0.6, usageBack: 0, usageSide: 0 }
});

/** Móveis com partes móveis: alternam entre fechado e aberto (tecla E no modo explorar). */
export const STATEFUL_KINDS = Object.freeze(new Set(['sofa', 'wardrobe', 'fridge']));

/** Profundidade padrão de um sofá retrátil aberto (m). */
export const DEFAULT_SOFA_OPEN_DEPTH = 1.6;

/** Acabamentos de teto: cobrem paredes e pilares por natureza e ficam fora da verificação de sobreposição. */
export const OVERLAP_EXEMPT_KINDS = Object.freeze(new Set(['soffit']));

/** Pares de tipos que podem se sobrepor de propósito (cadeira embaixo da mesa). */
export const OVERLAP_ALLOWED = Object.freeze([['chair', 'table']]);

/** Chave da biblioteca pessoal de objetos no navegador. */
export const LIBRARY_KEY = 'sim3d.library.v1';

/** Quantidade máxima de arrumações por projeto. */
export const MAX_LAYOUTS = 20;

/** Distância de encaixe em paredes: em pixels na vista Planta e em metros na vista 3D. */
export const SNAP_PIXELS = 12;
export const SNAP_DISTANCE_3D = 0.12;

/** Passos guardados para desfazer. */
export const HISTORY_LIMIT = 100;

/** Maior dimensão (px) da imagem da planta de fundo; imagens maiores são reduzidas. */
export const UNDERLAY_MAX_PIXELS = 3200;

/** pdf.js (Apache-2.0), carregado sob demanda apenas ao importar uma planta em PDF. */
export const PDFJS_BASE_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

/** Cor padrão de objetos personalizados. */
export const CUSTOM_OBJECT_COLOR = '#b08d6a';
