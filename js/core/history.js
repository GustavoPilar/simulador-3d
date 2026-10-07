/**
 * Histórico de desfazer/refazer baseado em instantâneos JSON do estado.
 * Instantâneos são textos imutáveis, o que torna a restauração trivial e livre de efeitos colaterais.
 */
export class History {
    // #region Construtores :: constructor()

    /**
     * @param {number} limit Quantidade máxima de passos guardados.
     */
    constructor(limit) {
        /** @type {number} */
        this.limit = limit;
        /** @type {string[]} */
        this.past = [];
        /** @type {string[]} */
        this.future = [];
        /** @type {string|null} */
        this.current = null;
    }

    // #endregion

    // #region Operações :: reset(), record(), undo(), redo(), canUndo(), canRedo()

    /**
     * Reinicia o histórico a partir de um estado inicial.
     * @param {string} snapshot Instantâneo inicial.
     */
    reset(snapshot) {
        this.past = [];
        this.future = [];
        this.current = snapshot;
    }

    /**
     * Registra um novo estado. Instantâneos idênticos ao atual são ignorados.
     * @param {string} snapshot Instantâneo.
     * @returns {boolean} Verdadeiro se algo foi registrado.
     */
    record(snapshot) {
        if (snapshot === this.current) {
            return false;
        }
        if (this.current !== null) {
            this.past.push(this.current);
            if (this.past.length > this.limit) {
                this.past.shift();
            }
        }
        this.current = snapshot;
        this.future = [];
        return true;
    }

    /**
     * @returns {string|null} Instantâneo anterior ou null se não houver.
     */
    undo() {
        if (this.past.length === 0 || this.current === null) {
            return null;
        }
        this.future.push(this.current);
        this.current = /** @type {string} */ (this.past.pop());
        return this.current;
    }

    /**
     * @returns {string|null} Instantâneo seguinte ou null se não houver.
     */
    redo() {
        if (this.future.length === 0 || this.current === null) {
            return null;
        }
        this.past.push(this.current);
        this.current = /** @type {string} */ (this.future.pop());
        return this.current;
    }

    /** @returns {boolean} */
    canUndo() {
        return this.past.length > 0;
    }

    /** @returns {boolean} */
    canRedo() {
        return this.future.length > 0;
    }

    // #endregion
}
