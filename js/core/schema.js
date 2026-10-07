/**
 * Esquemas de campos de cada tipo de entidade.
 * São usados tanto para validar dados (estado e importação) quanto para gerar os formulários do painel,
 * garantindo uma única fonte de verdade para rótulos, unidades e limites.
 */
import { DIMENSION_LIMITS, ENVIRONMENT_LIMITS, STATEFUL_KINDS } from './config.js';
import { ValidationError } from './logger.js';
import { normalizeDegrees, parseDecimal, roundMillimeters } from './units.js';

/**
 * @typedef {Object} FieldOption
 * @property {string|number|boolean} value Valor armazenado.
 * @property {string} label Texto exibido.
 */

/**
 * @typedef {Object} FieldDefinition
 * @property {string} key Nome da propriedade no estado.
 * @property {string} label Rótulo exibido.
 * @property {'text'|'length'|'position'|'angle'|'speed'|'fov'|'percent'|'select'|'checkbox'|'color'|'wallRef'} type Tipo do campo.
 * @property {number} [min] Valor mínimo (numéricos).
 * @property {number} [max] Valor máximo (numéricos).
 * @property {FieldOption[]} [options] Opções (select).
 * @property {(data: Record<string, any>) => boolean} [when] Exibe o campo só quando a condição é verdadeira.
 */

/** @type {FieldDefinition[]} Aparência no modo construção (não afeta o modo explorar). */
const APPEARANCE_FIELDS = [
    { key: 'opacity', label: 'Opacidade ao construir', type: 'percent', min: 5, max: 100 },
    { key: 'hidden', label: 'Ocultar ao construir', type: 'checkbox' }
];

/** Unidade exibida ao lado de cada tipo numérico. */
export const FIELD_UNITS = Object.freeze({
    length: 'm',
    position: 'm',
    angle: '°',
    speed: 'm/s',
    fov: '°',
    percent: '%'
});

/** Tipos de campo numéricos. */
const NUMERIC_TYPES = new Set(['length', 'position', 'angle', 'speed', 'fov', 'percent']);

/** @type {FieldDefinition} */
const NAME_FIELD = { key: 'name', label: 'Nome', type: 'text' };

/**
 * @param {string} key Propriedade.
 * @param {string} label Rótulo.
 * @param {number} [min] Mínimo.
 * @param {number} [max] Máximo.
 * @returns {FieldDefinition} Campo de comprimento em metros.
 */
function lengthField(key, label, min = DIMENSION_LIMITS.MIN, max = DIMENSION_LIMITS.MAX) {
    return { key, label, type: 'length', min, max };
}

/**
 * @param {string} key Propriedade.
 * @param {string} label Rótulo.
 * @returns {FieldDefinition} Campo de posição em metros (aceita negativos).
 */
function positionField(key, label) {
    return { key, label, type: 'position', min: DIMENSION_LIMITS.MIN_POSITION, max: DIMENSION_LIMITS.MAX_POSITION };
}

/** @type {FieldDefinition} */
const ROTATION_FIELD = { key: 'rotation', label: 'Rotação', type: 'angle', min: -3600, max: 3600 };

/** @type {FieldDefinition} */
const ELEVATION_FIELD = { key: 'y', label: 'Y (elevação)', type: 'position', min: 0, max: ENVIRONMENT_LIMITS.MAX_HEIGHT };

/** @type {Readonly<Record<string, FieldDefinition[]>>} */
export const FIELD_SCHEMAS = Object.freeze({
    environment: [
        { key: 'name', label: 'Nome do projeto', type: 'text' },
        lengthField('width', 'Largura (X)', ENVIRONMENT_LIMITS.MIN_SIDE, ENVIRONMENT_LIMITS.MAX_SIDE),
        lengthField('length', 'Comprimento (Z)', ENVIRONMENT_LIMITS.MIN_SIDE, ENVIRONMENT_LIMITS.MAX_SIDE),
        lengthField('height', 'Pé-direito', ENVIRONMENT_LIMITS.MIN_HEIGHT, ENVIRONMENT_LIMITS.MAX_HEIGHT),
        lengthField('wallThickness', 'Espessura das paredes externas', ENVIRONMENT_LIMITS.MIN_WALL_THICKNESS, ENVIRONMENT_LIMITS.MAX_WALL_THICKNESS)
    ],
    settings: [
        {
            key: 'gridStep',
            label: 'Grade',
            type: 'select',
            options: [
                { value: 1, label: '1 m' },
                { value: 0.5, label: '0,5 m' },
                { value: 0.1, label: '0,1 m' }
            ]
        },
        { key: 'snapToGrid', label: 'Encaixar na grade', type: 'checkbox' },
        { key: 'showCeiling', label: 'Teto no modo explorar', type: 'checkbox' },
        { key: 'showLabels', label: 'Mostrar cotas e nomes', type: 'checkbox' },
        { key: 'showUsageZones', label: 'Mostrar áreas de uso', type: 'checkbox' },
        { key: 'sectionCut', label: 'Corte horizontal ao construir', type: 'checkbox' },
        lengthField('sectionHeight', 'Altura do corte', 0.1, ENVIRONMENT_LIMITS.MAX_HEIGHT)
    ],
    player: [
        lengthField('height', 'Altura', 0.5, 2.6),
        lengthField('width', 'Largura (ombros)', 0.2, 1.2),
        lengthField('depth', 'Profundidade', 0.1, 1.0),
        { key: 'walkSpeed', label: 'Caminhada', type: 'speed', min: 0.2, max: 6 },
        { key: 'runSpeed', label: 'Corrida', type: 'speed', min: 0.5, max: 12 },
        { key: 'fov', label: 'Campo de visão', type: 'fov', min: 40, max: 110 },
        positionField('spawnX', 'Início X'),
        positionField('spawnZ', 'Início Z'),
        { key: 'spawnRotation', label: 'Direção inicial', type: 'angle', min: -3600, max: 3600 }
    ],
    wall: [
        NAME_FIELD,
        lengthField('length', 'Comprimento', 0.05, DIMENSION_LIMITS.MAX),
        lengthField('height', 'Altura', 0.05, ENVIRONMENT_LIMITS.MAX_HEIGHT),
        lengthField('thickness', 'Espessura', 0.02, 1.0),
        positionField('x', 'X (centro)'),
        { ...ELEVATION_FIELD },
        positionField('z', 'Z (centro)'),
        ROTATION_FIELD,
        ...APPEARANCE_FIELDS
    ],
    door: [
        NAME_FIELD,
        { key: 'wallId', label: 'Parede', type: 'wallRef' },
        lengthField('offset', 'Posição na parede', 0, DIMENSION_LIMITS.MAX),
        lengthField('gapStart', 'Folga até o início', 0, DIMENSION_LIMITS.MAX),
        lengthField('gapEnd', 'Folga até o fim', 0, DIMENSION_LIMITS.MAX),
        lengthField('width', 'Largura', 0.3, 5),
        lengthField('height', 'Altura', 0.5, ENVIRONMENT_LIMITS.MAX_HEIGHT),
        lengthField('thickness', 'Espessura', 0.01, 0.2),
        {
            key: 'isOpen',
            label: 'Estado',
            type: 'select',
            options: [
                { value: false, label: 'Fechada' },
                { value: true, label: 'Aberta' }
            ]
        },
        {
            key: 'hinge',
            label: 'Dobradiça',
            type: 'select',
            options: [
                { value: 'left', label: 'Esquerda' },
                { value: 'right', label: 'Direita' }
            ]
        },
        {
            key: 'swing',
            label: 'Abre para',
            type: 'select',
            options: [
                { value: 1, label: 'Frente da parede' },
                { value: -1, label: 'Verso da parede' }
            ]
        }
    ],
    window: [
        NAME_FIELD,
        { key: 'wallId', label: 'Parede', type: 'wallRef' },
        lengthField('offset', 'Posição na parede', 0, DIMENSION_LIMITS.MAX),
        lengthField('gapStart', 'Folga até o início', 0, DIMENSION_LIMITS.MAX),
        lengthField('gapEnd', 'Folga até o fim', 0, DIMENSION_LIMITS.MAX),
        lengthField('width', 'Largura', 0.2, 10),
        lengthField('height', 'Altura', 0.2, ENVIRONMENT_LIMITS.MAX_HEIGHT),
        lengthField('sillHeight', 'Altura do peitoril', 0, ENVIRONMENT_LIMITS.MAX_HEIGHT)
    ],
    object: [
        NAME_FIELD,
        lengthField('width', 'Largura'),
        lengthField('height', 'Altura'),
        lengthField('depth', 'Profundidade'),
        positionField('x', 'X (centro)'),
        { ...ELEVATION_FIELD },
        positionField('z', 'Z (centro)'),
        ROTATION_FIELD,
        { key: 'color', label: 'Cor', type: 'color' },
        {
            key: 'isOpen',
            label: 'Estado',
            type: 'select',
            options: [
                { value: false, label: 'Fechado' },
                { value: true, label: 'Aberto' }
            ],
            when: (data) => STATEFUL_KINDS.has(data.kind)
        },
        { ...lengthField('openDepth', 'Profundidade aberto', DIMENSION_LIMITS.MIN, 5), when: (data) => data.kind === 'sofa' },
        lengthField('usageFront', 'Área de uso à frente', 0, 5),
        lengthField('usageBack', 'Área de uso atrás', 0, 5),
        lengthField('usageSide', 'Área de uso lateral', 0, 5),
        ...APPEARANCE_FIELDS
    ],
    underlay: [
        positionField('x', 'Centro X'),
        positionField('z', 'Centro Z'),
        lengthField('width', 'Largura da imagem', 0.1, 500),
        { key: 'rotation', label: 'Rotação', type: 'angle', min: -3600, max: 3600 },
        { key: 'opacity', label: 'Opacidade', type: 'percent', min: 5, max: 100 },
        { key: 'visible', label: 'Mostrar planta', type: 'checkbox' }
    ],
    room: [
        NAME_FIELD,
        lengthField('width', 'Largura (X)', 0.3, DIMENSION_LIMITS.MAX),
        lengthField('length', 'Comprimento (Z)', 0.3, DIMENSION_LIMITS.MAX),
        positionField('x', 'X (centro)'),
        positionField('z', 'Z (centro)'),
        { key: 'color', label: 'Cor', type: 'color' }
    ]
});

/**
 * Valida e converte o valor bruto de um campo.
 * @param {FieldDefinition} field Definição do campo.
 * @param {unknown} raw Valor bruto (texto do formulário ou valor do JSON).
 * @returns {string|number|boolean} Valor convertido.
 * @throws {ValidationError} Quando o valor é inválido.
 */
export function validateField(field, raw) {
    if (NUMERIC_TYPES.has(field.type)) {
        return validateNumber(field, raw);
    }
    switch (field.type) {
        case 'text':
        case 'wallRef':
            return validateText(field, raw);
        case 'checkbox':
            if (typeof raw !== 'boolean') {
                throw new ValidationError(`${field.label}: valor inválido.`, field.key);
            }
            return raw;
        case 'color':
            if (typeof raw !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw)) {
                throw new ValidationError(`${field.label}: use uma cor no formato #RRGGBB.`, field.key);
            }
            return raw.toLowerCase();
        case 'select':
            return validateOption(field, raw);
        default:
            throw new ValidationError(`Campo desconhecido: ${field.key}.`, field.key);
    }
}

/**
 * @param {FieldDefinition} field Campo numérico.
 * @param {unknown} raw Valor bruto.
 * @returns {number} Número validado.
 * @throws {ValidationError} Quando não é número ou está fora dos limites.
 */
function validateNumber(field, raw) {
    /** @type {number|null} */
    const value = parseDecimal(/** @type {string|number} */ (raw));
    if (value === null) {
        throw new ValidationError(`${field.label}: informe um número válido.`, field.key);
    }
    /** @type {number} */
    const min = field.min ?? -Infinity;
    /** @type {number} */
    const max = field.max ?? Infinity;
    if (value < min || value > max) {
        throw new ValidationError(`${field.label}: use um valor entre ${String(min).replace('.', ',')} e ${String(max).replace('.', ',')}.`, field.key);
    }
    if (field.type === 'angle') {
        return normalizeDegrees(value);
    }
    return roundMillimeters(value);
}

/**
 * @param {FieldDefinition} field Campo textual.
 * @param {unknown} raw Valor bruto.
 * @returns {string} Texto validado.
 * @throws {ValidationError} Quando vazio ou longo demais.
 */
function validateText(field, raw) {
    if (typeof raw !== 'string') {
        throw new ValidationError(`${field.label}: valor inválido.`, field.key);
    }
    /** @type {string} */
    const text = raw.trim();
    if (text.length === 0 || text.length > 80) {
        throw new ValidationError(`${field.label}: use entre 1 e 80 caracteres.`, field.key);
    }
    return text;
}

/**
 * @param {FieldDefinition} field Campo de seleção.
 * @param {unknown} raw Valor bruto (pode vir como texto do <select>).
 * @returns {string|number|boolean} Valor tipado da opção correspondente.
 * @throws {ValidationError} Quando não corresponde a nenhuma opção.
 */
function validateOption(field, raw) {
    /** @type {FieldOption|undefined} */
    const match = (field.options ?? []).find((option) => String(option.value) === String(raw));
    if (match === undefined) {
        throw new ValidationError(`${field.label}: opção inválida.`, field.key);
    }
    return match.value;
}

/**
 * Valida um conjunto de alterações para um tipo de entidade.
 * Campos ausentes no esquema são ignorados para impedir a injeção de propriedades arbitrárias.
 * @param {string} type Tipo da entidade.
 * @param {Record<string, unknown>} patch Alterações brutas.
 * @returns {Record<string, string|number|boolean>} Alterações validadas.
 * @throws {ValidationError} No primeiro campo inválido.
 */
export function validatePatch(type, patch) {
    /** @type {FieldDefinition[]|undefined} */
    const fields = FIELD_SCHEMAS[type];
    if (fields === undefined) {
        throw new ValidationError(`Tipo desconhecido: ${type}.`);
    }
    /** @type {Record<string, string|number|boolean>} */
    const result = {};
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(patch, field.key)) {
            result[field.key] = validateField(field, patch[field.key]);
        }
    }
    return result;
}
