/**
 * Testes das funcionalidades da versão 2 (lógica pura).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { analyzeLayout, boxesOverlap, createBox, doorSwingBox, footprintOf, measureClearances, rayBoxDistance, snapToWalls, wallSnapGeometry } from '../js/core/geometry.js';
import { History } from '../js/core/history.js';
import { ValidationError } from '../js/core/logger.js';
import { PERIMETER_IDS, ProjectState } from '../js/core/state.js';

/** Imagem mínima válida usada como planta de fundo. */
const TINY_IMAGE = { name: 'planta.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', pixelWidth: 1000, pixelHeight: 500 };

/**
 * @returns {ProjectState} Ambiente 4 × 6 × 2,70 m.
 */
function createRoom() {
    return ProjectState.create({ name: 'Teste', width: '4', length: '6', height: '2,7' });
}

/**
 * @param {number} actual Valor obtido.
 * @param {number} expected Valor esperado.
 */
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
}

describe('geometry', () => {
    it('mede a distância de um raio até uma caixa girada', () => {
        near(rayBoxDistance(0, 0, 1, 0, createBox(3, 0, 0.5, 0.5, 0)), 2.5);
        near(rayBoxDistance(0, 0, 1, 0, createBox(3, 0, 0.5, 1, Math.PI / 2)), 2);
        assert.equal(rayBoxDistance(0, 0, -1, 0, createBox(3, 0, 0.5, 0.5, 0)), Infinity);
        near(rayBoxDistance(3, 0, 1, 0, createBox(3, 0, 0.5, 0.5, 0)), 0);
    });

    it('detecta sobreposição e ignora caixas que só se encostam', () => {
        assert.ok(boxesOverlap(createBox(0, 0, 1, 1, 0), createBox(1.5, 0, 1, 1, Math.PI / 4)));
        assert.ok(!boxesOverlap(createBox(0, 0, 1, 1, 0), createBox(2, 0, 1, 1, 0)));
    });

    it('mede folgas nos quatro lados de um objeto', () => {
        /** @type {Record<string, any>} */
        const clearances = measureClearances(footprintOf({ x: 0, z: 0, width: 2, depth: 1, rotation: 0 }), [
            createBox(0, 2, 5, 0.1, 0),
            createBox(0, -1.5, 5, 1, 0)
        ]);
        near(clearances.front.distance, 1.4);
        near(clearances.back.distance, 0);
        assert.equal(clearances.left, null);
    });

    it('encaixa em cantos antes de faces', () => {
        /** @type {any} */
        const targets = wallSnapGeometry([{ x: 0, z: 0, length: 2, thickness: 0.1, rotation: 0 }]);
        /** @type {any} */
        const corner = snapToWalls({ x: 1.02, z: 0.06 }, targets, 0.1);
        assert.equal(corner.kind, 'corner');
        near(corner.point.x, 1);
        /** @type {any} */
        const face = snapToWalls({ x: 0.3, z: 0.09 }, targets, 0.1);
        assert.equal(face.kind, 'face');
        near(face.point.z, 0.05);
        assert.equal(snapToWalls({ x: 0.3, z: 1 }, targets, 0.1).kind, null);
    });

    it('aponta porta que bate em móvel e passagem estreita', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const door = state.addOpening('door', PERIMETER_IDS.SOUTH);
        /** @type {any} */
        const swing = doorSwingBox(state.getEntity('wall', PERIMETER_IDS.SOUTH), door);
        near(swing.cz, 0.4);
        /** @type {any} */
        const box = state.addObject('box');
        state.updateEntity('object', box.id, { x: '2', z: '0,5' });
        /** @type {any} */
        const fridge = state.addObject('fridge');
        state.updateEntity('object', fridge.id, { x: '3', z: '1,2' });
        /** @type {string[]} */
        const issues = analyzeLayout(state, state.objects, [{ ...createBox(3, 2.0, 1, 0.1, 0), yMin: 0, yMax: 2.7, ref: { type: 'wall', id: 'x' } }]).issues.map((issue) => issue.message);
        assert.ok(issues.some((issue) => issue.includes('não abre por completo')));
        assert.ok(issues.some((issue) => issue.includes('livres à frente')));
    });
});

describe('History', () => {
    it('desfaz e refaz, descartando o futuro ao registrar', () => {
        /** @type {History} */
        const history = new History(2);
        history.reset('a');
        assert.ok(history.record('b'));
        assert.ok(!history.record('b'));
        history.record('c');
        history.record('d');
        assert.deepEqual(history.past, ['b', 'c']);
        assert.equal(history.undo(), 'c');
        assert.equal(history.redo(), 'd');
        history.undo();
        history.record('e');
        assert.ok(!history.canRedo());
    });
});

describe('ProjectState v2', () => {
    it('posiciona aberturas pelas folgas e informa as pontas da parede', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const door = state.addOpening('door', PERIMETER_IDS.SOUTH);
        state.updateEntity('door', door.id, { gapStart: '0,3' });
        /** @type {any} */
        const gaps = state.getOpeningGaps(door);
        near(gaps.gapStart, 0.3);
        near(gaps.gapEnd, 4 - 0.3 - 0.8);
        near(gaps.start.x, 0);
        state.updateEntity('door', door.id, { gapEnd: '0' });
        near(state.getOpeningWorldPosition(door).x, 3.6);
    });

    it('espelha mantendo aberturas nas paredes certas e é reversível', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const door = state.addOpening('door', PERIMETER_IDS.WEST);
        state.updateEntity('door', door.id, { offset: '1' });
        /** @type {any} */
        const wall = state.addWall({ x: 1, z: 2, rotation: 30 });
        /** @type {any} */
        const inner = state.addOpening('door', wall.id);
        /** @type {any} */
        const sofa = state.addObject('sofa');
        state.updateEntity('object', sofa.id, { x: '1', rotation: '90' });
        /** @type {{x: number, z: number}} */
        const before = state.getOpeningWorldPosition(door);
        /** @type {{x: number, z: number}} */
        const innerBefore = state.getOpeningWorldPosition(inner);
        state.mirror('x');
        assert.equal(door.wallId, PERIMETER_IDS.EAST);
        assert.equal(door.hinge, 'right');
        assert.equal(inner.swing, -1);
        near(state.getOpeningWorldPosition(door).z, before.z);
        near(state.getOpeningWorldPosition(inner).x, 4 - innerBefore.x);
        near(state.getOpeningWorldPosition(inner).z, innerBefore.z);
        assert.equal(sofa.x, 3);
        assert.equal(sofa.rotation, 270);
        state.mirror('x');
        assert.equal(door.wallId, PERIMETER_IDS.WEST);
        assert.equal(door.offset, 1);
        assert.equal(wall.rotation, 30);
    });

    it('gira 180° trocando paredes opostas', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        /** @type {any} */
        const windowOpening = state.addOpening('window', PERIMETER_IDS.SOUTH);
        state.updateEntity('window', windowOpening.id, { gapStart: '0,5' });
        state.rotate180();
        assert.equal(windowOpening.wallId, PERIMETER_IDS.NORTH);
        near(state.getOpeningWorldPosition(windowOpening).x, 4 - 1.1);
    });

    it('calibra e alinha a planta de fundo', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        assert.throws(() => state.calibrateUnderlay({ x: 0, z: 0 }, { x: 1, z: 0 }, 2), ValidationError);
        state.setUnderlay(TINY_IMAGE);
        /** @type {any} */
        const underlay = state.underlay;
        underlay.x = 0;
        underlay.z = 0;
        underlay.width = 10;
        state.calibrateUnderlay({ x: 1, z: 0 }, { x: 3, z: 0 }, 1);
        near(underlay.width, 5);
        near(underlay.x, 0.5);
        state.alignUnderlay({ x: 0.5, z: -1 });
        near(underlay.x, 0);
        near(underlay.z, 1);
        assert.throws(() => state.calibrateUnderlay({ x: 0, z: 0 }, { x: 0, z: 0 }, 1), ValidationError);
    });

    it('exporta a planta, mas o histórico não a inclui', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        state.setUnderlay(TINY_IMAGE);
        assert.ok('underlay' in state.toJSON());
        assert.ok(!('underlay' in state.toJSON({ includeUnderlay: false })));
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON(JSON.parse(JSON.stringify(state.toJSON())));
        assert.equal(loaded.state.underlay?.pixelWidth, 1000);
        /** @type {{state: ProjectState, warnings: string[]}} */
        const broken = ProjectState.fromJSON({ ...state.toJSON(), underlay: { dataUrl: 'javascript:alert(1)' } });
        assert.equal(broken.state.underlay, null);
        assert.equal(broken.warnings.length, 1);
    });

    it('restaura instantâneos preservando ouvintes e planta', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        state.setUnderlay(TINY_IMAGE);
        /** @type {string} */
        const snapshot = JSON.stringify(state.toJSON({ includeUnderlay: false, includeTimestamp: false }));
        state.addObject('bed');
        /** @type {string[]} */
        const reasons = [];
        state.onChange((reason) => reasons.push(reason));
        state.replaceWith(ProjectState.fromJSON(JSON.parse(snapshot)).state);
        assert.equal(state.objects.length, 0);
        assert.ok(state.underlay !== null);
        assert.deepEqual(reasons, ['history:restore']);
    });

    it('instala pontos no teto e pilares até o teto', () => {
        /** @type {ProjectState} */
        const state = createRoom();
        near(state.addObject('light').y, 2.7 - 0.04);
        near(state.addObject('column').height, 2.7);
    });

    it('carrega o exemplo do studio 1610 sem avisos', () => {
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON(JSON.parse(readFileSync(new URL('../examples/studio-1610.json', import.meta.url), 'utf8')));
        assert.deepEqual(loaded.warnings, []);
        near(loaded.state.getOpeningWorldPosition(loaded.state.doors[0]).x, 1.22);
    });
});
