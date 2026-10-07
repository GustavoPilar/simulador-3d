/**
 * Testes unitários da lógica pura (sem navegador).
 * Executar com: node --test tests/
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CollisionWorld, createBoxCollider, pushCircleOutOfBox } from '../js/core/collision.js';
import { ProjectFormatError, ValidationError } from '../js/core/logger.js';
import { validateField, validatePatch } from '../js/core/schema.js';
import { PERIMETER_IDS, ProjectState } from '../js/core/state.js';
import { formatMeters, normalizeDegrees, parseDecimal, roundToStep, slugify } from '../js/core/units.js';

/**
 * @returns {ProjectState} Projeto 5 × 8 × 2,70 m usado na maioria dos testes.
 */
function createStudio() {
    return ProjectState.create({ name: 'Meu Studio', width: '5', length: '8', height: '2,70' });
}

describe('units', () => {
    it('aceita vírgula e ponto e rejeita textos ambíguos', () => {
        assert.equal(parseDecimal('2,70'), 2.7);
        assert.equal(parseDecimal(' 1.75 '), 1.75);
        assert.equal(parseDecimal('2.7m'), null);
        assert.equal(parseDecimal('1.2.3'), null);
        assert.equal(parseDecimal(''), null);
        assert.equal(parseDecimal(Number.NaN), null);
    });

    it('formata metros com duas casas e vírgula', () => {
        assert.equal(formatMeters(1.75), '1,75 m');
        assert.equal(formatMeters(2.5), '2,50 m');
    });

    it('normaliza ângulos e arredonda para a grade', () => {
        assert.equal(normalizeDegrees(-90), 270);
        assert.equal(normalizeDegrees(720), 0);
        assert.equal(roundToStep(0.27, 0.1), 0.3);
        assert.equal(slugify('Meu Studio Ção!'), 'meu-studio-cao');
    });
});

describe('schema', () => {
    it('valida limites e converte opções tipadas', () => {
        assert.throws(() => validateField({ key: 'w', label: 'Largura', type: 'length', min: 0.5, max: 100 }, '0'), ValidationError);
        assert.throws(() => validateField({ key: 'w', label: 'Largura', type: 'length', min: 0.5, max: 100 }, 'abc'), ValidationError);
        /** @type {Record<string, string|number|boolean>} */
        const patch = validatePatch('door', { isOpen: 'true', swing: '-1', hacked: 'x' });
        assert.deepEqual(patch, { isOpen: true, swing: -1 });
    });
});

describe('ProjectState', () => {
    it('cria o ambiente com quatro paredes externas fora da área interna', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        assert.equal(state.environment.height, 2.7);
        assert.equal(state.walls.length, 4);
        /** @type {any} */
        const south = state.getEntity('wall', PERIMETER_IDS.SOUTH);
        assert.equal(south.z, -0.075);
        assert.equal(south.length, 5.3);
    });

    it('rejeita dimensões inválidas ou absurdas', () => {
        assert.throws(() => ProjectState.create({ name: 'X', width: '-1', length: '8', height: '2.7' }), ValidationError);
        assert.throws(() => ProjectState.create({ name: 'X', width: '5', length: '5000', height: '2.7' }), ValidationError);
        assert.throws(() => ProjectState.create({ name: '', width: '5', length: '5', height: '2.7' }), ValidationError);
    });

    it('impede portas sobrepostas e fora da parede', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const first = state.addOpening('door', PERIMETER_IDS.SOUTH);
        /** @type {any} */
        const second = state.addOpening('door', PERIMETER_IDS.SOUTH);
        assert.ok(Math.abs(first.offset - second.offset) >= 0.8 - 1e-9);
        assert.throws(() => state.updateEntity('door', second.id, { offset: String(first.offset) }), ValidationError);
        assert.throws(() => state.updateEntity('door', first.id, { offset: '0.1' }), ValidationError);
        assert.throws(() => state.updateEntity('door', first.id, { height: '3' }), ValidationError);
    });

    it('calcula a posição da porta no mundo a partir da parede', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const door = state.addOpening('door', PERIMETER_IDS.WEST);
        /** @type {{x: number, z: number}|null} */
        const position = state.getOpeningWorldPosition(door);
        assert.ok(position !== null);
        assert.ok(Math.abs(position.x - -0.075) < 1e-6);
        assert.ok(Math.abs(position.z - 4) < 1e-6);
    });

    it('ajusta aberturas quando o ambiente encolhe', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const windowOpening = state.addOpening('window', PERIMETER_IDS.EAST);
        state.updateEntity('window', windowOpening.id, { offset: '7' });
        state.updateEntity('environment', null, { length: '3' });
        assert.ok(windowOpening.offset + windowOpening.width / 2 <= 3);
    });

    it('protege paredes externas e remove aberturas junto com a parede', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        assert.throws(() => state.removeEntity('wall', PERIMETER_IDS.NORTH), ValidationError);
        /** @type {any} */
        const wall = state.addWall();
        state.addOpening('door', wall.id);
        state.removeEntity('wall', wall.id);
        assert.equal(state.doors.length, 0);
    });

    it('desenha paredes entre dois pontos e cria paredes ao redor de cômodos', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const wall = state.addWallBetween(0, 4, 5, 4);
        assert.equal(wall.rotation, 0);
        assert.equal(wall.length, 5.12);
        /** @type {any} */
        const vertical = state.addWallBetween(2, 0, 2, 3);
        assert.equal(vertical.rotation, 270);
        /** @type {any} */
        const room = state.addRoom();
        assert.equal(state.createWallsAroundRoom(room.id).length, 4);
    });

    it('duplica objetos com deslocamento e notifica alterações', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {string[]} */
        const reasons = [];
        state.onChange((reason) => reasons.push(reason));
        /** @type {any} */
        const bed = state.addObject('bed');
        /** @type {any} */
        const copy = state.duplicateEntity('object', bed.id);
        assert.equal(copy.x, bed.x + 0.3);
        assert.deepEqual(reasons, ['object:add', 'object:duplicate']);
    });

    it('cria objetos personalizados validando dimensões', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const table = state.addCustomObject({ name: 'Minha mesa', width: '1,40', height: '0,75', depth: '0,60' });
        assert.equal(table.width, 1.4);
        assert.throws(() => state.addCustomObject({ name: 'X', width: '0', height: '1', depth: '1' }), ValidationError);
    });

    it('exporta e importa sem perder dados', () => {
        /** @type {ProjectState} */
        const state = createStudio();
        /** @type {any} */
        const wall = state.addWall({ rotation: 90 });
        state.addOpening('door', wall.id);
        state.addOpening('window', PERIMETER_IDS.NORTH);
        state.addObject('sofa');
        state.addRoom();
        state.updateEntity('player', null, { height: '1,60' });
        /** @type {unknown} */
        const json = JSON.parse(JSON.stringify(state.toJSON()));
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON(json);
        assert.equal(loaded.state.walls.length, 5);
        assert.equal(loaded.state.doors.length, 1);
        assert.equal(loaded.state.windows.length, 1);
        assert.equal(loaded.state.player.height, 1.6);
        assert.deepEqual(loaded.warnings, []);
    });

    it('rejeita arquivos inválidos e ignora aberturas órfãs', () => {
        assert.throws(() => ProjectState.fromJSON(null), ProjectFormatError);
        assert.throws(() => ProjectState.fromJSON({ schemaVersion: 1, project: { name: 'X' }, environment: { width: -2, length: 3, height: 2 } }), ProjectFormatError);
        /** @type {{state: ProjectState, warnings: string[]}} */
        const loaded = ProjectState.fromJSON({
            schemaVersion: 1,
            project: { name: 'X' },
            environment: { width: 3, length: 3, height: 2.5 },
            doors: [{ id: 'door-1', name: 'Porta', wallId: 'missing', offset: 1, width: 0.8, height: 2 }]
        });
        assert.equal(loaded.state.doors.length, 0);
        assert.equal(loaded.warnings.length, 1);
    });
});

describe('collision', () => {
    it('empurra o corpo para fora de uma parede girada', () => {
        /** @type {import('../js/core/collision.js').BoxCollider} */
        const wall = createBoxCollider(0, 0, 1, 0.05, Math.PI / 2, 0, 2.7);
        /** @type {{x: number, z: number, hit: boolean}} */
        const result = pushCircleOutOfBox(0.1, 0.5, 0.2, wall);
        assert.ok(result.hit);
        assert.ok(Math.abs(result.x - 0.25) < 1e-9);
        assert.ok(Math.abs(result.z - 0.5) < 1e-9);
    });

    it('não atravessa uma parede fina andando em pequenos passos', () => {
        /** @type {CollisionWorld} */
        const world = new CollisionWorld();
        world.setColliders([createBoxCollider(0, 0, 5, 0.05, 0, 0, 2.7)]);
        /** @type {{x: number, z: number}} */
        const position = { x: 0, z: -1 };
        for (let step = 0; step < 100; step += 1) {
            position.z += 0.04;
            world.resolve(position, 0.225, 0, 1.75, 0.25);
        }
        assert.ok(position.z <= -0.275 + 1e-9);
    });

    it('trata objetos baixos como chão e respeita os limites do ambiente', () => {
        /** @type {CollisionWorld} */
        const world = new CollisionWorld();
        world.setColliders([createBoxCollider(1, 1, 0.5, 0.5, 0, 0, 0.2), createBoxCollider(3, 3, 0.5, 0.5, 0, 0, 0.5)]);
        world.setBounds({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 });
        assert.equal(world.getGroundHeight(1, 1, 0.2, 0, 0.25), 0.2);
        assert.equal(world.getGroundHeight(3, 3, 0.2, 0, 0.25), 0);
        /** @type {{x: number, z: number}} */
        const position = { x: -3, z: 9 };
        world.resolve(position, 0.2, 0, 1.75, 0.25);
        assert.deepEqual(position, { x: 0.2, z: 4.8 });
    });
});
