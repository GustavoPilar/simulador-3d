/**
 * Testes das funcionalidades da versão 3 (lógica pura).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeLayout, createBox, effectiveFootprint, usageZones } from '../js/core/geometry.js';
import { LibraryStore, sanitizeLibraryItem } from '../js/core/library.js';
import { ValidationError } from '../js/core/logger.js';
import { PERIMETER_IDS, ProjectState } from '../js/core/state.js';

/**
 * @returns {ProjectState} Ambiente 4 × 4 × 2,60 m.
 */
function createRoom() {
    return ProjectState.create({ name: 'Teste', width: '4', length: '4', height: '2,6' });
}

/**
 * Parede usada como estrutura nas análises.
 * @param {number} cx Centro X.
 * @param {number} cz Centro Z.
 * @param {number} hx Meia largura.
 * @param {number} hz Meia profundidade.
 * @returns {any} Colisor de parede.
 */
function wallBox(cx, cz, hx, hz) {
    return { ...createBox(cx, cz, hx, hz, 0), yMin: 0, yMax: 2.6, ref: { type: 'wall', id: 'w' } };
}

/**
 * Cria um objeto já posicionado.
 * @param {ProjectState} state Projeto.
 * @param {string} kind Tipo.
 * @param {Record<string, string>} patch Alterações.
 * @returns {any} Objeto.
 */
function place(state, kind, patch) {
    /** @type {any} */
    const item = state.addObject(kind);
    state.updateEntity('object', item.id, patch);
    return item;
}

describe('estados e áreas de uso', () => {
    it('dá padrões por tipo e mantém a área de uso editável', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const sink = state.addObject('sink');
        assert.equal(sink.usageFront, 0.8);
        assert.equal(sink.opacity, 100);
        state.updateEntity('object', sink.id, { usageFront: '0,6' });
        assert.equal(sink.usageFront, 0.6);
        assert.equal(state.addObject('sofa').openDepth, 1.6);
    });

    it('sofá aberto avança para a frente', () => {
        /** @type {any} */
        const box = effectiveFootprint({ kind: 'sofa', x: 0, z: 0, width: 2, depth: 0.9, rotation: 0, isOpen: true, openDepth: 1.6 });
        assert.ok(Math.abs(box.cz - 0.35) < 1e-9);
        assert.ok(Math.abs(box.hz - 0.8) < 1e-9);
        assert.equal(usageZones({ kind: 'bed', x: 0, z: 0, width: 1.4, depth: 1.9, rotation: 0, usageFront: 0, usageBack: 0, usageSide: 0.5 }).length, 2);
    });
});

describe('analyzeLayout', () => {
    it('acusa sobreposição, mas aceita cadeira sob a mesa e objeto sobre outro', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const table = place(state, 'table', { x: '2', z: '2' });
        place(state, 'chair', { x: '2', z: '2,4' });
        place(state, 'box', { x: '2', z: '1,8', y: '0,75' });
        /** @type {any} */
        const bed = place(state, 'bed', { x: '2', z: '2,5' });
        /** @type {any} */
        const result = analyzeLayout(state, state.objects, []);
        assert.ok(result.conflictIds.has(bed.id));
        assert.ok(result.conflictIds.has(table.id));
        assert.equal(result.issues.filter((issue) => /Cadeira invade Mesa|Mesa invade Cadeira/.test(issue.message)).length, 0);
        assert.equal(result.issues.filter((issue) => issue.message.includes('Caixa')).length, 0);
    });

    it('acusa objeto atravessando parede, mas não objeto encostado', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        place(state, 'box', { x: '1', z: '0,25' });
        /** @type {any} */
        const inside = place(state, 'box', { x: '3', z: '0,1' });
        /** @type {any} */
        const result = analyzeLayout(state, state.objects, [wallBox(2, -0.075, 2.2, 0.075), wallBox(3, 0.05, 0.5, 0.05)]);
        assert.deepEqual([...result.conflictIds], [inside.id]);
    });

    it('verifica áreas de uso, inclusive o sofá aberto e a lateral da cama', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const sofa = place(state, 'sofa', { x: '2', z: '0,5', depth: '0,9' });
        /** @type {Array<any>} */
        const structure = [wallBox(2, 2.0, 2, 0.05)];
        assert.ok(!analyzeLayout(state, state.objects, structure).usageFailures.has(sofa.id));
        state.updateEntity('object', sofa.id, { isOpen: 'true' });
        /** @type {any} */
        const opened = analyzeLayout(state, state.objects, structure);
        assert.ok(opened.usageFailures.get(sofa.id)?.has('front'));
        /** @type {any} */
        const bed = place(state, 'bed', { x: '1', z: '3' });
        /** @type {any} */
        const cramped = analyzeLayout(state, state.objects, [wallBox(0.1, 3, 0.1, 1), wallBox(1.9, 3, 0.1, 1)]);
        assert.ok(cramped.usageFailures.get(bed.id)?.has('side'));
        assert.ok(opened.freeArea < 16);
    });
});

describe('arrumações', () => {
    it('cria, alterna, renomeia e exclui mantendo os objetos de cada uma', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        state.addObject('bed');
        /** @type {any} */
        const second = state.createLayout('Sem mesa');
        state.addObject('table');
        assert.equal(state.objects.length, 2);
        state.switchLayout('layout-1');
        assert.equal(state.objects.length, 1);
        state.switchLayout(second.id);
        assert.equal(state.objects.length, 2);
        state.renameLayout(second.id, 'Com mesa');
        assert.equal(state.getActiveLayout().name, 'Com mesa');
        state.deleteLayout(second.id);
        assert.equal(state.objects.length, 1);
        assert.throws(() => state.deleteLayout('layout-1'), ValidationError);
    });

    it('salva e restaura arrumações, aparência e estado; espelha todas as arrumações', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        place(state, 'bed', { x: '1' });
        state.createLayout('B');
        /** @type {any} */
        const sofa = place(state, 'sofa', { x: '3', isOpen: 'true', opacity: '40' });
        state.updateEntity('object', sofa.id, { hidden: true });
        state.updateEntity('wall', PERIMETER_IDS.NORTH, { opacity: '30' });
        state.updateEntity('environment', null, { height: '2,8' });
        assert.equal(/** @type {any} */ (state.getEntity('wall', PERIMETER_IDS.NORTH)).opacity, 30);
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));
        assert.equal(loaded.state.layouts.length, 2);
        assert.equal(loaded.state.activeLayoutId, state.activeLayoutId);
        /** @type {any} */
        const restored = loaded.state.objects.find((item) => item.kind === 'sofa');
        assert.equal(restored.isOpen, true);
        assert.equal(restored.hidden, true);
        assert.equal(/** @type {any} */ (loaded.state.getEntity('wall', PERIMETER_IDS.NORTH)).opacity, 30);
        state.mirror('x');
        assert.equal(sofa.x, 1);
        assert.equal(state.layouts[0].objects[0].x, 3);
    });

    it('abre arquivos da v2 com uma única arrumação', () => {
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON({ schemaVersion: 2, project: { name: 'X' }, environment: { width: 3, length: 3, height: 2.6 }, objects: [{ kind: 'sink', name: 'Pia', width: 1.2, depth: 0.55, height: 0.9, x: 1, y: 0, z: 1, rotation: 0, color: '#ffffff' }] });
        assert.equal(loaded.state.layouts.length, 1);
        assert.equal(loaded.state.objects[0].usageFront, 0.8);
    });
});

describe('LibraryStore', () => {
    it('guarda, recarrega, exporta e importa itens válidos', () => {
        /** @type {Map<string, string>} */
        const memory = new Map();
        /** @type {any} */
        const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
        /** @type {LibraryStore} */
        const library = new LibraryStore(storage);
        library.add({ kind: 'bed', name: 'Minha cama', width: 1.38, depth: 1.88, height: 0.55, x: 9, usageSide: 0.5 });
        /** @type {LibraryStore} */
        const reloaded = new LibraryStore(storage);
        assert.equal(reloaded.items.length, 1);
        assert.equal(reloaded.items[0].x, undefined);
        assert.equal(reloaded.importJSON({ items: [{ name: 'Violão', width: 0.38, depth: 0.1, height: 1 }, { name: 'Ruim', width: -1 }] }), 1);
        assert.throws(() => reloaded.importJSON({}), ValidationError);
        assert.equal(sanitizeLibraryItem({ name: 'X', width: 1, height: 1, depth: 1, kind: 'nave' })?.kind, 'custom');
        /** @type {ProjectState} */
        const state = createRoom();
        assert.equal(state.addLibraryObject(reloaded.items[0]).name, 'Minha cama');
    });
});
