/**
 * Biblioteca pessoal de objetos: medidas reais dos seus móveis, reutilizáveis entre projetos.
 * Fica no armazenamento do navegador e pode ser exportada/importada como JSON.
 */
import { LIBRARY_KEY, OBJECT_CATALOG } from './config.js';
import { Logger, ValidationError } from './logger.js';
import { validatePatch } from './schema.js';
import { createId } from './units.js';

/** @type {Logger} */
const logger = new Logger('library');

/** Campos guardados de cada item (posição e aparência ficam de fora). */
const LIBRARY_FIELDS = Object.freeze(['name', 'width', 'height', 'depth', 'y', 'color', 'isOpen', 'openDepth', 'usageFront', 'usageBack', 'usageSide']);

/** Tipos visuais aceitos. */
const KINDS = new Set([...OBJECT_CATALOG.map((item) => item.kind), 'custom']);

/**
 * @typedef {Record<string, any> & {id: string, kind: string, name: string}} LibraryItem
 */

/**
 * @typedef {{getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}} KeyValueStorage
 */

/**
 * Valida um item vindo do armazenamento ou de um arquivo.
 * @param {any} raw Item bruto.
 * @returns {LibraryItem|null} Item válido ou null.
 */
export function sanitizeLibraryItem(raw) {
    if (raw === null || typeof raw !== 'object') {
        return null;
    }
    /** @type {Record<string, unknown>} */
    const picked = {};
    for (const key of LIBRARY_FIELDS) {
        if (raw[key] !== undefined) {
            picked[key] = raw[key];
        }
    }
    try {
        /** @type {Record<string, any>} */
        const valid = validatePatch('object', picked);
        if (valid.name === undefined || valid.width === undefined || valid.height === undefined || valid.depth === undefined) {
            return null;
        }
        return { ...valid, id: typeof raw.id === 'string' && /^[\w-]{1,80}$/.test(raw.id) ? raw.id : createId('lib'), kind: KINDS.has(raw.kind) ? raw.kind : 'custom', name: valid.name };
    } catch (error) {
        if (error instanceof ValidationError) {
            return null;
        }
        throw error;
    }
}

export class LibraryStore {
    // #region Construtores :: constructor()

    /**
     * @param {KeyValueStorage|null} storage Armazenamento (localStorage no navegador).
     * @param {string} [key] Chave de gravação.
     */
    constructor(storage, key = LIBRARY_KEY) {
        /** @type {KeyValueStorage|null} */
        this.storage = storage;
        /** @type {string} */
        this.key = key;
        /** @type {LibraryItem[]} */
        this.items = this.load();
    }

    // #endregion

    // #region Operações :: load(), save(), add(), remove(), toJSON(), importJSON()

    /**
     * @returns {LibraryItem[]} Itens válidos salvos.
     */
    load() {
        if (this.storage === null) {
            return [];
        }
        try {
            /** @type {string|null} */
            const text = this.storage.getItem(this.key);
            /** @type {any} */
            const raw = text === null ? [] : JSON.parse(text);
            return Array.isArray(raw) ? raw.map(sanitizeLibraryItem).filter((item) => item !== null) : [];
        } catch (error) {
            if (error instanceof SyntaxError || error instanceof DOMException) {
                logger.warning('Biblioteca ilegível foi ignorada', { reason: error.name });
                return [];
            }
            throw error;
        }
    }

    /**
     * @returns {boolean} Verdadeiro se gravou.
     */
    save() {
        if (this.storage === null) {
            return false;
        }
        try {
            this.storage.setItem(this.key, JSON.stringify(this.items));
            return true;
        } catch (error) {
            if (error instanceof DOMException) {
                logger.warning('Biblioteca não pôde ser salva', { reason: error.name });
                return false;
            }
            throw error;
        }
    }

    /**
     * Guarda um objeto do projeto (somente medidas, tipo e preferências de uso).
     * @param {Record<string, any>} object Objeto.
     * @returns {LibraryItem} Item criado.
     * @throws {ValidationError} Quando o objeto não tem dados válidos.
     */
    add(object) {
        /** @type {LibraryItem|null} */
        const item = sanitizeLibraryItem({ ...object, id: createId('lib') });
        if (item === null) {
            throw new ValidationError('Este objeto não pode ser salvo na biblioteca.');
        }
        this.items.push(item);
        this.save();
        return item;
    }

    /**
     * @param {string} id Item.
     */
    remove(id) {
        this.items = this.items.filter((item) => item.id !== id);
        this.save();
    }

    /**
     * @returns {Record<string, unknown>} Biblioteca exportável.
     */
    toJSON() {
        return { app: 'simulador-3d-biblioteca', version: 1, items: this.items };
    }

    /**
     * Mescla itens de um arquivo exportado (itens com o mesmo id são substituídos).
     * @param {unknown} raw Conteúdo do arquivo.
     * @returns {number} Itens importados.
     * @throws {ValidationError} Quando o arquivo não é uma biblioteca.
     */
    importJSON(raw) {
        /** @type {any} */
        const data = raw;
        if (data === null || typeof data !== 'object' || !Array.isArray(data.items)) {
            throw new ValidationError('O arquivo não é uma biblioteca de objetos.');
        }
        /** @type {LibraryItem[]} */
        const incoming = data.items.map(sanitizeLibraryItem).filter((item) => item !== null);
        /** @type {Set<string>} */
        const ids = new Set(incoming.map((item) => item.id));
        this.items = [...this.items.filter((item) => !ids.has(item.id)), ...incoming];
        this.save();
        return incoming.length;
    }

    // #endregion
}
