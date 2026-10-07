/**
 * Componentes de interface do editor. Todo texto vindo do usuário ou de arquivos importados
 * é inserido via textContent para evitar injeção de HTML.
 */
import { FIELD_SCHEMAS, FIELD_UNITS } from '../core/schema.js';
import { formatDecimal, parseDecimal } from '../core/units.js';

/**
 * @typedef {import('../core/schema.js').FieldDefinition} FieldDefinition
 */

/**
 * @typedef {Object} PanelSection
 * @property {string} heading Título da seção.
 * @property {string} type Tipo do esquema (wall, door, environment...).
 * @property {Record<string, any>} data Valores atuais.
 * @property {boolean} [readOnly] Desabilita a edição.
 * @property {string[]} [readOnlyExcept] Campos que continuam editáveis quando readOnly.
 */

/**
 * @typedef {Object} PanelAction
 * @property {string} label Texto do botão.
 * @property {() => void} onClick Ação.
 * @property {'default'|'primary'|'danger'} [variant] Estilo.
 */

/**
 * @typedef {Object} PanelContent
 * @property {string} title Título (nome do elemento).
 * @property {string} kind Descrição do tipo.
 * @property {PanelSection[]} sections Seções de campos.
 * @property {string[]} [notes] Informações calculadas exibidas abaixo dos campos.
 * @property {PanelAction[]} [actions] Botões de ação.
 */

/**
 * Cria um elemento com classe e texto opcionais.
 * @param {string} tag Tag HTML.
 * @param {string} [className] Classes CSS.
 * @param {string} [text] Texto.
 * @returns {HTMLElement} Elemento criado.
 */
export function createElement(tag, className = '', text = '') {
    /** @type {HTMLElement} */
    const element = document.createElement(tag);
    if (className !== '') {
        element.className = className;
    }
    if (text !== '') {
        element.textContent = text;
    }
    return element;
}

/**
 * Formata um valor numérico para exibição no campo conforme o tipo.
 * @param {FieldDefinition} field Campo.
 * @param {number} value Valor.
 * @returns {string} Texto.
 */
function formatFieldValue(field, value) {
    if (field.type === 'fov' || field.type === 'percent') {
        return formatDecimal(value, 0);
    }
    if (field.type === 'angle') {
        return formatDecimal(value, 1);
    }
    return formatDecimal(value, 2);
}

export class PropertyPanel {
    // #region Construtores :: constructor()

    /**
     * @param {HTMLElement} container Elemento que recebe o painel.
     */
    constructor(container) {
        /** @type {HTMLElement} */
        this.container = container;
        /** @type {Map<string, {field: FieldDefinition, input: HTMLInputElement|HTMLSelectElement, error: HTMLElement}>} */
        this.inputs = new Map();
        /** @type {(type: string, key: string, value: string|boolean) => void} */
        this.onFieldChange = () => {};
        /** @type {Array<{value: string, label: string}>} */
        this.wallOptions = [];
    }

    // #endregion

    // #region Renderização :: render(), renderField(), refresh(), showError()

    /**
     * Desenha o painel completo.
     * @param {PanelContent} content Conteúdo.
     */
    render(content) {
        this.container.replaceChildren();
        this.inputs.clear();

        /** @type {HTMLElement} */
        const header = createElement('header', 'panel-header');
        header.append(createElement('p', 'panel-kind', content.kind), createElement('h2', 'panel-title', content.title));
        this.container.append(header);

        for (const section of content.sections) {
            /** @type {HTMLElement} */
            const fieldset = createElement('section', 'panel-section');
            if (section.heading !== '') {
                fieldset.append(createElement('h3', 'panel-heading', section.heading));
            }
            for (const field of FIELD_SCHEMAS[section.type]) {
                if (field.when !== undefined && !field.when(section.data)) {
                    continue;
                }
                fieldset.append(this.renderField(section, field));
            }
            this.container.append(fieldset);
        }

        if (content.notes !== undefined && content.notes.length > 0) {
            /** @type {HTMLElement} */
            const notes = createElement('ul', 'panel-notes');
            for (const note of content.notes) {
                notes.append(createElement('li', '', note));
            }
            this.container.append(notes);
        }

        if (content.actions !== undefined && content.actions.length > 0) {
            /** @type {HTMLElement} */
            const actions = createElement('div', 'panel-actions');
            for (const action of content.actions) {
                /** @type {HTMLButtonElement} */
                const button = /** @type {HTMLButtonElement} */ (createElement('button', `button button-${action.variant ?? 'default'}`, action.label));
                button.type = 'button';
                button.addEventListener('click', action.onClick);
                actions.append(button);
            }
            this.container.append(actions);
        }
    }

    /**
     * @param {PanelSection} section Seção.
     * @param {FieldDefinition} field Campo.
     * @returns {HTMLElement} Linha do formulário.
     */
    renderField(section, field) {
        /** @type {string} */
        const inputId = `field-${section.type}-${field.key}`;
        /** @type {HTMLElement} */
        const row = createElement('div', `field field-${field.type}`);
        /** @type {HTMLLabelElement} */
        const label = /** @type {HTMLLabelElement} */ (createElement('label', 'field-label', field.label));
        label.htmlFor = inputId;

        /** @type {HTMLInputElement|HTMLSelectElement} */
        let input;
        if (field.type === 'select' || field.type === 'wallRef') {
            /** @type {HTMLSelectElement} */
            const select = document.createElement('select');
            /** @type {Array<{value: string, label: string}>} */
            const options = field.type === 'wallRef'
                ? this.wallOptions
                : (field.options ?? []).map((option) => ({ value: String(option.value), label: option.label }));
            for (const option of options) {
                /** @type {HTMLOptionElement} */
                const element = document.createElement('option');
                element.value = option.value;
                element.textContent = option.label;
                select.append(element);
            }
            input = select;
        } else {
            /** @type {HTMLInputElement} */
            const text = document.createElement('input');
            if (field.type === 'checkbox') {
                text.type = 'checkbox';
            } else if (field.type === 'color') {
                text.type = 'color';
            } else {
                text.type = 'text';
                text.autocomplete = 'off';
                text.spellcheck = false;
                if (field.type !== 'text') {
                    text.inputMode = 'decimal';
                }
            }
            input = text;
        }
        input.id = inputId;
        input.disabled = section.readOnly === true && !(section.readOnlyExcept ?? []).includes(field.key);

        /** @type {HTMLElement} */
        const control = createElement('div', 'field-control');
        control.append(input);
        /** @type {string|undefined} */
        const unit = /** @type {Record<string, string>} */ (FIELD_UNITS)[field.type];
        if (unit !== undefined) {
            control.append(createElement('span', 'field-unit', unit));
        }
        /** @type {HTMLElement} */
        const error = createElement('p', 'field-error');
        error.setAttribute('role', 'alert');

        input.addEventListener('change', () => {
            error.textContent = '';
            /** @type {string|boolean} */
            const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
            this.onFieldChange(section.type, field.key, value);
        });
        if (input instanceof HTMLInputElement && input.type === 'text') {
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    input.blur();
                }
            });
        }

        row.append(label, control, error);
        this.inputs.set(`${section.type}.${field.key}`, { field, input, error });
        this.setInputValue(field, input, section.data[field.key]);
        return row;
    }

    /**
     * Atualiza os valores exibidos sem recriar o painel (usado durante o arrasto do gizmo).
     * O campo em foco é preservado para não sobrescrever o que o usuário está digitando.
     * @param {string} type Tipo da seção.
     * @param {Record<string, any>} data Valores.
     */
    refresh(type, data) {
        for (const [key, entry] of this.inputs) {
            if (!key.startsWith(`${type}.`) || document.activeElement === entry.input) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(data, entry.field.key)) {
                this.setInputValue(entry.field, entry.input, data[entry.field.key]);
            }
        }
    }

    /**
     * Exibe um erro de validação abaixo do campo.
     * @param {string} type Tipo da seção.
     * @param {string} key Campo.
     * @param {string} message Mensagem.
     */
    showError(type, key, message) {
        /** @type {{error: HTMLElement}|undefined} */
        const entry = this.inputs.get(`${type}.${key}`);
        if (entry !== undefined) {
            entry.error.textContent = message;
        }
    }

    /**
     * @param {FieldDefinition} field Campo.
     * @param {HTMLInputElement|HTMLSelectElement} input Controle.
     * @param {unknown} value Valor.
     */
    setInputValue(field, input, value) {
        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            input.checked = value === true;
        } else if (typeof value === 'number' && field.type !== 'select') {
            input.value = formatFieldValue(field, value);
        } else {
            input.value = value === undefined || value === null ? '' : String(value);
        }
    }

    // #endregion
}

export class Outliner {
    // #region Construtores :: constructor()

    /**
     * @param {HTMLElement} container Elemento da lista.
     */
    constructor(container) {
        /** @type {HTMLElement} */
        this.container = container;
        /** @type {(ref: {type: string, id: string}) => void} */
        this.onPick = () => {};
    }

    // #endregion

    // #region Renderização :: render()

    /**
     * @param {Array<{label: string, type: string, items: Array<{id: string, name: string}>}>} groups Grupos de elementos.
     * @param {{type: string, id: string}|null} selected Seleção atual.
     */
    render(groups, selected) {
        this.container.replaceChildren();
        for (const group of groups) {
            if (group.items.length === 0) {
                continue;
            }
            /** @type {HTMLElement} */
            const block = createElement('div', 'outliner-group');
            block.append(createElement('p', 'outliner-label', `${group.label} (${group.items.length})`));
            /** @type {HTMLElement} */
            const list = createElement('ul', 'outliner-list');
            for (const item of group.items) {
                /** @type {HTMLElement} */
                const entry = createElement('li');
                /** @type {HTMLButtonElement} */
                const button = /** @type {HTMLButtonElement} */ (createElement('button', 'outliner-item', item.name));
                button.type = 'button';
                if (selected !== null && selected.type === group.type && selected.id === item.id) {
                    button.classList.add('is-selected');
                    button.setAttribute('aria-current', 'true');
                }
                button.addEventListener('click', () => this.onPick({ type: group.type, id: item.id }));
                entry.append(button);
                list.append(entry);
            }
            block.append(list);
            this.container.append(block);
        }
    }

    // #endregion
}

export class Toast {
    // #region Construtores :: constructor()

    /**
     * @param {HTMLElement} element Elemento do aviso.
     */
    constructor(element) {
        /** @type {HTMLElement} */
        this.element = element;
        /** @type {number} */
        this.timer = 0;
    }

    // #endregion

    // #region Exibição :: show()

    /**
     * @param {string} message Mensagem.
     * @param {'info'|'error'} [kind='info'] Tipo.
     */
    show(message, kind = 'info') {
        this.element.textContent = message;
        this.element.dataset.kind = kind;
        this.element.classList.add('is-visible');
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.element.classList.remove('is-visible'), kind === 'error' ? 5000 : 2600);
    }

    // #endregion
}

export class NumberDialog {
    // #region Construtores :: constructor()

    /**
     * @param {HTMLDialogElement} dialog Elemento <dialog> com título, mensagem, campo e botões.
     */
    constructor(dialog) {
        /** @type {HTMLDialogElement} */
        this.dialog = dialog;
        /** @type {HTMLFormElement} */
        this.form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
        /** @type {HTMLInputElement} */
        this.input = /** @type {HTMLInputElement} */ (dialog.querySelector('input'));
        /** @type {HTMLElement} */
        this.title = /** @type {HTMLElement} */ (dialog.querySelector('[data-role="title"]'));
        /** @type {HTMLElement} */
        this.message = /** @type {HTMLElement} */ (dialog.querySelector('[data-role="message"]'));
        /** @type {HTMLElement} */
        this.unit = /** @type {HTMLElement} */ (dialog.querySelector('[data-role="unit"]'));
        /** @type {HTMLElement} */
        this.error = /** @type {HTMLElement} */ (dialog.querySelector('[data-role="error"]'));
        /** @type {{min: number, max: number}} */
        this.limits = { min: -Infinity, max: Infinity };
        /** @type {number|string|null} */
        this.value = null;
        /** @type {boolean} Modo texto (nomes) em vez de número. */
        this.textMode = false;
        /** @type {((value: any) => void)|null} */
        this.resolve = null;

        this.form.addEventListener('submit', (event) => {
            /** @type {HTMLButtonElement|null} */
            const submitter = /** @type {any} */ (event).submitter ?? null;
            if (submitter?.value !== 'ok') {
                this.value = null;
                return;
            }
            if (this.textMode) {
                /** @type {string} */
                const text = this.input.value.trim();
                if (text.length === 0 || text.length > 80) {
                    event.preventDefault();
                    this.error.textContent = 'Use entre 1 e 80 caracteres.';
                    return;
                }
                this.value = text;
                return;
            }
            /** @type {number|null} */
            const value = parseDecimal(this.input.value);
            if (value === null || value < this.limits.min || value > this.limits.max) {
                event.preventDefault();
                this.error.textContent = `Informe um número entre ${formatDecimal(this.limits.min, 0)} e ${formatDecimal(this.limits.max, 0)}.`;
                return;
            }
            this.value = value;
        });
        this.dialog.addEventListener('close', () => {
            /** @type {((value: number|null) => void)|null} */
            const resolve = this.resolve;
            this.resolve = null;
            resolve?.(this.dialog.returnValue === 'ok' ? this.value : null);
        });
    }

    // #endregion

    // #region Uso :: ask()

    /**
     * Abre o diálogo e aguarda um número.
     * @param {{title: string, message: string, value: string, unit: string, min?: number, max?: number, confirm?: string}} options Textos e limites.
     * @returns {Promise<number|null>} Número digitado ou null se cancelado.
     */
    ask(options) {
        this.textMode = false;
        this.input.inputMode = 'decimal';
        return this.open(options);
    }

    /**
     * Abre o diálogo pedindo um texto (por exemplo, o nome de uma arrumação).
     * @param {{title: string, message: string, value: string, confirm?: string}} options Textos.
     * @returns {Promise<string|null>} Texto digitado ou null se cancelado.
     */
    askText(options) {
        this.textMode = true;
        this.input.inputMode = 'text';
        return this.open({ ...options, unit: '' });
    }

    /**
     * @param {{title: string, message: string, value: string, unit: string, min?: number, max?: number, confirm?: string}} options Textos e limites.
     * @returns {Promise<any>} Valor confirmado ou null.
     */
    open(options) {
        this.title.textContent = options.title;
        this.message.textContent = options.message;
        this.unit.textContent = options.unit;
        this.error.textContent = '';
        this.input.value = options.value;
        this.limits = { min: options.min ?? 0.001, max: options.max ?? 1000 };
        this.value = null;
        this.dialog.returnValue = '';
        /** @type {HTMLButtonElement|null} */
        const confirm = this.form.querySelector('button[value="ok"]');
        if (confirm !== null) {
            confirm.textContent = options.confirm ?? 'Aplicar';
        }
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.dialog.showModal();
            this.input.select();
        });
    }

    // #endregion
}
