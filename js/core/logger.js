/**
 * Logger estruturado simples. Cada registro inclui nível, contexto e dados adicionais,
 * o que facilita filtrar o console do navegador por módulo.
 */
export class Logger {
    /**
     * @param {string} context Nome do módulo que gera os registros.
     */
    constructor(context) {
        /** @type {string} */
        this.context = context;
    }

    /**
     * @param {string} message Mensagem.
     * @param {Record<string, unknown>} [data] Dados de contexto.
     */
    info(message, data = {}) {
        console.info(this.format('INFO', message), data);
    }

    /**
     * @param {string} message Mensagem.
     * @param {Record<string, unknown>} [data] Dados de contexto.
     */
    warning(message, data = {}) {
        console.warn(this.format('WARNING', message), data);
    }

    /**
     * @param {string} message Mensagem.
     * @param {Record<string, unknown>} [data] Dados de contexto.
     */
    error(message, data = {}) {
        console.error(this.format('ERROR', message), data);
    }

    /**
     * @param {string} message Mensagem.
     * @param {Record<string, unknown>} [data] Dados de contexto.
     */
    critical(message, data = {}) {
        console.error(this.format('CRITICAL', message), data);
    }

    /**
     * @param {string} level Nível do registro.
     * @param {string} message Mensagem.
     * @returns {string} Linha formatada.
     */
    format(level, message) {
        return `[${new Date().toISOString()}] [${level}] [${this.context}] ${message}`;
    }
}

/**
 * Erro de validação de dados informados pelo usuário ou lidos de um arquivo.
 * A mensagem é sempre legível pelo usuário final.
 */
export class ValidationError extends Error {
    /**
     * @param {string} message Mensagem para o usuário.
     * @param {string} [field] Campo relacionado ao erro.
     */
    constructor(message, field = '') {
        super(message);
        /** @type {string} */
        this.name = 'ValidationError';
        /** @type {string} */
        this.field = field;
    }
}

/**
 * Erro de formato ao importar um arquivo de projeto.
 */
export class ProjectFormatError extends Error {
    /**
     * @param {string} message Mensagem para o usuário.
     */
    constructor(message) {
        super(message);
        /** @type {string} */
        this.name = 'ProjectFormatError';
    }
}
