/**
 * Ponto de entrada: conecta estado, cena 3D, controles e interface.
 */
import { HISTORY_LIMIT, NON_COLLIDING_KINDS, OBJECT_CATALOG, PHYSICS, STATEFUL_KINDS } from './core/config.js';
import { CollisionWorld } from './core/collision.js';
import { analyzeLayout, effectiveFootprint, isSolid, measureClearances, objectObstacle, obstaclesFor, rotateLocal, usageZones, wallSnapGeometry } from './core/geometry.js';
import { History } from './core/history.js';
import { LibraryStore } from './core/library.js';
import { Logger, ProjectFormatError, ValidationError } from './core/logger.js';
import { PERIMETER_IDS, ProjectState } from './core/state.js';
import { exportProject, peekAutosave, readProjectFile, saveAutosave } from './core/storage.js';
import { degToRad, formatArea, formatDecimal, formatMeters, normalizeDegrees, radToDeg, roundMillimeters, slugify } from './core/units.js';
import { BuildControls } from './scene/controls.js';
import { ClearanceOverlay, LayoutOverlay } from './scene/overlays.js';
import { FirstPersonController } from './scene/player.js';
import { SceneManager } from './scene/scene.js';
import { WorldBuilder } from './scene/world.js';
import { createElement, NumberDialog, Outliner, PropertyPanel, Toast } from './ui/editor.js';
import { loadPlanFile, PlanImportError } from './ui/plan-import.js';
import { createPlanSheet } from './ui/plan-sheet.js';

/**
 * @returns {Storage|null} localStorage, ou null quando o navegador o bloqueia.
 */
function safeLocalStorage() {
    try {
        return window.localStorage;
    } catch (error) {
        if (error instanceof DOMException) {
            return null;
        }
        throw error;
    }
}

/**
 * @typedef {{type: string, id: string}} EntityRef
 * @typedef {import('./core/geometry.js').Clearance} Clearance
 */

/** Nomes exibidos para cada tipo de elemento. */
const KIND_LABELS = Object.freeze({
    wall: 'Parede',
    door: 'Porta',
    window: 'Janela',
    object: 'Objeto',
    room: 'Cômodo',
    player: 'Personagem',
    underlay: 'Planta de fundo'
});

/** Rótulos dos lados medidos a partir do objeto (do ponto de vista de quem olha para a frente dele). */
const SIDE_LABELS = Object.freeze({ front: 'frente', back: 'atrás', left: 'esquerda', right: 'direita' });

/** Distância (m) que o personagem pode percorrer fora do ambiente ao sair por uma porta. */
const OUTSIDE_MARGIN = 5;

/** Tempo mínimo (ms) em pausa antes de um Esc voltar ao modo construção. */
const ESC_GRACE_MS = 400;

/** Tamanhos de exemplo da tela inicial. */
const START_PRESETS = Object.freeze([
    { name: 'Banheiro', width: 2, length: 2, height: 2.6 },
    { name: 'Quarto', width: 3, length: 3.5, height: 2.7 },
    { name: 'Meu Studio', width: 5, length: 8, height: 2.7 },
    { name: 'Casa térrea', width: 10, length: 12, height: 2.8 }
]);

/** Textos de ajuda da barra de status para cada ferramenta. */
const TOOL_HINTS = Object.freeze({
    none: 'Arraste para mover a vista, roda para aproximar. V alterna entre 3D e Planta.',
    wall: 'Clique em cada canto. Verde = canto de parede, azul = face de parede. Esc ou clique direito encerra.',
    measure: 'Clique em dois pontos para medir. As medidas ficam na tela até você limpar a trena.',
    calibrate: 'Clique nas duas pontas de uma cota conhecida da planta (por exemplo, a largura total).',
    align: 'Clique no canto interno da planta que corresponde à origem (canto superior esquerdo do ambiente).'
});

class App {
    // #region Construtores :: constructor()

    constructor() {
        /** @type {Logger} */
        this.logger = new Logger('app');
        /** @type {(id: string) => HTMLElement} */
        this.byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

        /** @type {HTMLElement} */
        this.root = this.byId('app');
        /** @type {SceneManager} */
        this.sceneManager = new SceneManager(this.byId('viewport-canvas'));
        /** @type {WorldBuilder} */
        this.world = new WorldBuilder(this.sceneManager);
        /** @type {CollisionWorld} */
        this.collisionWorld = new CollisionWorld();
        /** @type {BuildControls} */
        this.controls = new BuildControls(this.sceneManager, this.world);
        /** @type {ClearanceOverlay} */
        this.clearanceOverlay = new ClearanceOverlay(this.sceneManager.scene);
        /** @type {LayoutOverlay} */
        this.layoutOverlay = new LayoutOverlay(this.sceneManager.scene);
        /** @type {LibraryStore} */
        this.library = new LibraryStore(safeLocalStorage());
        /** @type {import('./core/geometry.js').LayoutAnalysis|null} */
        this.analysis = null;
        /** @type {FirstPersonController} */
        this.player = new FirstPersonController(this.sceneManager.fpsCamera, this.sceneManager.renderer.domElement, this.collisionWorld);
        /** @type {PropertyPanel} */
        this.panel = new PropertyPanel(this.byId('panel'));
        /** @type {Outliner} */
        this.outliner = new Outliner(this.byId('outliner'));
        /** @type {Toast} */
        this.toast = new Toast(this.byId('toast'));
        /** @type {NumberDialog} */
        this.numberDialog = new NumberDialog(/** @type {HTMLDialogElement} */ (this.byId('number-dialog')));
        /** @type {History} */
        this.history = new History(HISTORY_LIMIT);

        /** @type {ProjectState|null} */
        this.state = null;
        /** @type {(() => void)|null} */
        this.unsubscribe = null;
        /** @type {EntityRef|null} */
        this.selection = null;
        /** @type {'build'|'explore'} */
        this.mode = 'build';
        /** @type {'3d'|'plan'} */
        this.view = '3d';
        /** @type {number} */
        this.autosaveTimer = 0;
        /** @type {number} */
        this.hudTimer = 0;
        /** @type {number} */
        this.pausedAt = 0;
        /** @type {boolean} */
        this.underlayQuotaWarned = false;

        this.bindControls();
        this.bindToolbar();
        this.bindTopbar();
        this.bindStartScreen();
        this.bindExplore();
        this.bindKeyboard();
        this.bindVersion3();
        this.renderCatalog();
        this.renderLibrary();
        this.showStartScreen();
    }

    // #endregion

    // #region Projeto :: loadState(), handleStateChange(), snapshot(), scheduleAutosave()

    /**
     * Ativa um projeto (novo ou importado).
     * @param {ProjectState} state Projeto.
     */
    loadState(state) {
        this.unsubscribe?.();
        this.state = state;
        this.unsubscribe = state.onChange((reason) => this.handleStateChange(reason));
        this.selection = null;
        this.controls.clearMeasurements();
        this.setMode('build');
        this.handleStateChange('load');
        this.history.reset(this.snapshot());
        this.updateHistoryButtons();
        this.controls.frameEnvironment(state.environment);
        this.hideStartScreen();
        this.logger.info('Projeto carregado', { name: state.project.name, walls: state.walls.length, objects: state.objects.length });
    }

    /**
     * Reconstrói a cena e a interface após qualquer alteração no estado.
     * @param {string} reason Motivo informado pelo estado.
     */
    handleStateChange(reason) {
        /** @type {ProjectState} */
        const state = /** @type {ProjectState} */ (this.state);
        this.world.rebuild(state);
        this.collisionWorld.setColliders(this.world.colliders);
        // Limite de segurança com folga externa: permite sair por uma porta aberta sem se perder no terreno
        this.collisionWorld.setBounds({ minX: -OUTSIDE_MARGIN, maxX: state.environment.width + OUTSIDE_MARGIN, minZ: -OUTSIDE_MARGIN, maxZ: state.environment.length + OUTSIDE_MARGIN });
        this.player.setInteractives(this.world.interactives);
        this.player.configure(state.player, state.environment.height);
        this.controls.setSnap(state.settings.snapToGrid ? state.settings.gridStep : null);
        this.controls.setSnapTargets(wallSnapGeometry(state.walls));

        if (this.selection !== null && !this.entityExists(this.selection)) {
            this.selection = null;
        }
        if (this.mode === 'build') {
            this.controls.attach(this.selection, this.isMovable(this.selection));
        }
        if (reason !== 'load' && reason !== 'history:restore') {
            this.history.record(this.snapshot());
        }
        this.analysis = analyzeLayout(state, state.objects, this.structureColliders());
        this.updateHistoryButtons();
        this.byId('project-name').textContent = state.project.name;
        this.byId('btn-section').setAttribute('aria-pressed', String(state.settings.sectionCut));
        this.renderInspector();
        this.renderOutliner();
        this.renderLayouts();
        this.updateClearances();
        this.updateLayoutOverlay();
        this.scheduleAutosave();
        this.logger.info('Cena atualizada', { reason });
    }

    /**
     * @returns {string} Instantâneo do estado para o histórico (sem a imagem da planta nem a data).
     */
    snapshot() {
        return JSON.stringify(/** @type {ProjectState} */ (this.state).toJSON({ includeUnderlay: false, includeTimestamp: false }));
    }

    /**
     * Salva automaticamente alguns instantes após a última alteração.
     */
    scheduleAutosave() {
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = window.setTimeout(() => {
            if (this.state === null) {
                return;
            }
            /** @type {boolean} */
            const complete = saveAutosave(this.state);
            if (!complete && this.state.underlay !== null && !this.underlayQuotaWarned) {
                this.underlayQuotaWarned = true;
                this.toast.show('A planta de fundo é grande demais para o salvamento automático. Use Exportar para guardá-la.');
            }
        }, 500);
    }

    // #endregion

    // #region Histórico :: undo(), redo(), restoreSnapshot(), updateHistoryButtons()

    undo() {
        /** @type {string|null} */
        const snapshot = this.history.undo();
        if (snapshot !== null) {
            this.restoreSnapshot(snapshot);
        }
    }

    redo() {
        /** @type {string|null} */
        const snapshot = this.history.redo();
        if (snapshot !== null) {
            this.restoreSnapshot(snapshot);
        }
    }

    /**
     * @param {string} snapshot Instantâneo a restaurar.
     */
    restoreSnapshot(snapshot) {
        try {
            /** @type {ProjectState} */ (this.state).replaceWith(ProjectState.fromJSON(JSON.parse(snapshot)).state);
        } catch (error) {
            if (error instanceof ProjectFormatError) {
                this.logger.error('Instantâneo do histórico inválido', { message: error.message });
                return;
            }
            throw error;
        }
    }

    updateHistoryButtons() {
        /** @type {HTMLButtonElement} */ (this.byId('btn-undo')).disabled = !this.history.canUndo();
        /** @type {HTMLButtonElement} */ (this.byId('btn-redo')).disabled = !this.history.canRedo();
    }

    // #endregion

    // #region Seleção :: select(), entityExists(), isMovable(), getEntity()

    /**
     * @param {EntityRef|null} ref Elemento a selecionar (null limpa a seleção).
     */
    select(ref) {
        this.selection = ref;
        this.controls.attach(ref, this.isMovable(ref));
        this.renderInspector();
        this.renderOutliner();
        this.updateClearances();
        this.updateLayoutOverlay();
    }

    /**
     * @param {EntityRef} ref Elemento.
     * @returns {boolean} Verdadeiro se ainda existe no estado.
     */
    entityExists(ref) {
        return this.getEntity(ref) !== null;
    }

    /**
     * @param {EntityRef|null} ref Elemento.
     * @returns {boolean} Verdadeiro se pode ser arrastado pelo gizmo.
     */
    isMovable(ref) {
        if (ref === null || ref.type === 'underlay') {
            return false;
        }
        if (ref.type === 'wall') {
            return this.getEntity(ref)?.perimeter !== true;
        }
        return true;
    }

    /**
     * @param {EntityRef} ref Elemento.
     * @returns {any|null} Dados do elemento.
     */
    getEntity(ref) {
        if (this.state === null) {
            return null;
        }
        if (ref.type === 'player') {
            return this.state.player;
        }
        if (ref.type === 'underlay') {
            return this.state.underlay;
        }
        return this.state.getEntity(/** @type {any} */ (ref.type), ref.id);
    }

    // #endregion

    // #region Painéis :: renderInspector(), buildEnvironmentContent(), buildEntityContent(), describeClearances(), renderOutliner(), handleFieldChange()

    /**
     * Desenha o painel de propriedades do elemento selecionado (ou do ambiente).
     */
    renderInspector() {
        if (this.state === null) {
            return;
        }
        this.panel.wallOptions = this.state.walls.map((wall) => ({ value: wall.id, label: wall.name }));
        this.panel.render(this.selection === null ? this.buildEnvironmentContent() : this.buildEntityContent(this.selection));
    }

    /**
     * Painel do ambiente: medidas, áreas, verificações de uso e transformações do projeto.
     * @returns {import('./ui/editor.js').PanelContent} Conteúdo.
     */
    buildEnvironmentContent() {
        /** @type {ProjectState} */
        const state = /** @type {ProjectState} */ (this.state);
        /** @type {{width: number, length: number, height: number, wallThickness: number}} */
        const env = state.environment;
        /** @type {number} */
        const area = env.width * env.length;
        /** @type {number} */
        const grossArea = (env.width + 2 * env.wallThickness) * (env.length + 2 * env.wallThickness);
        /** @type {number} */
        const roomsArea = state.rooms.reduce((sum, room) => sum + room.width * room.length, 0);
        /** @type {string[]} */
        const notes = [
            `Área interna de piso: ${formatArea(area)}`,
            `Com as paredes externas: ${formatArea(grossArea)}. A área privativa de contratos costuma incluir paredes, por isso é maior que a interna.`,
            `Volume: ${formatDecimal(area * env.height, 2)} m³`
        ];
        if (state.rooms.length > 0) {
            notes.push(`Soma dos cômodos: ${formatArea(roomsArea)}`);
        }
        /** @type {import('./core/geometry.js').LayoutAnalysis} */
        const analysis = /** @type {import('./core/geometry.js').LayoutAnalysis} */ (this.analysis);
        notes.push(`Piso livre aproximado (${state.getActiveLayout().name}): ${formatArea(analysis.freeArea)}`);
        notes.push(analysis.issues.length === 0
            ? 'Verificação: nenhum conflito, porta bloqueada ou área de uso insuficiente.'
            : `Verificação: ${analysis.issues.length} ponto(s) de atenção (em vermelho na cena).`);
        notes.push(...analysis.issues.slice(0, 10).map((issue) => issue.message));
        if (analysis.issues.length > 10) {
            notes.push(`E mais ${analysis.issues.length - 10}.`);
        }
        notes.push('Origem (0, 0) no canto interno superior esquerdo da vista Planta.');
        return {
            kind: 'Ambiente',
            title: state.project.name,
            sections: [
                { heading: '', type: 'environment', data: { ...env, name: state.project.name } },
                { heading: 'Visualização', type: 'settings', data: state.settings }
            ],
            notes,
            actions: [
                { label: 'Configurar personagem', onClick: () => this.select({ type: 'player', id: 'player' }) },
                { label: 'Enquadrar ambiente', onClick: () => this.controls.frameEnvironment(env) },
                { label: 'Exportar folha da planta', variant: 'primary', onClick: () => this.exportSheet() },
                { label: 'Comparar arrumações', onClick: () => this.compareLayouts() },
                { label: 'Espelhar ↔', onClick: () => state.mirror('x') },
                { label: 'Espelhar ↕', onClick: () => state.mirror('z') },
                { label: 'Girar 180°', onClick: () => state.rotate180() }
            ]
        };
    }

    /**
     * Monta o conteúdo do painel para um elemento.
     * @param {EntityRef} ref Elemento.
     * @returns {import('./ui/editor.js').PanelContent} Conteúdo.
     */
    buildEntityContent(ref) {
        /** @type {ProjectState} */
        const state = /** @type {ProjectState} */ (this.state);
        /** @type {any} */
        const entity = this.getEntity(ref);
        /** @type {string[]} */
        const notes = [];
        /** @type {import('./ui/editor.js').PanelAction[]} */
        const actions = [];
        /** @type {import('./ui/editor.js').PanelAction} */
        const duplicate = { label: 'Duplicar', onClick: () => this.duplicateSelection() };
        /** @type {import('./ui/editor.js').PanelAction} */
        const remove = { label: 'Excluir', variant: 'danger', onClick: () => this.deleteSelection() };
        /** @type {number} */
        const playerHeight = state.player.height;

        switch (ref.type) {
            case 'underlay': {
                notes.push(`Arquivo: ${entity.name}`);
                notes.push(`Escala atual: 1 pixel = ${formatDecimal((entity.width / entity.pixelWidth) * 1000, 1)} mm.`);
                notes.push('1. Calibre clicando nas pontas de uma cota conhecida. 2. Alinhe clicando no canto interno que deve ficar na origem.');
                actions.push(
                    { label: 'Calibrar escala', variant: 'primary', onClick: () => this.startTool('calibrate') },
                    { label: 'Ver planta inteira', onClick: () => {
                        this.setView('plan');
                        this.frameUnderlay();
                    } },
                    { label: 'Alinhar canto', onClick: () => this.startTool('align') },
                    { label: 'Girar 90°', onClick: () => this.handleFieldChange('underlay', 'rotation', String(entity.rotation + 90)) },
                    { label: 'Remover planta', variant: 'danger', onClick: () => state.removeUnderlay() }
                );
                return { kind: KIND_LABELS.underlay, title: 'Planta de fundo', sections: [{ heading: '', type: 'underlay', data: entity }], notes, actions };
            }
            case 'player': {
                notes.push(`Altura dos olhos: ${formatMeters(playerHeight * PHYSICS.EYE_HEIGHT_RATIO)}`);
                notes.push(`Pulo de cerca de 0,50 m; sobe degraus de até ${formatMeters(PHYSICS.STEP_HEIGHT)} sem pular.`);
                if (playerHeight > state.environment.height) {
                    notes.push('O personagem é mais alto que o pé-direito do ambiente.');
                }
                actions.push({ label: 'Entrar no modo explorar', variant: 'primary', onClick: () => this.setMode('explore') });
                return { kind: KIND_LABELS.player, title: 'Você', sections: [{ heading: '', type: 'player', data: entity }], notes, actions };
            }
            case 'wall': {
                if (entity.perimeter) {
                    notes.push('Parede externa: as medidas acompanham o ambiente. Altere-as na seção Ambiente.');
                } else {
                    notes.push('A frente da parede é o lado +Z local; portas usam isso para o sentido de abertura.');
                    actions.push(duplicate, remove);
                }
                actions.unshift(
                    { label: '+ Porta nesta parede', onClick: () => this.addOpening('door', entity.id) },
                    { label: '+ Janela nesta parede', onClick: () => this.addOpening('window', entity.id) },
                    this.hideAction(ref, entity)
                );
                return { kind: entity.perimeter ? 'Parede externa' : KIND_LABELS.wall, title: entity.name, sections: [{ heading: '', type: 'wall', data: entity, readOnly: entity.perimeter, readOnlyExcept: ['opacity', 'hidden'] }], notes, actions };
            }
            case 'door':
            case 'window': {
                /** @type {ReturnType<ProjectState['getOpeningGaps']>} */
                const gaps = state.getOpeningGaps(entity);
                if (gaps !== null) {
                    notes.push(`Início da parede em X ${formatMeters(gaps.start.x)}, Z ${formatMeters(gaps.start.z)}; fim em X ${formatMeters(gaps.end.x)}, Z ${formatMeters(gaps.end.z)}.`);
                    notes.push('As folgas são medidas da face interna dos cantos; edite qualquer uma para posicionar pela cota da planta.');
                }
                if (ref.type === 'door') {
                    actions.push({ label: entity.isOpen ? 'Fechar porta' : 'Abrir porta', variant: 'primary', onClick: () => this.toggleDoor(entity.id) });
                }
                actions.push(duplicate, remove);
                /** @type {Record<string, unknown>} */
                const data = gaps === null ? entity : { ...entity, gapStart: gaps.gapStart, gapEnd: gaps.gapEnd };
                return { kind: KIND_LABELS[ref.type], title: entity.name, sections: [{ heading: '', type: ref.type, data }], notes, actions };
            }
            case 'object': {
                notes.push(`Ocupa ${formatArea(entity.width * entity.depth)} do piso.`);
                notes.push(`A altura equivale a ${Math.round(((entity.height + entity.y) / playerHeight) * 100)}% da sua altura (${formatMeters(playerHeight)}).`);
                /** @type {Record<string, Clearance|null>} */
                const clearances = this.computeClearances(entity);
                notes.push(this.describeClearances(clearances));
                notes.push(...(this.analysis?.issues ?? []).filter((issue) => issue.ids.includes(entity.id)).map((issue) => issue.message));
                if (STATEFUL_KINDS.has(entity.kind)) {
                    actions.push({ label: entity.isOpen ? 'Fechar' : 'Abrir', variant: 'primary', onClick: () => this.toggleObjectState(entity.id) });
                }
                if (clearances.back !== null && clearances.back.distance > 0.002) {
                    actions.push({ label: `Encostar atrás (${formatMeters(clearances.back.distance)})`, onClick: () => this.pushAgainstBack(entity.id) });
                }
                actions.push(this.hideAction(ref, entity), { label: 'Salvar na minha biblioteca', onClick: () => this.saveToLibrary(entity) }, duplicate, remove);
                return { kind: KIND_LABELS.object, title: entity.name, sections: [{ heading: '', type: 'object', data: entity }], notes, actions };
            }
            default: {
                notes.push(`Área: ${formatArea(entity.width * entity.length)}`);
                actions.push({ label: 'Criar paredes ao redor', variant: 'primary', onClick: () => this.createRoomWalls(entity.id) }, duplicate, remove);
                return { kind: KIND_LABELS.room, title: entity.name, sections: [{ heading: '', type: 'room', data: entity }], notes, actions };
            }
        }
    }

    /**
     * @param {Record<string, Clearance|null>} clearances Folgas por lado.
     * @returns {string} Resumo legível, por exemplo "Livre: frente 0,85 m, atrás encostado...".
     */
    describeClearances(clearances) {
        /** @type {string[]} */
        const parts = Object.entries(clearances).map(([side, clearance]) => {
            /** @type {string} */
            const label = SIDE_LABELS[/** @type {keyof typeof SIDE_LABELS} */ (side)];
            if (clearance === null) {
                return `${label} sem obstáculo`;
            }
            return clearance.distance < 0.005 ? `${label} encostado` : `${label} ${formatMeters(clearance.distance)}`;
        });
        return `Espaço livre: ${parts.join(', ')}.`;
    }

    /**
     * Atualiza a lista de elementos.
     */
    renderOutliner() {
        if (this.state === null) {
            return;
        }
        this.outliner.render([
            { label: 'Planta de fundo', type: 'underlay', items: this.state.underlay === null ? [] : [{ id: 'underlay', name: this.state.underlay.name }] },
            { label: 'Personagem', type: 'player', items: [{ id: 'player', name: `Você (${formatMeters(this.state.player.height)})` }] },
            { label: 'Cômodos', type: 'room', items: this.state.rooms },
            { label: 'Paredes', type: 'wall', items: this.state.walls.map((wall) => this.outlinerItem(wall)) },
            { label: 'Portas', type: 'door', items: this.state.doors },
            { label: 'Janelas', type: 'window', items: this.state.windows },
            { label: `Objetos (${this.state.getActiveLayout().name})`, type: 'object', items: this.state.objects.map((item) => this.outlinerItem(item)) }
        ], this.selection);
    }

    /**
     * Aplica a alteração de um campo do painel.
     * @param {string} type Tipo da seção.
     * @param {string} key Campo.
     * @param {string|boolean} value Valor bruto.
     */
    handleFieldChange(type, key, value) {
        if (this.state === null) {
            return;
        }
        /** @type {string|null} */
        const id = this.selection !== null && type === this.selection.type ? this.selection.id : null;
        try {
            this.state.updateEntity(/** @type {any} */ (type), id, { [key]: value });
        } catch (error) {
            if (error instanceof ValidationError) {
                this.renderInspector();
                this.panel.showError(type, key, error.message);
                return;
            }
            throw error;
        }
    }

    // #endregion

    // #region Folgas :: computeClearances(), updateClearances(), pushAgainstBack()

    /**
     * Mede o espaço livre ao redor de um objeto, ignorando ele mesmo e o que está fora da sua faixa de altura.
     * @param {any} item Objeto (do estado ou uma prévia durante o arrasto).
     * @returns {Record<string, Clearance|null>} Folgas por lado.
     */
    computeClearances(item) {
        /** @type {any[]} */
        const objects = /** @type {ProjectState} */ (this.state).objects.map((other) => (other.id === item.id ? item : other));
        /** @type {import('./core/geometry.js').OrientedBox[]} */
        const obstacles = obstaclesFor(item, objects, this.structureColliders())
            .filter((box) => (box.yMax ?? Infinity) > item.y + 0.001 && (box.yMin ?? 0) < item.y + item.height - 0.001);
        return measureClearances(effectiveFootprint(item), obstacles);
    }

    /**
     * @returns {import('./core/collision.js').BoxCollider[]} Colisores de paredes, portas e janelas.
     */
    structureColliders() {
        return this.world.colliders.filter((box) => box.ref !== null && box.ref !== undefined && box.ref.type !== 'object');
    }

    /**
     * Desenha conflitos (vermelho) e áreas de uso: as do objeto selecionado ou, se ativado, de todos.
     * @param {any} [preview] Objeto com valores provisórios durante o arrasto.
     */
    updateLayoutOverlay(preview) {
        if (this.mode !== 'build' || this.state === null) {
            this.layoutOverlay.clear();
            return;
        }
        /** @type {ProjectState} */
        const state = this.state;
        /** @type {any[]} */
        const objects = preview === undefined ? state.objects : state.objects.map((item) => (item.id === preview.id ? preview : item));
        /** @type {import('./core/geometry.js').LayoutAnalysis} */
        const analysis = preview === undefined && this.analysis !== null ? this.analysis : analyzeLayout(state, objects, this.structureColliders());
        /** @type {string|null} */
        const selectedId = this.selection?.type === 'object' ? this.selection.id : null;
        /** @type {any[]} */
        const withZones = objects.filter((item) => isSolid(item) && item.hidden !== true && (state.settings.showUsageZones || item.id === selectedId));
        this.layoutOverlay.show({
            zones: withZones.flatMap((item) => usageZones(item).map((zone) => {
                /** @type {Set<string>|undefined} */
                const failed = analysis.usageFailures.get(item.id);
                return { box: zone.box, ok: !(failed?.has(zone.side === 'left' || zone.side === 'right' ? 'side' : zone.side) ?? false) };
            })),
            conflicts: objects.filter((item) => analysis.conflictIds.has(item.id) && item.hidden !== true).map((item) => objectObstacle(item))
        });
    }

    /**
     * Desenha as folgas do objeto selecionado.
     * @param {any} [preview] Valores provisórios durante o arrasto do gizmo.
     */
    updateClearances(preview) {
        if (this.mode !== 'build' || this.selection === null || this.selection.type !== 'object') {
            this.clearanceOverlay.clear();
            return;
        }
        /** @type {any} */
        const entity = this.getEntity(this.selection);
        if (entity === null || NON_COLLIDING_KINDS.has(entity.kind)) {
            this.clearanceOverlay.clear();
            return;
        }
        /** @type {any} */
        const item = { ...entity, ...(preview ?? {}) };
        this.clearanceOverlay.show(this.computeClearances(item), item.y + Math.min(item.height, 0.05));
    }

    /**
     * Move o objeto para trás até encostar no obstáculo mais próximo.
     * @param {string} objectId Objeto.
     */
    pushAgainstBack(objectId) {
        /** @type {any} */
        const item = /** @type {ProjectState} */ (this.state).getEntity('object', objectId);
        /** @type {Clearance|null} */
        const back = this.computeClearances(item).back;
        if (back === null) {
            return;
        }
        /** @type {{x: number, z: number}} */
        const direction = rotateLocal(0, -1, degToRad(item.rotation));
        /** @type {ProjectState} */ (this.state).updateEntity('object', objectId, {
            x: roundMillimeters(item.x + direction.x * back.distance),
            z: roundMillimeters(item.z + direction.z * back.distance)
        });
    }

    // #endregion

    // #region Ações :: addOpening(), addAndSelect(), duplicateSelection(), deleteSelection(), toggleDoor(), createRoomWalls(), patchFromRoot(), previewTransform(), commitTransform()

    /**
     * @param {'door'|'window'} type Tipo.
     * @param {string} [wallId] Parede; por padrão a selecionada ou a externa superior.
     */
    addOpening(type, wallId) {
        /** @type {string} */
        const host = wallId ?? (this.selection?.type === 'wall' ? this.selection.id : PERIMETER_IDS.SOUTH);
        this.addAndSelect(type, () => /** @type {ProjectState} */ (this.state).addOpening(type, host));
    }

    /**
     * Executa uma criação e seleciona o resultado, exibindo erros de validação.
     * @param {string} type Tipo criado.
     * @param {() => {id: string}} create Função de criação.
     */
    addAndSelect(type, create) {
        if (this.state === null) {
            return;
        }
        try {
            /** @type {{id: string}} */
            const created = create();
            this.select({ type, id: created.id });
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    duplicateSelection() {
        if (this.selection === null || this.selection.type === 'player' || this.selection.type === 'underlay' || this.state === null) {
            return;
        }
        /** @type {EntityRef} */
        const ref = this.selection;
        this.addAndSelect(ref.type, () => /** @type {ProjectState} */ (this.state).duplicateEntity(/** @type {any} */ (ref.type), ref.id));
    }

    deleteSelection() {
        if (this.selection === null || this.selection.type === 'player' || this.state === null) {
            return;
        }
        if (this.selection.type === 'underlay') {
            this.state.removeUnderlay();
            return;
        }
        try {
            // A seleção é limpa automaticamente em handleStateChange quando o elemento deixa de existir
            this.state.removeEntity(/** @type {any} */ (this.selection.type), this.selection.id);
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    /**
     * @param {string} doorId Porta.
     */
    toggleDoor(doorId) {
        /** @type {any} */
        const door = this.state?.getEntity('door', doorId);
        if (door !== null && door !== undefined) {
            /** @type {ProjectState} */ (this.state).updateEntity('door', doorId, { isOpen: String(!door.isOpen) });
        }
    }

    /**
     * @param {string} roomId Cômodo.
     */
    createRoomWalls(roomId) {
        /** @type {ProjectState} */ (this.state).createWallsAroundRoom(roomId);
        this.toast.show('Quatro paredes criadas no contorno do cômodo. Adicione uma porta para entrar nele.');
    }

    /**
     * Converte a transformação do gizmo em valores do estado.
     * @param {EntityRef} ref Elemento.
     * @param {import('three').Object3D} root Raiz 3D.
     * @returns {Record<string, number>} Alterações.
     */
    patchFromRoot(ref, root) {
        /** @type {number} */
        const rotation = normalizeDegrees(radToDeg(root.rotation.y));
        switch (ref.type) {
            case 'player':
                return { spawnX: roundMillimeters(root.position.x), spawnZ: roundMillimeters(root.position.z), spawnRotation: rotation };
            case 'room':
                return { x: roundMillimeters(root.position.x), z: roundMillimeters(root.position.z) };
            case 'door':
            case 'window': {
                /** @type {any} */
                const opening = this.getEntity(ref);
                /** @type {any} */
                const wall = /** @type {ProjectState} */ (this.state).getEntity('wall', opening.wallId);
                return { offset: roundMillimeters(root.position.x + wall.length / 2) };
            }
            default:
                return { x: roundMillimeters(root.position.x), y: roundMillimeters(Math.max(0, root.position.y)), z: roundMillimeters(root.position.z), rotation };
        }
    }

    /**
     * Mostra os valores e as folgas durante o arrasto, sem alterar o estado.
     * @param {EntityRef} ref Elemento.
     * @param {import('three').Object3D} root Raiz 3D.
     */
    previewTransform(ref, root) {
        /** @type {Record<string, number>} */
        const patch = this.patchFromRoot(ref, root);
        this.panel.refresh(ref.type, patch);
        if (ref.type === 'object') {
            this.updateClearances(patch);
            this.updateLayoutOverlay({ ...this.getEntity(ref), ...patch });
        }
    }

    /**
     * Grava a transformação ao soltar o gizmo; se for inválida, a cena volta ao estado anterior.
     * @param {EntityRef} ref Elemento.
     * @param {import('three').Object3D} root Raiz 3D.
     */
    commitTransform(ref, root) {
        try {
            /** @type {ProjectState} */ (this.state).updateEntity(/** @type {any} */ (ref.type), ref.id, this.patchFromRoot(ref, root));
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                this.handleStateChange('revert');
                return;
            }
            throw error;
        }
    }

    // #endregion

    // #region Planta de fundo :: importPlan(), calibrate(), align(), startTool()

    /**
     * @param {HTMLInputElement} input Campo de arquivo.
     */
    async importPlan(input) {
        /** @type {File|undefined} */
        const file = input.files?.[0];
        input.value = '';
        if (file === undefined || this.state === null) {
            return;
        }
        this.toast.show('Carregando a planta...');
        try {
            /** @type {import('./ui/plan-import.js').PlanImage|null} */
            const image = await loadPlanFile(file, (pageCount) => this.numberDialog.ask({
                title: 'Qual página tem a planta?',
                message: `O PDF tem ${pageCount} páginas.`,
                value: '1',
                unit: `de ${pageCount}`,
                min: 1,
                max: pageCount,
                confirm: 'Usar página'
            }));
            if (image === null) {
                return;
            }
            this.state.setUnderlay(image);
            this.setView('plan');
            this.frameUnderlay();
            this.select({ type: 'underlay', id: 'underlay' });
            this.toast.show('Planta carregada. Agora calibre a escala: clique nas duas pontas de uma cota conhecida.');
            this.startTool('calibrate');
        } catch (error) {
            if (error instanceof PlanImportError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    /**
     * Enquadra a imagem inteira da planta na vista Planta (útil antes de calibrar).
     */
    frameUnderlay() {
        /** @type {import('./core/state.js').Underlay|null} */
        const underlay = this.state?.underlay ?? null;
        if (underlay === null) {
            return;
        }
        /** @type {number} */
        const height = (underlay.width * underlay.pixelHeight) / underlay.pixelWidth;
        // Raio que cobre a imagem em qualquer rotação
        /** @type {number} */
        const radius = Math.hypot(underlay.width, height) / 2;
        /** @type {boolean} */
        const straight = Math.abs(Math.sin(degToRad(underlay.rotation))) < 1e-6 || Math.abs(Math.cos(degToRad(underlay.rotation))) < 1e-6;
        /** @type {number} */
        const halfX = straight ? (Math.abs(Math.cos(degToRad(underlay.rotation))) > 0.5 ? underlay.width : height) / 2 : radius;
        /** @type {number} */
        const halfZ = straight ? (Math.abs(Math.cos(degToRad(underlay.rotation))) > 0.5 ? height : underlay.width) / 2 : radius;
        this.controls.framePlan(underlay.x - halfX, underlay.z - halfZ, underlay.x + halfX, underlay.z + halfZ);
    }

    /**
     * @param {import('three').Vector3} a Primeiro ponto.
     * @param {import('three').Vector3} b Segundo ponto.
     */
    async calibrate(a, b) {
        /** @type {number} */
        const measured = Math.hypot(b.x - a.x, b.z - a.z);
        /** @type {number|null} */
        const real = await this.numberDialog.ask({
            title: 'Calibrar escala',
            message: `Na imagem, essa distância mede ${formatMeters(measured)}. Qual é a medida real dessa cota?`,
            value: formatDecimal(measured),
            unit: 'm',
            min: 0.01,
            max: 500
        });
        if (real === null) {
            return;
        }
        try {
            /** @type {ProjectState} */ (this.state).calibrateUnderlay(a, b, real);
            this.select({ type: 'underlay', id: 'underlay' });
            this.toast.show('Escala calibrada. Agora use "Alinhar canto" e clique no canto interno que fica na origem.');
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    /**
     * @param {import('three').Vector3} point Ponto clicado na imagem.
     */
    align(point) {
        try {
            /** @type {ProjectState} */ (this.state).alignUnderlay(point);
            this.select({ type: 'underlay', id: 'underlay' });
            this.toast.show('Planta alinhada à origem. Ajuste a opacidade e desenhe as paredes por cima.');
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    /**
     * @param {'wall'|'measure'|'calibrate'|'align'} tool Ferramenta.
     */
    startTool(tool) {
        if ((tool === 'calibrate' || tool === 'align') && this.state?.underlay === null) {
            this.toast.show('Importe uma planta primeiro.', 'error');
            return;
        }
        if (this.controls.tool === tool) {
            this.controls.stopTool();
            return;
        }
        this.controls.startTool(tool);
    }

    // #endregion

    // #region Modos :: setMode(), setView(), setOverlay(), updateHud()

    /**
     * Alterna entre construir e explorar sem perder o estado.
     * @param {'build'|'explore'} mode Modo.
     */
    setMode(mode) {
        if (this.state === null) {
            return;
        }
        this.mode = mode;
        this.root.dataset.mode = mode;
        for (const button of document.querySelectorAll('[data-mode-button]')) {
            button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.modeButton === mode));
        }
        this.world.setMode(mode);
        if (mode === 'explore') {
            this.controls.detach();
            this.controls.setEnabled(false);
            this.clearanceOverlay.clear();
            this.layoutOverlay.clear();
            this.sceneManager.useCamera('explore');
            this.player.configure(this.state.player, this.state.environment.height);
            this.player.spawn(this.state.player.spawnX, this.state.player.spawnZ, this.state.player.spawnRotation);
            this.player.activate();
            this.setOverlay('start');
        } else {
            this.player.deactivate();
            this.controls.setEnabled(true);
            this.controls.setView(this.view);
            this.controls.attach(this.selection, this.isMovable(this.selection));
            this.updateClearances();
            this.updateLayoutOverlay();
            this.setOverlay('hidden');
        }
    }

    /**
     * @param {'3d'|'plan'} view Vista do modo construção.
     */
    setView(view) {
        this.view = view;
        this.root.dataset.view = view;
        for (const button of document.querySelectorAll('[data-view]')) {
            button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.view === view));
        }
        if (this.mode === 'build') {
            this.controls.setView(view);
            this.controls.attach(this.selection, this.isMovable(this.selection));
        }
    }

    /**
     * @param {'start'|'paused'|'hidden'} overlay Estado da sobreposição do modo explorar.
     */
    setOverlay(overlay) {
        /** @type {HTMLElement} */
        const element = this.byId('explore-overlay');
        element.hidden = overlay === 'hidden';
        this.pausedAt = performance.now();
        if (this.state !== null) {
            this.byId('overlay-title').textContent = overlay === 'paused' ? 'Pausado' : 'Explorar em primeira pessoa';
            this.byId('overlay-scale').textContent = `Você tem ${formatMeters(this.state.player.height)} e seus olhos ficam a ${formatMeters(this.state.player.height * PHYSICS.EYE_HEIGHT_RATIO)} do chão.`;
            this.byId('btn-enter').textContent = overlay === 'paused' ? 'Continuar explorando' : 'Entrar no ambiente';
        }
    }

    /**
     * Atualiza o painel de informações do modo explorar (no máximo 10 vezes por segundo).
     * @param {number} delta Tempo do quadro.
     */
    updateHud(delta) {
        this.hudTimer += delta;
        if (this.mode !== 'explore' || this.hudTimer < 0.1) {
            return;
        }
        this.hudTimer = 0;
        /** @type {import('./scene/player.js').PlayerStatus} */
        const status = this.player.getStatus();
        this.byId('hud-position').textContent = `X ${formatMeters(status.x)}   Z ${formatMeters(status.z)}`;
        this.byId('hud-eyes').textContent = `Olhos a ${formatMeters(status.eyeHeight)}`;
        this.byId('hud-speed').textContent = status.running ? 'Correndo' : 'Caminhando';
        this.byId('hud-prompt').hidden = status.target === null;
    }

    // #endregion

    // #region Ligações de interface :: bindControls(), bindToolbar(), renderCatalog(), bindTopbar(), setGizmo(), importFile(), bindStartScreen(), bindExplore(), bindKeyboard()

    bindControls() {
        this.panel.onFieldChange = (type, key, value) => this.handleFieldChange(type, key, value);
        this.outliner.onPick = (ref) => this.select(ref);
        this.controls.onSelect = (ref) => this.select(ref);
        this.controls.onTransformChange = (ref, root) => this.previewTransform(ref, root);
        this.controls.onTransformCommit = (ref, root) => this.commitTransform(ref, root);
        this.controls.onWallDrawn = (start, end) => {
            /** @type {ProjectState} */ (this.state).addWallBetween(start.x, start.z, end.x, end.z);
        };
        this.controls.onCalibrate = (a, b) => {
            this.calibrate(a, b);
        };
        this.controls.onAlign = (point) => this.align(point);
        this.controls.onPointerFloor = (pick) => {
            /** @type {string} */
            const snap = pick?.kind === 'corner' ? '  (canto)' : pick?.kind === 'face' ? '  (face da parede)' : '';
            this.byId('status-cursor').textContent = pick === null ? '' : `X ${formatMeters(pick.point.x)}   Z ${formatMeters(pick.point.z)}${snap}`;
        };
        this.controls.onToolChange = (tool) => {
            for (const button of document.querySelectorAll('[data-tool]')) {
                button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.tool === tool));
            }
            this.byId('status-hint').textContent = TOOL_HINTS[tool ?? 'none'];
        };
        this.player.onInteract = () => {
            if (this.player.target !== null && this.player.target.type === 'door') {
                this.toggleDoor(this.player.target.id);
            } else if (this.player.target !== null && this.player.target.type === 'object') {
                this.toggleObjectState(this.player.target.id);
            }
        };
        this.player.onLockChange = (locked) => this.setOverlay(locked ? 'hidden' : 'paused');
        this.sceneManager.addUpdater((delta) => {
            this.player.update(delta);
            this.updateHud(delta);
        });
    }

    bindToolbar() {
        for (const button of document.querySelectorAll('[data-tool]')) {
            button.addEventListener('click', () => this.startTool(/** @type {any} */ (/** @type {HTMLElement} */ (button).dataset.tool)));
        }
        this.byId('tool-clear-measure').addEventListener('click', () => this.controls.clearMeasurements());
        this.byId('tool-wall').addEventListener('click', () => this.addAndSelect('wall', () => /** @type {ProjectState} */ (this.state).addWall()));
        this.byId('tool-room').addEventListener('click', () => this.addAndSelect('room', () => /** @type {ProjectState} */ (this.state).addRoom()));
        this.byId('tool-door').addEventListener('click', () => this.addOpening('door'));
        this.byId('tool-window').addEventListener('click', () => this.addOpening('window'));
        this.byId('tool-player').addEventListener('click', () => this.select({ type: 'player', id: 'player' }));
        this.byId('tool-plan-import').addEventListener('click', () => this.byId('file-plan').click());
        this.byId('file-plan').addEventListener('change', (event) => {
            this.importPlan(/** @type {HTMLInputElement} */ (event.target));
        });
        this.byId('tool-plan-adjust').addEventListener('click', () => {
            if (this.state?.underlay === null) {
                this.toast.show('Importe uma planta primeiro.', 'error');
                return;
            }
            this.select({ type: 'underlay', id: 'underlay' });
        });

        /** @type {HTMLFormElement} */
        const form = /** @type {HTMLFormElement} */ (this.byId('custom-form'));
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            /** @type {FormData} */
            const data = new FormData(form);
            this.addAndSelect('object', () => /** @type {ProjectState} */ (this.state).addCustomObject({
                name: String(data.get('name') ?? ''),
                width: String(data.get('width') ?? ''),
                height: String(data.get('height') ?? ''),
                depth: String(data.get('depth') ?? '')
            }));
        });
    }

    renderCatalog() {
        for (const item of OBJECT_CATALOG) {
            /** @type {HTMLElement} */
            const catalog = this.byId(/** @type {any} */ (item).group === 'technical' ? 'catalog-technical' : 'catalog');
            /** @type {HTMLButtonElement} */
            const button = /** @type {HTMLButtonElement} */ (createElement('button', 'catalog-item'));
            button.type = 'button';
            /** @type {string} */
            const size = /** @type {any} */ (item).mount === 'full'
                ? `${formatDecimal(item.width)} × ${formatDecimal(item.depth)}, até o teto`
                : `${formatDecimal(item.width)} × ${formatDecimal(item.depth)} × ${formatDecimal(item.height)}`;
            button.append(createElement('span', 'catalog-name', item.name), createElement('span', 'catalog-size', size));
            button.title = `${item.name}: largura × profundidade × altura, em metros`;
            button.addEventListener('click', () => this.addAndSelect('object', () => /** @type {ProjectState} */ (this.state).addObject(item.kind)));
            catalog.append(button);
        }
    }

    bindTopbar() {
        for (const button of document.querySelectorAll('[data-mode-button]')) {
            button.addEventListener('click', () => this.setMode(/** @type {any} */ (/** @type {HTMLElement} */ (button).dataset.modeButton)));
        }
        for (const button of document.querySelectorAll('[data-view]')) {
            button.addEventListener('click', () => this.setView(/** @type {any} */ (/** @type {HTMLElement} */ (button).dataset.view)));
        }
        for (const button of document.querySelectorAll('[data-gizmo]')) {
            button.addEventListener('click', () => this.setGizmo(/** @type {any} */ (/** @type {HTMLElement} */ (button).dataset.gizmo)));
        }
        this.byId('btn-undo').addEventListener('click', () => this.undo());
        this.byId('btn-redo').addEventListener('click', () => this.redo());
        this.byId('btn-export').addEventListener('click', () => {
            if (this.state !== null) {
                exportProject(this.state);
                this.toast.show('Projeto exportado.');
            }
        });
        this.byId('btn-import').addEventListener('click', () => this.byId('file-import').click());
        this.byId('file-import').addEventListener('change', (event) => {
            this.importFile(/** @type {HTMLInputElement} */ (event.target));
        });
        this.byId('btn-new').addEventListener('click', () => {
            if (window.confirm('Começar um projeto novo? Exporte o atual antes se quiser guardá-lo.')) {
                this.setMode('build');
                this.showStartScreen();
            }
        });
    }

    /**
     * @param {'translate'|'rotate'} mode Modo do gizmo.
     */
    setGizmo(mode) {
        this.controls.setGizmoMode(mode);
        for (const button of document.querySelectorAll('[data-gizmo]')) {
            button.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (button).dataset.gizmo === mode));
        }
    }

    /**
     * @param {HTMLInputElement} input Campo de arquivo.
     */
    async importFile(input) {
        /** @type {File|undefined} */
        const file = input.files?.[0];
        input.value = '';
        if (file === undefined) {
            return;
        }
        try {
            /** @type {{state: ProjectState, warnings: string[]}} */
            const result = await readProjectFile(file);
            this.loadState(result.state);
            this.toast.show(result.warnings.length > 0 ? `Projeto importado. ${result.warnings.join(' ')}` : 'Projeto importado.');
        } catch (error) {
            if (error instanceof ProjectFormatError) {
                this.showStartError(error.message);
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    bindStartScreen() {
        /** @type {HTMLFormElement} */
        const form = /** @type {HTMLFormElement} */ (this.byId('start-form'));
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            /** @type {FormData} */
            const data = new FormData(form);
            try {
                this.loadState(ProjectState.create({
                    name: String(data.get('name') ?? ''),
                    width: String(data.get('width') ?? ''),
                    length: String(data.get('length') ?? ''),
                    height: String(data.get('height') ?? '')
                }));
            } catch (error) {
                if (error instanceof ValidationError) {
                    this.showStartError(error.message);
                    return;
                }
                throw error;
            }
        });

        /** @type {HTMLElement} */
        const presets = this.byId('start-presets');
        for (const preset of START_PRESETS) {
            /** @type {HTMLButtonElement} */
            const button = /** @type {HTMLButtonElement} */ (createElement('button', 'preset', `${preset.name} ${formatDecimal(preset.width, preset.width % 1 === 0 ? 0 : 1)} × ${formatDecimal(preset.length, preset.length % 1 === 0 ? 0 : 1)} m`));
            button.type = 'button';
            button.addEventListener('click', () => {
                /** @type {Record<string, string>} */
                const values = { name: preset.name, width: formatDecimal(preset.width), length: formatDecimal(preset.length), height: formatDecimal(preset.height) };
                for (const [key, value] of Object.entries(values)) {
                    /** @type {HTMLInputElement} */ (form.elements.namedItem(key)).value = value;
                }
                this.showStartError('');
            });
            presets.append(button);
        }
        this.byId('start-import').addEventListener('click', () => this.byId('file-import').click());
        this.byId('start-resume').addEventListener('click', () => {
            /** @type {{raw: unknown}|null} */
            const saved = peekAutosave();
            if (saved === null) {
                return;
            }
            try {
                this.loadState(ProjectState.fromJSON(saved.raw).state);
            } catch (error) {
                if (error instanceof ProjectFormatError) {
                    this.showStartError(error.message);
                    return;
                }
                throw error;
            }
        });
    }

    bindExplore() {
        this.byId('btn-enter').addEventListener('click', () => this.player.requestLock());
        this.byId('btn-back-build').addEventListener('click', () => this.setMode('build'));
    }

    bindKeyboard() {
        window.addEventListener('keydown', (event) => {
            if (this.state === null || !this.byId('start-screen').hidden || /** @type {HTMLDialogElement} */ (this.byId('number-dialog')).open) {
                return;
            }
            /** @type {EventTarget|null} */
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
                return;
            }
            if (this.mode === 'explore') {
                // O intervalo evita que o mesmo Esc que liberou o cursor também encerre o modo explorar
                if (event.key === 'Escape' && !this.player.isLocked && performance.now() - this.pausedAt > ESC_GRACE_MS) {
                    this.setMode('build');
                }
                return;
            }
            /** @type {boolean} */
            const command = event.ctrlKey || event.metaKey;
            if (command && event.code === 'KeyZ') {
                event.preventDefault();
                if (event.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
            } else if (command && event.code === 'KeyY') {
                event.preventDefault();
                this.redo();
            } else if (command && event.code === 'KeyD') {
                event.preventDefault();
                this.duplicateSelection();
            } else if (event.key === 'Escape') {
                if (this.controls.tool !== null) {
                    this.controls.stopTool();
                } else {
                    this.select(null);
                }
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                this.deleteSelection();
            } else if (command) {
                return;
            } else if (event.code === 'KeyG') {
                this.setGizmo('translate');
            } else if (event.code === 'KeyR') {
                this.setGizmo('rotate');
            } else if (event.code === 'KeyV') {
                this.setView(this.view === '3d' ? 'plan' : '3d');
            } else if (event.code === 'KeyM') {
                this.startTool('measure');
            } else if (event.code === 'KeyH' && this.selection !== null && (this.selection.type === 'object' || this.selection.type === 'wall')) {
                this.handleFieldChange(this.selection.type, 'hidden', this.getEntity(this.selection)?.hidden !== true);
            } else if (event.code === 'KeyC') {
                this.toggleSection();
            } else if (event.code === 'KeyP') {
                this.setMode('explore');
            }
        });
    }

    // #endregion

    // #region Tela inicial :: showStartScreen(), hideStartScreen(), showStartError()

    showStartScreen() {
        /** @type {{name: string, savedAt: string}|null} */
        const saved = peekAutosave();
        /** @type {HTMLElement} */
        const resume = this.byId('start-resume');
        resume.hidden = saved === null;
        if (saved !== null) {
            resume.textContent = `Continuar "${saved.name}"`;
        }
        this.showStartError('');
        this.byId('start-screen').hidden = false;
        /** @type {HTMLInputElement} */ (document.querySelector('#start-form input[name="name"]')).focus();
    }

    hideStartScreen() {
        this.byId('start-screen').hidden = true;
        this.sceneManager.renderer.domElement.focus();
    }

    /**
     * @param {string} message Mensagem de erro (vazia para limpar).
     */
    showStartError(message) {
        this.byId('start-error').textContent = message;
    }

    // #endregion

    // #region Versão 3 :: bindVersion3(), hideAction(), outlinerItem(), toggleObjectState(), toggleSection(), renderLayouts(), compareLayouts(), askLayoutName(), renderLibrary(), saveToLibrary(), exportSheet(), downloadDataUrl()

    bindVersion3() {
        this.byId('btn-section').addEventListener('click', () => this.toggleSection());
        /** @type {HTMLSelectElement} */
        const select = /** @type {HTMLSelectElement} */ (this.byId('layout-select'));
        select.addEventListener('change', () => this.runValidated(() => /** @type {ProjectState} */ (this.state).switchLayout(select.value)));
        this.byId('layout-new').addEventListener('click', async () => {
            /** @type {string|null} */
            const name = await this.askLayoutName('Nova arrumação', `Arrumação ${(this.state?.layouts.length ?? 0) + 1}`, 'Cria uma cópia da arrumação atual para você testar outra disposição dos móveis.');
            if (name !== null) {
                this.runValidated(() => /** @type {ProjectState} */ (this.state).createLayout(name));
            }
        });
        this.byId('layout-rename').addEventListener('click', async () => {
            /** @type {ProjectState|null} */
            const state = this.state;
            if (state === null) {
                return;
            }
            /** @type {string|null} */
            const name = await this.askLayoutName('Renomear arrumação', state.getActiveLayout().name, '');
            if (name !== null) {
                this.runValidated(() => state.renameLayout(state.activeLayoutId, name));
            }
        });
        this.byId('layout-delete').addEventListener('click', () => {
            /** @type {ProjectState|null} */
            const state = this.state;
            if (state !== null && window.confirm(`Excluir a arrumação "${state.getActiveLayout().name}"?`)) {
                this.runValidated(() => state.deleteLayout(state.activeLayoutId));
            }
        });
        this.byId('layout-compare').addEventListener('click', () => this.compareLayouts());
        this.byId('layout-sheet').addEventListener('click', () => this.exportSheet());
        this.byId('library-export').addEventListener('click', () => {
            /** @type {string} */
            const json = JSON.stringify(this.library.toJSON(), null, 2);
            this.downloadDataUrl(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`, 'minha-biblioteca.json');
        });
        this.byId('library-import').addEventListener('click', () => this.byId('file-library').click());
        this.byId('file-library').addEventListener('change', async (event) => {
            /** @type {HTMLInputElement} */
            const input = /** @type {HTMLInputElement} */ (event.target);
            /** @type {File|undefined} */
            const file = input.files?.[0];
            input.value = '';
            if (file === undefined) {
                return;
            }
            try {
                /** @type {number} */
                const count = this.library.importJSON(JSON.parse(await file.text()));
                this.renderLibrary();
                this.toast.show(`${count} item(ns) importado(s) para a sua biblioteca.`);
            } catch (error) {
                if (error instanceof SyntaxError || error instanceof ValidationError) {
                    this.toast.show(error instanceof ValidationError ? error.message : 'O arquivo não é um JSON válido.', 'error');
                    return;
                }
                throw error;
            }
        });
    }

    /**
     * Executa uma alteração do estado exibindo erros de validação como aviso.
     * @param {() => void} action Alteração.
     */
    runValidated(action) {
        try {
            action();
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                this.renderLayouts();
                return;
            }
            throw error;
        }
    }

    /**
     * @param {EntityRef} ref Elemento.
     * @param {any} entity Dados.
     * @returns {import('./ui/editor.js').PanelAction} Botão de ocultar/mostrar.
     */
    hideAction(ref, entity) {
        return {
            label: entity.hidden === true ? 'Mostrar ao construir' : 'Ocultar ao construir (H)',
            onClick: () => this.handleFieldChange(ref.type, 'hidden', entity.hidden !== true)
        };
    }

    /**
     * @param {any} item Parede ou objeto.
     * @returns {{id: string, name: string}} Item da lista, marcando ocultos e translúcidos.
     */
    outlinerItem(item) {
        /** @type {string} */
        const suffix = item.hidden === true ? ' (oculto)' : (item.opacity ?? 100) < 100 ? ` (${item.opacity}%)` : '';
        return { id: item.id, name: `${item.name}${suffix}` };
    }

    /**
     * Abre ou fecha um móvel com partes móveis.
     * @param {string} objectId Objeto.
     */
    toggleObjectState(objectId) {
        /** @type {any} */
        const item = this.state?.getEntity('object', objectId);
        if (item !== null && item !== undefined && STATEFUL_KINDS.has(item.kind)) {
            /** @type {ProjectState} */ (this.state).updateEntity('object', objectId, { isOpen: String(!item.isOpen) });
        }
    }

    /**
     * Liga ou desliga o corte horizontal (tudo acima da altura do corte some no modo construção).
     */
    toggleSection() {
        if (this.state === null) {
            return;
        }
        this.state.updateEntity('settings', null, { sectionCut: !this.state.settings.sectionCut });
        this.toast.show(this.state.settings.sectionCut
            ? `Corte ligado: tudo acima de ${formatMeters(this.state.settings.sectionHeight)} fica oculto ao construir.`
            : 'Corte desligado.');
    }

    /**
     * Atualiza o seletor de arrumações.
     */
    renderLayouts() {
        if (this.state === null) {
            return;
        }
        /** @type {HTMLSelectElement} */
        const select = /** @type {HTMLSelectElement} */ (this.byId('layout-select'));
        select.replaceChildren(...this.state.layouts.map((layout) => {
            /** @type {HTMLOptionElement} */
            const option = document.createElement('option');
            option.value = layout.id;
            option.textContent = layout.name;
            return option;
        }));
        select.value = this.state.activeLayoutId;
        /** @type {HTMLButtonElement} */ (this.byId('layout-delete')).disabled = this.state.layouts.length <= 1;
    }

    /**
     * Mostra no painel a comparação entre todas as arrumações.
     */
    compareLayouts() {
        /** @type {ProjectState|null} */
        const state = this.state;
        if (state === null) {
            return;
        }
        this.select(null);
        state.syncActiveLayout();
        /** @type {import('./core/collision.js').BoxCollider[]} */
        const structure = this.structureColliders();
        /** @type {string[]} */
        const notes = state.layouts.map((layout) => {
            /** @type {import('./core/geometry.js').LayoutAnalysis} */
            const result = analyzeLayout(state, layout.objects, structure);
            /** @type {Record<string, number>} */
            const counts = { overlap: 0, door: 0, usage: 0 };
            result.issues.forEach((issue) => {
                counts[issue.type] += 1;
            });
            /** @type {string} */
            const marker = layout.id === state.activeLayoutId ? ' (em edição)' : '';
            return `${layout.name}${marker}: piso livre ${formatArea(result.freeArea)}, ${layout.objects.length} objetos, ${counts.overlap} conflito(s), ${counts.door} porta(s) bloqueada(s), ${counts.usage} área(s) de uso insuficiente(s).`;
        });
        this.panel.render({
            kind: 'Arrumações',
            title: 'Comparação',
            sections: [],
            notes,
            actions: [{ label: 'Voltar ao ambiente', onClick: () => this.renderInspector() }]
        });
    }

    /**
     * @param {string} title Título.
     * @param {string} value Valor inicial.
     * @param {string} message Explicação.
     * @returns {Promise<string|null>} Nome escolhido.
     */
    askLayoutName(title, value, message) {
        return this.numberDialog.askText({ title, message, value, confirm: 'Salvar' });
    }

    /**
     * Desenha a lista da biblioteca pessoal.
     */
    renderLibrary() {
        /** @type {HTMLElement} */
        const list = this.byId('library-list');
        list.replaceChildren();
        if (this.library.items.length === 0) {
            list.append(createElement('p', 'tool-hint', 'Selecione um objeto e use "Salvar na minha biblioteca" para reutilizá-lo em outros projetos.'));
            return;
        }
        for (const item of this.library.items) {
            /** @type {HTMLElement} */
            const row = createElement('div', 'library-row');
            /** @type {HTMLButtonElement} */
            const add = /** @type {HTMLButtonElement} */ (createElement('button', 'catalog-item'));
            add.type = 'button';
            add.append(createElement('span', 'catalog-name', item.name), createElement('span', 'catalog-size', `${formatDecimal(item.width)} × ${formatDecimal(item.depth)} × ${formatDecimal(item.height)}`));
            add.addEventListener('click', () => this.addAndSelect('object', () => /** @type {ProjectState} */ (this.state).addLibraryObject(item)));
            /** @type {HTMLButtonElement} */
            const remove = /** @type {HTMLButtonElement} */ (createElement('button', 'library-remove', '×'));
            remove.type = 'button';
            remove.title = `Remover ${item.name} da biblioteca`;
            remove.setAttribute('aria-label', remove.title);
            remove.addEventListener('click', () => {
                this.library.remove(item.id);
                this.renderLibrary();
            });
            row.append(add, remove);
            list.append(row);
        }
    }

    /**
     * @param {any} entity Objeto a guardar.
     */
    saveToLibrary(entity) {
        try {
            this.library.add(entity);
            this.renderLibrary();
            this.toast.show(`${entity.name} foi salvo na sua biblioteca.`);
        } catch (error) {
            if (error instanceof ValidationError) {
                this.toast.show(error.message, 'error');
                return;
            }
            throw error;
        }
    }

    /**
     * Gera e baixa a folha da planta em PNG.
     */
    async exportSheet() {
        if (this.state === null || this.analysis === null) {
            return;
        }
        if (this.mode !== 'build') {
            this.setMode('build');
        }
        /** @type {import('three').Object3D[]} */
        const hide = [this.controls.transform.getHelper(), this.controls.preview, this.controls.measurements, this.clearanceOverlay.group, this.layoutOverlay.group];
        if (this.controls.highlight !== null) {
            hide.push(this.controls.highlight);
        }
        /** @type {import('three').Object3D|undefined} */
        const underlay = this.world.helpers.getObjectByName('underlay');
        if (underlay !== undefined) {
            hide.push(underlay);
        }
        /** @type {string} */
        const dataUrl = await createPlanSheet({ sceneManager: this.sceneManager, controls: this.controls, world: this.world, state: this.state, analysis: this.analysis, hide });
        this.downloadDataUrl(dataUrl, `${slugify(this.state.project.name)}-planta.png`);
        this.toast.show('Folha da planta exportada.');
    }

    /**
     * @param {string} url Endereço de dados.
     * @param {string} fileName Nome do arquivo.
     */
    downloadDataUrl(url, fileName) {
        /** @type {HTMLAnchorElement} */
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }

    // #endregion
}

window.addEventListener('DOMContentLoaded', () => {
    /** @type {Logger} */
    const logger = new Logger('bootstrap');
    try {
        new App();
    } catch (error) {
        // WebGL indisponível é a falha de inicialização mais comum; o restante é erro de programação
        logger.critical('Falha ao iniciar a aplicação', { error: String(error) });
        /** @type {HTMLElement|null} */
        const fallback = document.getElementById('fatal-error');
        if (fallback !== null) {
            fallback.hidden = false;
        }
        throw error;
    }
});
