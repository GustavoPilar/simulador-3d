/**
 * Persistência sem backend: exportação/importação de JSON e salvamento automático no navegador.
 */
import { AUTOSAVE_KEY } from './config.js';
import { Logger, ProjectFormatError } from './logger.js';
import { ProjectState } from './state.js';
import { slugify } from './units.js';

/** @type {Logger} */
const logger = new Logger('storage');

/**
 * Baixa o projeto como arquivo JSON, por exemplo "meu-studio.json".
 * @param {ProjectState} state Projeto.
 */
export function exportProject(state) {
    /** @type {string} */
    const json = JSON.stringify(state.toJSON(), null, 2);
    /** @type {Blob} */
    const blob = new Blob([json], { type: 'application/json' });
    /** @type {string} */
    const url = URL.createObjectURL(blob);
    /** @type {HTMLAnchorElement} */
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slugify(state.project.name)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revogar no próximo ciclo garante que o download já tenha começado
    setTimeout(() => URL.revokeObjectURL(url), 0);
    logger.info('Projeto exportado', { file: anchor.download, bytes: json.length });
}

/**
 * Lê e valida um arquivo de projeto escolhido pelo usuário.
 * @param {File} file Arquivo selecionado.
 * @returns {Promise<{state: ProjectState, warnings: string[]}>} Projeto reconstruído.
 * @throws {ProjectFormatError} Quando o arquivo não é um JSON de projeto válido.
 */
export async function readProjectFile(file) {
    if (file.size > 60 * 1024 * 1024) {
        throw new ProjectFormatError('O arquivo é grande demais para um projeto (máximo de 60 MB).');
    }
    /** @type {string} */
    const text = await file.text();
    /** @type {unknown} */
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new ProjectFormatError('O arquivo não é um JSON válido.');
        }
        throw error;
    }
    return ProjectState.fromJSON(raw);
}

/**
 * Salva o projeto no armazenamento local do navegador.
 * @param {ProjectState} state Projeto.
 * @returns {boolean} Verdadeiro se a planta de fundo também foi salva.
 */
export function saveAutosave(state) {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.toJSON()));
        return true;
    } catch (error) {
        if (!(error instanceof DOMException)) {
            throw error;
        }
    }
    // A imagem da planta costuma estourar a cota do navegador: salva o restante sem ela
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.toJSON({ includeUnderlay: false })));
        logger.warning('Salvamento automático sem a planta de fundo (cota do navegador)');
        return false;
    } catch (error) {
        if (error instanceof DOMException) {
            logger.warning('Salvamento automático indisponível', { reason: error.name });
            return false;
        }
        throw error;
    }
}

/**
 * Lê o último projeto salvo automaticamente.
 * @returns {{name: string, savedAt: string, raw: unknown}|null} Resumo do projeto salvo ou null.
 */
export function peekAutosave() {
    /** @type {string|null} */
    let text = null;
    try {
        text = localStorage.getItem(AUTOSAVE_KEY);
    } catch (error) {
        if (error instanceof DOMException) {
            return null;
        }
        throw error;
    }
    if (text === null) {
        return null;
    }
    try {
        /** @type {any} */
        const raw = JSON.parse(text);
        return { name: String(raw?.project?.name ?? 'Projeto'), savedAt: String(raw?.savedAt ?? ''), raw };
    } catch (error) {
        if (error instanceof SyntaxError) {
            logger.warning('Salvamento automático corrompido foi ignorado');
            return null;
        }
        throw error;
    }
}
