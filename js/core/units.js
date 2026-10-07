/**
 * Utilitários de unidades e formatação.
 * Internamente todos os valores usam ponto decimal e metros; a vírgula aparece apenas na exibição.
 */

/**
 * Converte um texto digitado pelo usuário em número. Aceita vírgula ou ponto como separador decimal.
 * @param {string|number} raw Valor digitado.
 * @returns {number|null} Número válido ou null se o texto não representar um número finito.
 */
export function parseDecimal(raw) {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw !== 'string') {
        return null;
    }
    /** @type {string} */
    const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
    // Rejeita entradas parciais como "2.7m" ou "1.2.3", que Number() ou parseFloat() aceitariam de forma ambígua
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) {
        return null;
    }
    /** @type {number} */
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

/**
 * Formata um número com casas decimais fixas e vírgula como separador.
 * @param {number} value Valor numérico.
 * @param {number} [digits=2] Casas decimais.
 * @returns {string} Texto formatado, por exemplo "1,75".
 */
export function formatDecimal(value, digits = 2) {
    return Number(value).toFixed(digits).replace('.', ',');
}

/**
 * Formata um comprimento em metros para exibição, por exemplo "2,50 m".
 * @param {number} value Valor em metros.
 * @returns {string} Texto formatado.
 */
export function formatMeters(value) {
    return `${formatDecimal(value, 2)} m`;
}

/**
 * Formata uma área em metros quadrados, por exemplo "12,00 m²".
 * @param {number} value Área em m².
 * @returns {string} Texto formatado.
 */
export function formatArea(value) {
    return `${formatDecimal(value, 2)} m²`;
}

/**
 * Restringe um valor a um intervalo.
 * @param {number} value Valor.
 * @param {number} min Mínimo.
 * @param {number} max Máximo.
 * @returns {number} Valor restringido.
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Arredonda para o múltiplo mais próximo de um passo.
 * @param {number} value Valor.
 * @param {number} step Passo (> 0).
 * @returns {number} Valor arredondado.
 */
export function roundToStep(value, step) {
    if (step <= 0) {
        return value;
    }
    // O arredondamento final remove ruído de ponto flutuante (ex.: 0.30000000000000004)
    return Number((Math.round(value / step) * step).toFixed(6));
}

/**
 * Arredonda para milímetros, evitando acúmulo de ruído de ponto flutuante no estado.
 * @param {number} value Valor em metros.
 * @returns {number} Valor arredondado.
 */
export function roundMillimeters(value) {
    return Math.round(value * 1000) / 1000;
}

/**
 * @param {number} degrees Ângulo em graus.
 * @returns {number} Ângulo em radianos.
 */
export function degToRad(degrees) {
    return (degrees * Math.PI) / 180;
}

/**
 * @param {number} radians Ângulo em radianos.
 * @returns {number} Ângulo em graus.
 */
export function radToDeg(radians) {
    return (radians * 180) / Math.PI;
}

/**
 * Normaliza um ângulo para o intervalo [0, 360).
 * @param {number} degrees Ângulo em graus.
 * @returns {number} Ângulo normalizado.
 */
export function normalizeDegrees(degrees) {
    /** @type {number} */
    const normalized = ((degrees % 360) + 360) % 360;
    // Evita exibir 360,00° quando o resultado é numericamente 359,9999
    return Math.abs(normalized - 360) < 1e-6 ? 0 : Math.round(normalized * 100) / 100;
}

/**
 * Gera um identificador único curto.
 * @param {string} prefix Prefixo legível, por exemplo "wall".
 * @returns {string} Identificador.
 */
export function createId(prefix) {
    /** @type {string} */
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * Converte um nome livre em nome de arquivo seguro, por exemplo "Meu Studio" -> "meu-studio".
 * @param {string} name Nome do projeto.
 * @returns {string} Nome de arquivo sem extensão.
 */
export function slugify(name) {
    /** @type {string} */
    const slug = String(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug.length > 0 ? slug : 'projeto';
}
