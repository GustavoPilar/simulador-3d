/**
 * Estado do projeto, totalmente independente do Three.js.
 * Toda alteração passa por validação e dispara uma notificação para que a cena seja reconstruída.
 */
import {
    CUSTOM_OBJECT_COLOR,
    DEFAULT_DOOR,
    DEFAULT_ENVIRONMENT,
    DEFAULT_PLAYER,
    DEFAULT_SETTINGS,
    DEFAULT_WALL,
    DEFAULT_SOFA_OPEN_DEPTH,
    DEFAULT_WINDOW,
    MAX_LAYOUTS,
    OBJECT_CATALOG,
    OPENING_MARGIN,
    ROOM_COLORS,
    SCHEMA_VERSION,
    STATEFUL_KINDS,
    USAGE_DEFAULTS
} from './config.js';
import { ProjectFormatError, ValidationError } from './logger.js';
import { validatePatch } from './schema.js';
import { clamp, createId, normalizeDegrees, roundMillimeters, roundToStep } from './units.js';

/**
 * @typedef {Object} Underlay
 * @property {string} name Nome do arquivo de origem.
 * @property {string} dataUrl Imagem codificada (data:image/...).
 * @property {number} pixelWidth Largura da imagem em pixels.
 * @property {number} pixelHeight Altura da imagem em pixels.
 * @property {number} x Centro X da imagem no piso.
 * @property {number} z Centro Z da imagem no piso.
 * @property {number} width Largura da imagem em metros (define a escala).
 * @property {number} rotation Rotação em graus.
 * @property {number} opacity Opacidade (5 a 100).
 * @property {boolean} visible Visibilidade.
 * @property {boolean} flipX Espelhada no eixo X.
 * @property {boolean} flipZ Espelhada no eixo Z.
 */

/**
 * @typedef {Object} Layout
 * @property {string} id
 * @property {string} name
 * @property {SceneObject[]} objects Objetos da arrumação (desatualizados enquanto ela está ativa; use syncActiveLayout()).
 */

/**
 * Campos da versão 3 de um objeto: estado, áreas de uso e aparência, com padrões por tipo.
 * @param {string} kind Tipo visual.
 * @param {number} depth Profundidade do objeto.
 * @returns {Record<string, number|boolean>} Valores padrão.
 */
export function objectExtras(kind, depth) {
    /** @type {{usageFront: number, usageBack: number, usageSide: number}} */
    const usage = /** @type {any} */ (USAGE_DEFAULTS)[kind] ?? { usageFront: 0, usageBack: 0, usageSide: 0 };
    return {
        isOpen: false,
        openDepth: kind === 'sofa' ? Math.max(depth, DEFAULT_SOFA_OPEN_DEPTH) : depth,
        ...usage,
        opacity: 100,
        hidden: false
    };
}

/** Tamanho máximo aceito para a imagem da planta embutida no projeto. */
const MAX_UNDERLAY_CHARS = 40 * 1024 * 1024;

/**
 * @typedef {Object} Wall
 * @property {string} id
 * @property {string} name
 * @property {number} length Comprimento ao longo do X local.
 * @property {number} height
 * @property {number} thickness
 * @property {number} x Centro da parede.
 * @property {number} y Base da parede.
 * @property {number} z Centro da parede.
 * @property {number} rotation Graus em torno de Y.
 * @property {boolean} perimeter Verdadeiro para as quatro paredes externas geradas pelo ambiente.
 */

/**
 * @typedef {Object} Door
 * @property {string} id
 * @property {string} name
 * @property {string} wallId Parede hospedeira.
 * @property {number} offset Distância do início da parede até o centro da porta.
 * @property {number} width
 * @property {number} height
 * @property {number} thickness
 * @property {boolean} isOpen
 * @property {'left'|'right'} hinge
 * @property {1|-1} swing Lado para o qual a folha abre (+Z ou -Z local da parede).
 */

/**
 * @typedef {Object} WindowOpening
 * @property {string} id
 * @property {string} name
 * @property {string} wallId
 * @property {number} offset
 * @property {number} width
 * @property {number} height
 * @property {number} sillHeight Altura do peitoril em relação à base da parede.
 */

/**
 * @typedef {Object} SceneObject
 * @property {string} id
 * @property {string} kind Tipo visual (cama, sofá, ... ou "custom").
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {number} depth
 * @property {number} x
 * @property {number} y Elevação da base.
 * @property {number} z
 * @property {number} rotation
 * @property {string} color
 */

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name
 * @property {number} width
 * @property {number} length
 * @property {number} x
 * @property {number} z
 * @property {string} color
 */

/** @typedef {'wall'|'door'|'window'|'object'|'room'} EntityType */

/** Mapeia cada tipo de entidade para sua coleção no estado. */
export const COLLECTION_BY_TYPE = Object.freeze({
    wall: 'walls',
    door: 'doors',
    window: 'windows',
    object: 'objects',
    room: 'rooms'
});

/** Identificadores fixos das paredes externas: aberturas nelas sobrevivem a mudanças de dimensão. */
export const PERIMETER_IDS = Object.freeze({
    SOUTH: 'perimeter-south',
    NORTH: 'perimeter-north',
    WEST: 'perimeter-west',
    EAST: 'perimeter-east'
});

/** Tipos visuais aceitos para objetos. */
const VALID_KINDS = new Set([...OBJECT_CATALOG.map((item) => item.kind), 'custom']);

/** Formato aceito para identificadores vindos de arquivos importados. */
const ID_PATTERN = /^[\w-]{1,80}$/;

export class ProjectState {
    // #region Construtores :: constructor(), create(), fromJSON()

    /**
     * Cria um estado vazio. Prefira {@link ProjectState.create} ou {@link ProjectState.fromJSON}.
     */
    constructor() {
        /** @type {{name: string}} */
        this.project = { name: 'Novo projeto' };
        /** @type {{width: number, length: number, height: number, wallThickness: number}} */
        this.environment = { ...DEFAULT_ENVIRONMENT };
        /** @type {typeof DEFAULT_PLAYER & {spawnX: number, spawnZ: number, spawnRotation: number}} */
        this.player = { ...DEFAULT_PLAYER, spawnX: 0, spawnZ: 0, spawnRotation: 0 };
        /** @type {typeof DEFAULT_SETTINGS} */
        this.settings = { ...DEFAULT_SETTINGS };
        /** @type {Wall[]} */
        this.walls = [];
        /** @type {Door[]} */
        this.doors = [];
        /** @type {WindowOpening[]} */
        this.windows = [];
        /** @type {SceneObject[]} */
        this.objects = [];
        /** @type {Room[]} */
        this.rooms = [];
        /** @type {Underlay|null} */
        this.underlay = null;
        /** @type {Layout[]} Arrumações (variações de mobília); a ativa usa this.objects. */
        this.layouts = [{ id: 'layout-1', name: 'Arrumação 1', objects: [] }];
        /** @type {string} */
        this.activeLayoutId = 'layout-1';
        /** @type {Set<(reason: string) => void>} */
        this.listeners = new Set();
    }

    /**
     * Cria um projeto novo a partir dos dados da tela inicial.
     * @param {{name: unknown, width: unknown, length: unknown, height: unknown}} input Valores brutos digitados.
     * @returns {ProjectState} Projeto pronto para edição.
     * @throws {ValidationError} Quando algum campo é inválido.
     */
    static create(input) {
        /** @type {Record<string, unknown>} */
        const required = { name: input.name, width: input.width, length: input.length, height: input.height };
        for (const [key, value] of Object.entries(required)) {
            if (value === undefined || value === null || String(value).trim() === '') {
                throw new ValidationError('Preencha todos os campos.', key);
            }
        }
        /** @type {Record<string, string|number|boolean>} */
        const valid = validatePatch('environment', required);
        /** @type {ProjectState} */
        const state = new ProjectState();
        state.project.name = /** @type {string} */ (valid.name);
        state.environment.width = /** @type {number} */ (valid.width);
        state.environment.length = /** @type {number} */ (valid.length);
        state.environment.height = /** @type {number} */ (valid.height);
        state.rebuildPerimeterWalls();
        state.resetSpawn();
        return state;
    }

    /**
     * Reconstrói um projeto a partir de um JSON exportado, validando cada entidade.
     * @param {unknown} raw Objeto lido do arquivo.
     * @returns {{state: ProjectState, warnings: string[]}} Estado e avisos de itens descartados.
     * @throws {ProjectFormatError} Quando o arquivo não é um projeto válido.
     */
    static fromJSON(raw) {
        if (raw === null || typeof raw !== 'object') {
            throw new ProjectFormatError('O arquivo não contém um projeto.');
        }
        /** @type {Record<string, any>} */
        const data = /** @type {Record<string, any>} */ (raw);
        if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
            throw new ProjectFormatError('Versão de arquivo não suportada.');
        }
        /** @type {string[]} */
        const warnings = [];
        try {
            /** @type {ProjectState} */
            const state = ProjectState.create({
                name: data.project?.name,
                width: data.environment?.width,
                length: data.environment?.length,
                height: data.environment?.height
            });
            if (data.environment?.wallThickness !== undefined) {
                state.applyPatch('environment', validatePatch('environment', { wallThickness: data.environment.wallThickness }));
            }
            if (data.player !== undefined) {
                Object.assign(state.player, validatePatch('player', data.player));
            }
            if (data.settings !== undefined) {
                Object.assign(state.settings, validatePatch('settings', data.settings));
            }
            state.importCollection('wall', data.walls, warnings);
            state.importPerimeterStyles(data.perimeterStyles);
            state.importLayouts(data, warnings);
            state.importCollection('room', data.rooms, warnings);
            state.importCollection('door', data.doors, warnings);
            state.importCollection('window', data.windows, warnings);
            state.importUnderlay(data.underlay, warnings);
            return { state, warnings };
        } catch (error) {
            if (error instanceof ValidationError) {
                throw new ProjectFormatError(`Arquivo inválido. ${error.message}`);
            }
            throw error;
        }
    }

    // #endregion

    // #region Eventos :: onChange(), emit()

    /**
     * Registra um ouvinte de alterações.
     * @param {(reason: string) => void} listener Função chamada após cada alteração.
     * @returns {() => void} Função que cancela o registro.
     */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * @param {string} reason Descrição curta da alteração.
     */
    emit(reason) {
        for (const listener of this.listeners) {
            listener(reason);
        }
    }

    // #endregion

    // #region Consultas :: getCollection(), getEntity(), getOpenings(), getOpeningWorldPosition()

    /**
     * @param {EntityType} type Tipo da entidade.
     * @returns {Array<any>} Coleção correspondente.
     * @throws {ValidationError} Para tipos desconhecidos.
     */
    getCollection(type) {
        /** @type {string|undefined} */
        const key = COLLECTION_BY_TYPE[type];
        if (key === undefined) {
            throw new ValidationError(`Tipo desconhecido: ${type}.`);
        }
        return /** @type {Array<any>} */ (this[/** @type {keyof ProjectState} */ (key)]);
    }

    /**
     * @param {EntityType} type Tipo da entidade.
     * @param {string} id Identificador.
     * @returns {any|null} Entidade ou null.
     */
    getEntity(type, id) {
        return this.getCollection(type).find((item) => item.id === id) ?? null;
    }

    /**
     * Lista as portas e janelas de uma parede.
     * @param {string} wallId Parede.
     * @returns {Array<{type: 'door'|'window', data: Door|WindowOpening}>} Aberturas.
     */
    getOpenings(wallId) {
        /** @type {Array<{type: 'door'|'window', data: Door|WindowOpening}>} */
        const doors = this.doors.filter((door) => door.wallId === wallId).map((door) => ({ type: /** @type {'door'} */ ('door'), data: door }));
        /** @type {Array<{type: 'door'|'window', data: Door|WindowOpening}>} */
        const windows = this.windows.filter((item) => item.wallId === wallId).map((item) => ({ type: /** @type {'window'} */ ('window'), data: item }));
        return [...doors, ...windows];
    }

    /**
     * Calcula a posição do centro de uma abertura no mundo (útil para exibição no painel).
     * @param {Door|WindowOpening} opening Abertura.
     * @returns {{x: number, z: number}|null} Coordenadas ou null se a parede não existir.
     */
    getOpeningWorldPosition(opening) {
        /** @type {Wall|null} */
        const wall = this.getEntity('wall', opening.wallId);
        if (wall === null) {
            return null;
        }
        /** @type {number} */
        const local = opening.offset - wall.length / 2;
        /** @type {number} */
        const angle = (wall.rotation * Math.PI) / 180;
        // O eixo X local de um objeto girado θ em torno de Y aponta para (cos θ, -sen θ) no plano XZ
        return { x: wall.x + local * Math.cos(angle), z: wall.z - local * Math.sin(angle) };
    }

    // #endregion

    // #region Criação :: addWall(), addWallBetween(), addOpening(), addObject(), addCustomObject(), addRoom(), createWallsAroundRoom()

    /**
     * Adiciona uma parede interna.
     * @param {Partial<Wall>} [partial] Valores iniciais.
     * @returns {Wall} Parede criada.
     */
    addWall(partial = {}) {
        /** @type {Wall} */
        const wall = {
            id: createId('wall'),
            name: this.nextName('Parede', this.walls.filter((item) => !item.perimeter)),
            length: Math.min(DEFAULT_WALL.length, this.environment.width),
            height: this.environment.height,
            thickness: DEFAULT_WALL.thickness,
            x: roundMillimeters(this.environment.width / 2),
            y: 0,
            z: roundMillimeters(this.environment.length / 2),
            rotation: 0,
            opacity: 100,
            hidden: false,
            ...partial,
            perimeter: false
        };
        this.walls.push(wall);
        this.emit('wall:add');
        return wall;
    }

    /**
     * Adiciona uma parede entre dois pontos do piso (ferramenta de desenho).
     * O comprimento é estendido pela espessura para que paredes encadeadas se encontrem nos cantos.
     * @param {number} ax X inicial.
     * @param {number} az Z inicial.
     * @param {number} bx X final.
     * @param {number} bz Z final.
     * @returns {Wall|null} Parede criada ou null se os pontos forem praticamente iguais.
     */
    addWallBetween(ax, az, bx, bz) {
        /** @type {number} */
        const dx = bx - ax;
        /** @type {number} */
        const dz = bz - az;
        /** @type {number} */
        const distance = Math.hypot(dx, dz);
        if (distance < 0.05) {
            return null;
        }
        return this.addWall({
            length: roundMillimeters(distance + DEFAULT_WALL.thickness),
            x: roundMillimeters((ax + bx) / 2),
            z: roundMillimeters((az + bz) / 2),
            rotation: normalizeDegrees((Math.atan2(-dz, dx) * 180) / Math.PI)
        });
    }

    /**
     * Adiciona uma porta ou janela em uma parede, procurando o espaço livre mais próximo do centro.
     * @param {'door'|'window'} type Tipo da abertura.
     * @param {string} [wallId] Parede hospedeira; por padrão, a parede externa sul.
     * @returns {Door|WindowOpening} Abertura criada.
     * @throws {ValidationError} Quando não há espaço livre na parede.
     */
    addOpening(type, wallId = PERIMETER_IDS.SOUTH) {
        /** @type {Wall|null} */
        const wall = this.getEntity('wall', wallId);
        if (wall === null) {
            throw new ValidationError('Selecione uma parede válida.');
        }
        /** @type {Door|WindowOpening} */
        const opening = type === 'door' ? this.createDoorDefaults(wall) : this.createWindowDefaults(wall);
        opening.offset = this.findFreeOffset(wall, opening.width, '');
        this.getCollection(type).push(opening);
        this.emit(`${type}:add`);
        return opening;
    }

    /**
     * Adiciona um objeto do catálogo no centro do ambiente.
     * @param {string} kind Tipo do catálogo.
     * @returns {SceneObject} Objeto criado.
     * @throws {ValidationError} Para tipos inexistentes.
     */
    addObject(kind) {
        /** @type {(typeof OBJECT_CATALOG)[number]|undefined} */
        const preset = OBJECT_CATALOG.find((item) => item.kind === kind);
        if (preset === undefined) {
            throw new ValidationError(`Objeto desconhecido: ${kind}.`);
        }
        /** @type {string|undefined} */
        const mount = /** @type {any} */ (preset).mount;
        /** @type {number} */
        const height = mount === 'full' ? this.environment.height : preset.height;
        return this.pushObject({
            kind: preset.kind,
            name: preset.name,
            width: preset.width,
            height,
            depth: preset.depth,
            y: mount === 'ceiling' ? roundMillimeters(this.environment.height - preset.height) : preset.y,
            color: preset.color
        });
    }

    /**
     * Adiciona um bloco com dimensões livres.
     * @param {{name: unknown, width: unknown, height: unknown, depth: unknown}} input Valores brutos.
     * @returns {SceneObject} Objeto criado.
     * @throws {ValidationError} Quando algum valor é inválido.
     */
    addCustomObject(input) {
        /** @type {Record<string, string|number|boolean>} */
        const valid = validatePatch('object', {
            name: input.name ?? '',
            width: input.width ?? '',
            height: input.height ?? '',
            depth: input.depth ?? ''
        });
        return this.pushObject({
            kind: 'custom',
            name: /** @type {string} */ (valid.name),
            width: /** @type {number} */ (valid.width),
            height: /** @type {number} */ (valid.height),
            depth: /** @type {number} */ (valid.depth),
            y: 0,
            color: CUSTOM_OBJECT_COLOR
        });
    }

    /**
     * Adiciona um cômodo (zona nomeada do piso).
     * @returns {Room} Cômodo criado.
     */
    addRoom() {
        /** @type {Room} */
        const room = {
            id: createId('room'),
            name: this.nextName('Cômodo', this.rooms),
            width: Math.min(3, this.environment.width),
            length: Math.min(3, this.environment.length),
            x: roundMillimeters(this.environment.width / 2),
            z: roundMillimeters(this.environment.length / 2),
            color: ROOM_COLORS[this.rooms.length % ROOM_COLORS.length]
        };
        this.rooms.push(room);
        this.emit('room:add');
        return room;
    }

    /**
     * Cria quatro paredes internas no contorno de um cômodo.
     * @param {string} roomId Cômodo.
     * @returns {Wall[]} Paredes criadas.
     * @throws {ValidationError} Quando o cômodo não existe.
     */
    createWallsAroundRoom(roomId) {
        /** @type {Room|null} */
        const room = this.getEntity('room', roomId);
        if (room === null) {
            throw new ValidationError('Cômodo não encontrado.');
        }
        /** @type {number} */
        const t = DEFAULT_WALL.thickness;
        /** @type {Array<Partial<Wall>>} */
        const specs = [
            // Paredes em X cobrem os cantos; paredes em Z encaixam entre elas
            { x: room.x, z: room.z - room.length / 2, length: room.width + t, rotation: 0 },
            { x: room.x, z: room.z + room.length / 2, length: room.width + t, rotation: 0 },
            { x: room.x - room.width / 2, z: room.z, length: Math.max(0.05, room.length - t), rotation: 90 },
            { x: room.x + room.width / 2, z: room.z, length: Math.max(0.05, room.length - t), rotation: 90 }
        ];
        /** @type {Wall[]} */
        const created = specs.map((spec, index) => {
            /** @type {Wall} */
            const wall = {
                id: createId('wall'),
                name: `${room.name} - parede ${index + 1}`,
                height: this.environment.height,
                thickness: t,
                y: 0,
                opacity: 100,
                hidden: false,
                ...spec,
                x: roundMillimeters(/** @type {number} */ (spec.x)),
                z: roundMillimeters(/** @type {number} */ (spec.z)),
                length: roundMillimeters(/** @type {number} */ (spec.length)),
                rotation: /** @type {number} */ (spec.rotation),
                perimeter: false
            };
            this.walls.push(wall);
            return wall;
        });
        this.emit('room:walls');
        return created;
    }

    // #endregion

    // #region Edição :: updateEntity(), removeEntity(), duplicateEntity()

    /**
     * Valida e aplica alterações a uma entidade, ao ambiente, ao personagem ou às preferências.
     * @param {EntityType|'environment'|'player'|'settings'|'underlay'} type Alvo.
     * @param {string|null} id Identificador (ignorado para alvos únicos).
     * @param {Record<string, unknown>} rawPatch Alterações brutas.
     * @throws {ValidationError} Quando algum valor é inválido; nesse caso nada é alterado.
     */
    updateEntity(type, id, rawPatch) {
        /** @type {Record<string, string|number|boolean>} */
        const patch = validatePatch(type, rawPatch);
        if (Object.keys(patch).length === 0) {
            return;
        }
        if (type === 'underlay') {
            if (this.underlay === null) {
                throw new ValidationError('Nenhuma planta de fundo carregada.');
            }
            Object.assign(this.underlay, patch);
        } else if (type === 'environment' || type === 'player' || type === 'settings') {
            this.applyPatch(type, patch);
        } else {
            this.applyEntityPatch(type, /** @type {string} */ (id), patch);
        }
        this.emit(`${type}:update`);
    }

    /**
     * Remove uma entidade. Remover uma parede remove também suas portas e janelas.
     * @param {EntityType} type Tipo.
     * @param {string} id Identificador.
     * @throws {ValidationError} Ao tentar remover uma parede externa.
     */
    removeEntity(type, id) {
        /** @type {any|null} */
        const entity = this.getEntity(type, id);
        if (entity === null) {
            return;
        }
        if (type === 'wall' && entity.perimeter) {
            throw new ValidationError('As paredes externas fazem parte do ambiente e não podem ser excluídas.');
        }
        /** @type {Array<any>} */
        const collection = this.getCollection(type);
        collection.splice(collection.indexOf(entity), 1);
        if (type === 'wall') {
            this.doors = this.doors.filter((door) => door.wallId !== id);
            this.windows = this.windows.filter((item) => item.wallId !== id);
        }
        this.emit(`${type}:remove`);
    }

    /**
     * Duplica uma entidade, deslocando a cópia para que fique visível.
     * @param {EntityType} type Tipo.
     * @param {string} id Identificador.
     * @returns {any} Cópia criada.
     * @throws {ValidationError} Para paredes externas ou quando não há espaço para a abertura.
     */
    duplicateEntity(type, id) {
        /** @type {any|null} */
        const source = this.getEntity(type, id);
        if (source === null) {
            throw new ValidationError('Elemento não encontrado.');
        }
        if (type === 'wall' && source.perimeter) {
            throw new ValidationError('Paredes externas não podem ser duplicadas. Use "+ Parede".');
        }
        /** @type {any} */
        const copy = { ...source, id: createId(type), name: `${source.name} (cópia)` };
        if (type === 'door' || type === 'window') {
            /** @type {Wall} */
            const wall = /** @type {Wall} */ (this.getEntity('wall', source.wallId));
            copy.offset = this.findFreeOffset(wall, source.width, '');
        } else {
            copy.x = roundMillimeters(source.x + 0.3);
            copy.z = roundMillimeters(source.z + 0.3);
        }
        this.getCollection(type).push(copy);
        this.emit(`${type}:duplicate`);
        return copy;
    }

    // #endregion

    // #region Serialização :: toJSON(), importCollection()

    /**
     * Gera o objeto serializável do projeto. As paredes externas não são salvas porque derivam do ambiente.
     * @param {{includeUnderlay?: boolean, includeTimestamp?: boolean}} [options] Opções (o histórico omite a imagem e a data).
     * @returns {Record<string, unknown>} Projeto pronto para JSON.stringify.
     */
    toJSON(options = {}) {
        /** @type {boolean} */
        const includeUnderlay = options.includeUnderlay ?? true;
        return {
            schemaVersion: SCHEMA_VERSION,
            app: 'simulador-3d-ambientes',
            ...(options.includeTimestamp === false ? {} : { savedAt: new Date().toISOString() }),
            ...(includeUnderlay && this.underlay !== null ? { underlay: { ...this.underlay } } : {}),
            project: { ...this.project },
            environment: { ...this.environment },
            player: { ...this.player },
            settings: { ...this.settings },
            walls: this.walls.filter((wall) => !wall.perimeter).map((wall) => ({ ...wall })),
            perimeterStyles: this.walls.filter((wall) => wall.perimeter).map((wall) => ({ id: wall.id, opacity: /** @type {any} */ (wall).opacity, hidden: /** @type {any} */ (wall).hidden })),
            layouts: this.syncActiveLayout().map((layout) => ({ id: layout.id, name: layout.name, objects: layout.objects.map((item) => ({ ...item })) })),
            activeLayoutId: this.activeLayoutId,
            doors: this.doors.map((door) => ({ ...door })),
            windows: this.windows.map((item) => ({ ...item })),
            objects: this.objects.map((item) => ({ ...item })),
            rooms: this.rooms.map((room) => ({ ...room }))
        };
    }

    /**
     * Importa e valida uma coleção de um arquivo.
     * @param {EntityType} type Tipo da coleção.
     * @param {unknown} items Itens brutos.
     * @param {string[]} warnings Lista que recebe avisos de itens descartados.
     * @param {Array<any>} [target] Lista de destino (padrão: a coleção do estado).
     * @throws {ValidationError} Quando um item possui valores inválidos.
     */
    importCollection(type, items, warnings, target = this.getCollection(type)) {
        if (items === undefined) {
            return;
        }
        if (!Array.isArray(items)) {
            throw new ValidationError(`A lista "${COLLECTION_BY_TYPE[type]}" está em formato incorreto.`);
        }
        /** @type {Array<any>} */
        const collection = target;
        for (const rawItem of items) {
            if (rawItem === null || typeof rawItem !== 'object' || rawItem.perimeter === true) {
                continue;
            }
            /** @type {string} */
            const kind = VALID_KINDS.has(rawItem.kind) ? rawItem.kind : 'custom';
            /** @type {Record<string, any>} */
            const item = {
                ...this.defaultsFor(type),
                ...(type === 'object' ? objectExtras(kind, Number(rawItem.depth) > 0 ? Number(rawItem.depth) : 0.5) : {}),
                ...validatePatch(type, rawItem)
            };
            item.id = typeof rawItem.id === 'string' && ID_PATTERN.test(rawItem.id) ? rawItem.id : createId(type);
            if (type === 'object') {
                item.kind = kind;
            }
            if (type === 'wall') {
                item.perimeter = false;
            }
            if (type === 'door' || type === 'window') {
                /** @type {Wall|null} */
                const wall = this.getEntity('wall', item.wallId);
                if (wall === null) {
                    warnings.push(`${item.name} foi ignorada porque sua parede não existe.`);
                    continue;
                }
                this.clampOpeningToWall(type, item, wall);
            }
            collection.push(item);
        }
    }

    // #endregion

    // #region Regras internas :: applyPatch(), applyEntityPatch(), assertOpeningFits(), clampOpeningToWall(), findFreeOffset()

    /**
     * Aplica alterações já validadas a um alvo único.
     * @param {'environment'|'player'|'settings'} type Alvo.
     * @param {Record<string, string|number|boolean>} patch Alterações validadas.
     */
    applyPatch(type, patch) {
        if (type === 'player') {
            Object.assign(this.player, patch);
            return;
        }
        if (type === 'settings') {
            Object.assign(this.settings, patch);
            return;
        }
        /** @type {Record<string, string|number|boolean>} */
        const { name, ...dimensions } = patch;
        if (typeof name === 'string') {
            this.project.name = name;
        }
        if (Object.keys(dimensions).length > 0) {
            Object.assign(this.environment, dimensions);
            this.rebuildPerimeterWalls();
            this.player.spawnX = clamp(this.player.spawnX, 0, this.environment.width);
            this.player.spawnZ = clamp(this.player.spawnZ, 0, this.environment.length);
        }
    }

    /**
     * Aplica alterações validadas a uma entidade, verificando regras entre entidades.
     * @param {EntityType} type Tipo.
     * @param {string} id Identificador.
     * @param {Record<string, string|number|boolean>} patch Alterações validadas.
     * @throws {ValidationError} Quando a alteração viola alguma regra.
     */
    applyEntityPatch(type, id, patch) {
        /** @type {any|null} */
        const entity = this.getEntity(type, id);
        if (entity === null) {
            throw new ValidationError('Elemento não encontrado.');
        }
        if (type === 'wall' && entity.perimeter) {
            /** @type {string[]} */
            const blocked = Object.keys(patch).filter((key) => key !== 'name' && key !== 'opacity' && key !== 'hidden');
            if (blocked.length > 0) {
                throw new ValidationError('As paredes externas seguem as dimensões do ambiente. Altere-as em "Ambiente".');
            }
        }
        if (type === 'door' || type === 'window') {
            /** @type {any} */
            const candidate = { ...entity, ...patch };
            /** @type {Wall|null} */
            const wall = this.getEntity('wall', candidate.wallId);
            if (wall === null) {
                throw new ValidationError('Parede não encontrada.');
            }
            if (patch.wallId !== undefined && patch.wallId !== entity.wallId && patch.offset === undefined) {
                candidate.offset = this.findFreeOffset(wall, candidate.width, entity.id);
            }
            /** @type {number} */
            const inset = this.getWallInset(wall);
            if (typeof patch.gapStart === 'number') {
                candidate.offset = roundMillimeters(inset + patch.gapStart + candidate.width / 2);
            }
            if (typeof patch.gapEnd === 'number') {
                candidate.offset = roundMillimeters(wall.length - inset - patch.gapEnd - candidate.width / 2);
            }
            delete candidate.gapStart;
            delete candidate.gapEnd;
            this.assertOpeningFits(type, candidate, wall);
            Object.assign(entity, candidate);
            return;
        }
        Object.assign(entity, patch);
        if (type === 'wall') {
            for (const opening of this.getOpenings(id)) {
                this.clampOpeningToWall(opening.type, opening.data, entity);
            }
        }
    }

    /**
     * Garante que uma abertura caiba na parede sem sobrepor outras.
     * @param {'door'|'window'} type Tipo.
     * @param {Door|WindowOpening} opening Abertura candidata.
     * @param {Wall} wall Parede hospedeira.
     * @throws {ValidationError} Com a explicação do conflito.
     */
    assertOpeningFits(type, opening, wall) {
        /** @type {string} */
        const label = type === 'door' ? 'A porta' : 'A janela';
        if (opening.width + 2 * OPENING_MARGIN > wall.length) {
            throw new ValidationError(`${label} é mais larga que a parede (${wall.length.toFixed(2).replace('.', ',')} m).`);
        }
        /** @type {number} */
        const minOffset = OPENING_MARGIN + opening.width / 2;
        /** @type {number} */
        const maxOffset = wall.length - OPENING_MARGIN - opening.width / 2;
        if (opening.offset < minOffset - 1e-9 || opening.offset > maxOffset + 1e-9) {
            throw new ValidationError(`${label} sairia da parede. Use uma posição entre ${minOffset.toFixed(2).replace('.', ',')} e ${maxOffset.toFixed(2).replace('.', ',')} m.`);
        }
        /** @type {number} */
        const top = type === 'door' ? opening.height : /** @type {WindowOpening} */ (opening).sillHeight + opening.height;
        if (top > wall.height + 1e-9) {
            throw new ValidationError(`${label} ultrapassa a altura da parede (${wall.height.toFixed(2).replace('.', ',')} m).`);
        }
        for (const other of this.getOpenings(wall.id)) {
            if (other.data.id === opening.id) {
                continue;
            }
            if (Math.abs(other.data.offset - opening.offset) < (other.data.width + opening.width) / 2 - 1e-9) {
                throw new ValidationError(`${label} ficaria sobreposta a "${other.data.name}".`);
            }
        }
    }

    /**
     * Ajusta uma abertura para caber em uma parede que mudou de tamanho (sem lançar erros).
     * @param {'door'|'window'} type Tipo.
     * @param {any} opening Abertura (alterada no lugar).
     * @param {Wall} wall Parede hospedeira.
     */
    clampOpeningToWall(type, opening, wall) {
        opening.width = roundMillimeters(clamp(opening.width, 0.1, Math.max(0.1, wall.length - 2 * OPENING_MARGIN)));
        opening.offset = roundMillimeters(clamp(opening.offset, OPENING_MARGIN + opening.width / 2, Math.max(OPENING_MARGIN + opening.width / 2, wall.length - OPENING_MARGIN - opening.width / 2)));
        if (type === 'door') {
            opening.height = roundMillimeters(Math.min(opening.height, wall.height));
        } else {
            opening.height = roundMillimeters(Math.min(opening.height, wall.height));
            opening.sillHeight = roundMillimeters(clamp(opening.sillHeight, 0, wall.height - opening.height));
        }
    }

    /**
     * Procura a posição livre mais próxima do centro da parede para uma abertura.
     * @param {Wall} wall Parede.
     * @param {number} width Largura da abertura.
     * @param {string} ignoreId Abertura a desconsiderar (ela mesma, ao trocar de parede).
     * @returns {number} Posição (offset) livre.
     * @throws {ValidationError} Quando não existe espaço.
     */
    findFreeOffset(wall, width, ignoreId) {
        /** @type {number} */
        const min = OPENING_MARGIN + width / 2;
        /** @type {number} */
        const max = wall.length - OPENING_MARGIN - width / 2;
        if (max < min) {
            throw new ValidationError('A parede é curta demais para essa abertura.');
        }
        /** @type {Array<{offset: number, width: number}>} */
        const others = this.getOpenings(wall.id).filter((item) => item.data.id !== ignoreId).map((item) => item.data);
        /** @type {number} */
        const center = wall.length / 2;
        /** @type {number[]} */
        const candidates = [];
        for (let position = min; position <= max + 1e-9; position += 0.05) {
            candidates.push(roundToStep(position, 0.001));
        }
        candidates.push(roundToStep(clamp(center, min, max), 0.001));
        candidates.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
        /** @type {number|undefined} */
        const free = candidates.find((position) => others.every((other) => Math.abs(other.offset - position) >= (other.width + width) / 2));
        if (free === undefined) {
            throw new ValidationError('Não há espaço livre nessa parede para outra abertura.');
        }
        return free;
    }

    // #endregion

    // #region Auxiliares :: rebuildPerimeterWalls(), resetSpawn(), pushObject(), createDoorDefaults(), createWindowDefaults(), defaultsFor(), nextName()

    /**
     * Recria as quatro paredes externas a partir das dimensões do ambiente.
     * As paredes ficam do lado de fora da área interna, para que as medidas internas sejam exatas.
     * A frente (+Z local) de cada parede externa aponta para dentro do ambiente.
     */
    rebuildPerimeterWalls() {
        /** @type {{width: number, length: number, height: number, wallThickness: number}} */
        const env = this.environment;
        /** @type {number} */
        const t = env.wallThickness;
        /** @type {Map<string, any>} Aparência escolhida pelo usuário sobrevive à recriação das paredes. */
        const previous = new Map(this.walls.filter((wall) => wall.perimeter).map((wall) => [wall.id, wall]));
        /** @type {Wall[]} */
        const perimeter = [
            { id: PERIMETER_IDS.SOUTH, name: 'Parede externa superior (Z = 0)', length: env.width + 2 * t, x: env.width / 2, z: -t / 2, rotation: 0 },
            { id: PERIMETER_IDS.NORTH, name: 'Parede externa inferior', length: env.width + 2 * t, x: env.width / 2, z: env.length + t / 2, rotation: 180 },
            { id: PERIMETER_IDS.WEST, name: 'Parede externa esquerda (X = 0)', length: env.length, x: -t / 2, z: env.length / 2, rotation: 90 },
            { id: PERIMETER_IDS.EAST, name: 'Parede externa direita', length: env.length, x: env.width + t / 2, z: env.length / 2, rotation: 270 }
        ].map((spec) => ({
            ...spec,
            length: roundMillimeters(spec.length),
            x: roundMillimeters(spec.x),
            z: roundMillimeters(spec.z),
            height: env.height,
            thickness: t,
            y: 0,
            opacity: previous.get(spec.id)?.opacity ?? 100,
            hidden: previous.get(spec.id)?.hidden ?? false,
            perimeter: true
        }));
        this.walls = [...perimeter, ...this.walls.filter((wall) => !wall.perimeter)];
        for (const wall of perimeter) {
            for (const opening of this.getOpenings(wall.id)) {
                this.clampOpeningToWall(opening.type, opening.data, wall);
            }
        }
    }

    /**
     * Posiciona o personagem perto da parede sul, olhando para dentro do ambiente.
     */
    resetSpawn() {
        this.player.spawnX = roundMillimeters(this.environment.width / 2);
        this.player.spawnZ = roundMillimeters(Math.min(this.environment.length / 2, 1.2));
        this.player.spawnRotation = 0;
    }

    /**
     * @param {Record<string, any>} values Valores do objeto (tipo, nome, medidas, cor e opcionais da v3).
     * @returns {SceneObject} Objeto adicionado no centro do ambiente.
     */
    pushObject(values) {
        /** @type {SceneObject} */
        const object = {
            id: createId('object'),
            ...objectExtras(values.kind, values.depth),
            ...values,
            x: roundMillimeters(this.environment.width / 2),
            z: roundMillimeters(this.environment.length / 2),
            rotation: 0
        };
        this.objects.push(object);
        this.emit('object:add');
        return object;
    }

    /**
     * @param {Wall} wall Parede hospedeira.
     * @returns {Door} Porta com valores padrão ajustados à parede.
     * @throws {ValidationError} Quando a parede é baixa demais.
     */
    createDoorDefaults(wall) {
        if (wall.height < 0.5) {
            throw new ValidationError('A parede é baixa demais para uma porta.');
        }
        return {
            id: createId('door'),
            name: this.nextName('Porta', this.doors),
            wallId: wall.id,
            offset: 0,
            width: Math.min(DEFAULT_DOOR.width, roundMillimeters(wall.length - 2 * OPENING_MARGIN)),
            height: Math.min(DEFAULT_DOOR.height, wall.height),
            thickness: DEFAULT_DOOR.thickness,
            isOpen: false,
            hinge: 'left',
            swing: 1
        };
    }

    /**
     * @param {Wall} wall Parede hospedeira.
     * @returns {WindowOpening} Janela com valores padrão ajustados à parede.
     */
    createWindowDefaults(wall) {
        /** @type {number} */
        const height = Math.min(DEFAULT_WINDOW.height, roundMillimeters(wall.height * 0.4));
        return {
            id: createId('window'),
            name: this.nextName('Janela', this.windows),
            wallId: wall.id,
            offset: 0,
            width: Math.min(DEFAULT_WINDOW.width, roundMillimeters(wall.length - 2 * OPENING_MARGIN)),
            height,
            sillHeight: roundMillimeters(Math.min(DEFAULT_WINDOW.sillHeight, Math.max(0, wall.height - height - 0.1)))
        };
    }

    /**
     * Valores padrão usados para completar itens importados com campos ausentes.
     * @param {EntityType} type Tipo.
     * @returns {Record<string, unknown>} Valores padrão.
     */
    defaultsFor(type) {
        switch (type) {
            case 'wall':
                return { name: 'Parede', length: DEFAULT_WALL.length, height: this.environment.height, thickness: DEFAULT_WALL.thickness, x: 0, y: 0, z: 0, rotation: 0, opacity: 100, hidden: false };
            case 'door':
                return { name: 'Porta', wallId: '', offset: 1, ...DEFAULT_DOOR, isOpen: false, hinge: 'left', swing: 1 };
            case 'window':
                return { name: 'Janela', wallId: '', offset: 1, ...DEFAULT_WINDOW };
            case 'object':
                return { name: 'Objeto', kind: 'custom', width: 0.5, height: 0.5, depth: 0.5, x: 0, y: 0, z: 0, rotation: 0, color: CUSTOM_OBJECT_COLOR };
            case 'room':
                return { name: 'Cômodo', width: 3, length: 3, x: 0, z: 0, color: ROOM_COLORS[0] };
            default:
                return {};
        }
    }

    /**
     * Gera um nome numerado que ainda não exista na coleção.
     * @param {string} prefix Prefixo, por exemplo "Parede".
     * @param {Array<{name: string}>} collection Coleção para conferir duplicidade.
     * @returns {string} Nome livre, por exemplo "Parede 3".
     */
    nextName(prefix, collection) {
        /** @type {Set<string>} */
        const used = new Set(collection.map((item) => item.name));
        /** @type {number} */
        let index = collection.length + 1;
        while (used.has(`${prefix} ${index}`)) {
            index += 1;
        }
        return `${prefix} ${index}`;
    }

    // #endregion

    // #region Versão 2 :: getWallInset(), getOpeningGaps(), mirror(), rotate180(), replaceWith(), setUnderlay(), removeUnderlay(), calibrateUnderlay(), alignUnderlay(), importUnderlay()

    /**
     * Trecho em cada ponta da parede que fica escondido nos cantos: as paredes externas superior e inferior
     * são prolongadas pela espessura para fechar os cantos, então as folgas são medidas a partir da face interna.
     * @param {Wall} wall Parede.
     * @returns {number} Recuo em cada ponta.
     */
    getWallInset(wall) {
        return wall.perimeter && (wall.id === PERIMETER_IDS.SOUTH || wall.id === PERIMETER_IDS.NORTH) ? wall.thickness : 0;
    }

    /**
     * Distâncias livres entre a abertura e as duas pontas úteis da parede.
     * @param {Door|WindowOpening} opening Abertura.
     * @returns {{gapStart: number, gapEnd: number, start: {x: number, z: number}, end: {x: number, z: number}}|null} Folgas e pontas no mundo.
     */
    getOpeningGaps(opening) {
        /** @type {Wall|null} */
        const wall = this.getEntity('wall', opening.wallId);
        if (wall === null) {
            return null;
        }
        /** @type {number} */
        const inset = this.getWallInset(wall);
        /** @type {number} */
        const angle = (wall.rotation * Math.PI) / 180;
        /**
         * @param {number} u Posição ao longo da parede (a partir da ponta inicial).
         * @returns {{x: number, z: number}} Ponto no mundo.
         */
        const at = (u) => ({
            x: roundMillimeters(wall.x + (u - wall.length / 2) * Math.cos(angle)),
            z: roundMillimeters(wall.z - (u - wall.length / 2) * Math.sin(angle))
        });
        return {
            gapStart: roundMillimeters(opening.offset - opening.width / 2 - inset),
            gapEnd: roundMillimeters(wall.length - inset - opening.offset - opening.width / 2),
            start: at(inset),
            end: at(wall.length - inset)
        };
    }

    /**
     * Espelha o projeto inteiro. Útil para plantas tipo espelhadas entre unidades do mesmo andar.
     * Paredes internas mantêm as posições das aberturas (a direção da parede também é espelhada),
     * mas o lado de abertura das portas se inverte. Nas paredes externas, as aberturas mudam de parede
     * quando necessário e a posição passa a ser medida a partir da outra ponta.
     * @param {'x'|'z'} axis Eixo invertido: 'x' troca esquerda e direita; 'z' troca superior e inferior.
     * @param {boolean} [silent=false] Não emitir notificação (usado por rotate180).
     */
    mirror(axis, silent = false) {
        /** @type {boolean} */
        const isX = axis === 'x';
        /** @type {number} */
        const span = isX ? this.environment.width : this.environment.length;
        /**
         * @param {number} value Coordenada.
         * @returns {number} Coordenada espelhada.
         */
        const flip = (value) => roundMillimeters(span - value);
        /** @type {Record<string, string>} */
        const swap = isX
            ? { [PERIMETER_IDS.WEST]: PERIMETER_IDS.EAST, [PERIMETER_IDS.EAST]: PERIMETER_IDS.WEST }
            : { [PERIMETER_IDS.SOUTH]: PERIMETER_IDS.NORTH, [PERIMETER_IDS.NORTH]: PERIMETER_IDS.SOUTH };

        for (const opening of [...this.doors, ...this.windows]) {
            /** @type {Wall|null} */
            const wall = this.getEntity('wall', opening.wallId);
            if (wall === null) {
                continue;
            }
            /** @type {any} */
            const target = opening;
            if (wall.perimeter) {
                target.wallId = swap[opening.wallId] ?? opening.wallId;
                target.offset = roundMillimeters(wall.length - opening.offset);
                if ('hinge' in target) {
                    target.hinge = target.hinge === 'left' ? 'right' : 'left';
                }
            } else if ('swing' in target) {
                target.swing = target.swing === 1 ? -1 : 1;
            }
        }
        for (const wall of this.walls) {
            if (wall.perimeter) {
                continue;
            }
            if (isX) {
                wall.x = flip(wall.x);
                wall.rotation = normalizeDegrees(180 - wall.rotation);
            } else {
                wall.z = flip(wall.z);
                wall.rotation = normalizeDegrees(-wall.rotation);
            }
        }
        for (const item of this.allObjects()) {
            if (isX) {
                item.x = flip(item.x);
                item.rotation = normalizeDegrees(-item.rotation);
            } else {
                item.z = flip(item.z);
                item.rotation = normalizeDegrees(180 - item.rotation);
            }
        }
        for (const room of this.rooms) {
            if (isX) {
                room.x = flip(room.x);
            } else {
                room.z = flip(room.z);
            }
        }
        if (isX) {
            this.player.spawnX = flip(this.player.spawnX);
            this.player.spawnRotation = normalizeDegrees(-this.player.spawnRotation);
        } else {
            this.player.spawnZ = flip(this.player.spawnZ);
            this.player.spawnRotation = normalizeDegrees(180 - this.player.spawnRotation);
        }
        if (this.underlay !== null) {
            if (isX) {
                this.underlay.x = flip(this.underlay.x);
                this.underlay.flipX = !this.underlay.flipX;
            } else {
                this.underlay.z = flip(this.underlay.z);
                this.underlay.flipZ = !this.underlay.flipZ;
            }
            this.underlay.rotation = normalizeDegrees(-this.underlay.rotation);
        }
        if (!silent) {
            this.emit(`mirror:${axis}`);
        }
    }

    /**
     * Gira o projeto 180° (equivale a espelhar nos dois eixos).
     */
    rotate180() {
        this.mirror('x', true);
        this.mirror('z', true);
        this.emit('rotate180');
    }

    /**
     * Substitui o conteúdo por outro estado (usado por desfazer/refazer), preservando ouvintes e a planta de fundo.
     * @param {ProjectState} other Estado de origem.
     */
    replaceWith(other) {
        this.project = other.project;
        this.environment = other.environment;
        this.player = other.player;
        this.settings = other.settings;
        this.walls = other.walls;
        this.doors = other.doors;
        this.windows = other.windows;
        this.objects = other.objects;
        this.rooms = other.rooms;
        this.layouts = other.layouts;
        this.activeLayoutId = other.activeLayoutId;
        this.emit('history:restore');
    }

    /**
     * Define a planta de fundo. Sem calibração, a imagem ocupa o dobro do maior lado do ambiente.
     * @param {{name: string, dataUrl: string, pixelWidth: number, pixelHeight: number}} image Imagem carregada.
     */
    setUnderlay(image) {
        this.underlay = {
            name: image.name,
            dataUrl: image.dataUrl,
            pixelWidth: image.pixelWidth,
            pixelHeight: image.pixelHeight,
            x: roundMillimeters(this.environment.width / 2),
            z: roundMillimeters(this.environment.length / 2),
            width: roundMillimeters(Math.max(this.environment.width, this.environment.length) * 2),
            rotation: 0,
            opacity: 60,
            visible: true,
            flipX: false,
            flipZ: false
        };
        this.emit('underlay:set');
    }

    /**
     * Remove a planta de fundo.
     */
    removeUnderlay() {
        this.underlay = null;
        this.emit('underlay:remove');
    }

    /**
     * Ajusta a escala da planta para que a distância entre dois pontos clicados seja a medida real.
     * A imagem é escalada em torno do primeiro ponto, que permanece no lugar.
     * @param {{x: number, z: number}} a Primeiro ponto (no mundo).
     * @param {{x: number, z: number}} b Segundo ponto (no mundo).
     * @param {number} realDistance Distância real em metros.
     * @throws {ValidationError} Quando os pontos coincidem ou a escala resultante é absurda.
     */
    calibrateUnderlay(a, b, realDistance) {
        if (this.underlay === null) {
            throw new ValidationError('Importe uma planta antes de calibrar.');
        }
        /** @type {number} */
        const measured = Math.hypot(b.x - a.x, b.z - a.z);
        if (measured < 0.001) {
            throw new ValidationError('Os dois pontos estão no mesmo lugar. Clique nas duas pontas de uma cota.');
        }
        if (!(realDistance > 0)) {
            throw new ValidationError('Informe uma distância maior que zero.');
        }
        /** @type {number} */
        const factor = realDistance / measured;
        /** @type {number} */
        const width = this.underlay.width * factor;
        if (width < 0.1 || width > 500) {
            throw new ValidationError('A escala resultante não é plausível. Confira a medida digitada.');
        }
        this.underlay.width = roundMillimeters(width);
        this.underlay.x = roundMillimeters(a.x + (this.underlay.x - a.x) * factor);
        this.underlay.z = roundMillimeters(a.z + (this.underlay.z - a.z) * factor);
        this.emit('underlay:calibrate');
    }

    /**
     * Move a planta para que o ponto clicado coincida com o destino (por padrão, a origem do ambiente).
     * @param {{x: number, z: number}} point Ponto da imagem clicado.
     * @param {{x: number, z: number}} [target] Destino.
     * @throws {ValidationError} Sem planta carregada.
     */
    alignUnderlay(point, target = { x: 0, z: 0 }) {
        if (this.underlay === null) {
            throw new ValidationError('Importe uma planta antes de alinhar.');
        }
        this.underlay.x = roundMillimeters(this.underlay.x + target.x - point.x);
        this.underlay.z = roundMillimeters(this.underlay.z + target.z - point.z);
        this.emit('underlay:align');
    }

    /**
     * Importa e valida a planta de fundo de um arquivo.
     * @param {unknown} raw Dados brutos.
     * @param {string[]} warnings Avisos.
     */
    importUnderlay(raw, warnings) {
        if (raw === undefined || raw === null) {
            return;
        }
        /** @type {any} */
        const data = raw;
        if (typeof data.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(data.dataUrl) || data.dataUrl.length > MAX_UNDERLAY_CHARS
            || !(data.pixelWidth > 0) || !(data.pixelHeight > 0)) {
            warnings.push('A planta de fundo do arquivo foi ignorada por estar em formato inválido.');
            return;
        }
        /** @type {Record<string, string|number|boolean>} */
        const valid = validatePatch('underlay', data);
        this.underlay = {
            name: typeof data.name === 'string' ? data.name.slice(0, 120) : 'Planta',
            dataUrl: data.dataUrl,
            pixelWidth: Number(data.pixelWidth),
            pixelHeight: Number(data.pixelHeight),
            x: 0, z: 0, width: 10, rotation: 0, opacity: 60, visible: true,
            ...valid,
            flipX: data.flipX === true,
            flipZ: data.flipZ === true
        };
    }

    // #endregion

    // #region Versão 3 :: allObjects(), syncActiveLayout(), getActiveLayout(), createLayout(), switchLayout(), renameLayout(), deleteLayout(), addLibraryObject(), importPerimeterStyles(), importLayouts()

    /**
     * @returns {SceneObject[]} Objetos de todas as arrumações (a ativa e as guardadas).
     */
    allObjects() {
        return [...this.objects, ...this.layouts.filter((layout) => layout.id !== this.activeLayoutId).flatMap((layout) => layout.objects)];
    }

    /**
     * Copia os objetos ativos para a entrada da arrumação ativa.
     * @returns {Layout[]} Arrumações atualizadas.
     */
    syncActiveLayout() {
        /** @type {Layout} */
        const active = this.getActiveLayout();
        active.objects = this.objects.map((item) => ({ ...item }));
        return this.layouts;
    }

    /**
     * @returns {Layout} Arrumação ativa.
     */
    getActiveLayout() {
        return /** @type {Layout} */ (this.layouts.find((layout) => layout.id === this.activeLayoutId) ?? this.layouts[0]);
    }

    /**
     * Cria uma arrumação nova copiando a atual e passa a editá-la.
     * @param {string} name Nome.
     * @returns {Layout} Arrumação criada.
     * @throws {ValidationError} Ao exceder o limite ou com nome inválido.
     */
    createLayout(name) {
        if (this.layouts.length >= MAX_LAYOUTS) {
            throw new ValidationError(`Use no máximo ${MAX_LAYOUTS} arrumações por projeto.`);
        }
        /** @type {string} */
        const valid = /** @type {string} */ (validatePatch('room', { name }).name);
        this.syncActiveLayout();
        /** @type {Layout} */
        const layout = { id: createId('layout'), name: valid, objects: this.objects.map((item) => ({ ...item, id: createId('object') })) };
        this.layouts.push(layout);
        this.activeLayoutId = layout.id;
        this.objects = layout.objects.map((item) => ({ ...item }));
        this.emit('layout:create');
        return layout;
    }

    /**
     * Troca a arrumação em edição. Paredes, portas e janelas são compartilhadas; só os objetos mudam.
     * @param {string} id Arrumação.
     * @throws {ValidationError} Quando não existe.
     */
    switchLayout(id) {
        /** @type {Layout|undefined} */
        const target = this.layouts.find((layout) => layout.id === id);
        if (target === undefined) {
            throw new ValidationError('Arrumação não encontrada.');
        }
        if (id === this.activeLayoutId) {
            return;
        }
        this.syncActiveLayout();
        this.activeLayoutId = id;
        this.objects = target.objects.map((item) => ({ ...item }));
        this.emit('layout:switch');
    }

    /**
     * @param {string} id Arrumação.
     * @param {string} name Novo nome.
     * @throws {ValidationError} Nome inválido ou arrumação inexistente.
     */
    renameLayout(id, name) {
        /** @type {Layout|undefined} */
        const layout = this.layouts.find((item) => item.id === id);
        if (layout === undefined) {
            throw new ValidationError('Arrumação não encontrada.');
        }
        layout.name = /** @type {string} */ (validatePatch('room', { name }).name);
        this.emit('layout:rename');
    }

    /**
     * Exclui uma arrumação; a última nunca é excluída.
     * @param {string} id Arrumação.
     * @throws {ValidationError} Ao tentar excluir a única arrumação.
     */
    deleteLayout(id) {
        if (this.layouts.length <= 1) {
            throw new ValidationError('O projeto precisa de pelo menos uma arrumação.');
        }
        /** @type {number} */
        const index = this.layouts.findIndex((layout) => layout.id === id);
        if (index < 0) {
            return;
        }
        this.layouts.splice(index, 1);
        if (id === this.activeLayoutId) {
            /** @type {Layout} */
            const next = this.layouts[Math.max(0, index - 1)];
            this.activeLayoutId = next.id;
            this.objects = next.objects.map((item) => ({ ...item }));
        }
        this.emit('layout:delete');
    }

    /**
     * Adiciona um objeto da biblioteca pessoal no centro do ambiente.
     * @param {Record<string, unknown>} item Item da biblioteca.
     * @returns {SceneObject} Objeto criado.
     * @throws {ValidationError} Quando o item é inválido.
     */
    addLibraryObject(item) {
        /** @type {string} */
        const kind = VALID_KINDS.has(/** @type {string} */ (item.kind)) ? /** @type {string} */ (item.kind) : 'custom';
        /** @type {Record<string, any>} */
        const valid = validatePatch('object', item);
        for (const key of ['name', 'width', 'height', 'depth']) {
            if (valid[key] === undefined) {
                throw new ValidationError('Item da biblioteca incompleto.');
            }
        }
        delete valid.x;
        delete valid.z;
        delete valid.rotation;
        return this.pushObject({ kind, y: 0, color: CUSTOM_OBJECT_COLOR, ...valid });
    }

    /**
     * Reaplica a aparência das paredes externas salva no arquivo.
     * @param {unknown} styles Lista {id, opacity, hidden}.
     */
    importPerimeterStyles(styles) {
        if (!Array.isArray(styles)) {
            return;
        }
        for (const style of styles) {
            /** @type {any} */
            const wall = style !== null && typeof style === 'object' ? this.walls.find((item) => item.perimeter && item.id === style.id) : undefined;
            if (wall !== undefined) {
                Object.assign(wall, validatePatch('wall', { opacity: style.opacity ?? 100, hidden: style.hidden === true }));
            }
        }
    }

    /**
     * Importa as arrumações (v3) ou, em arquivos antigos, a lista única de objetos.
     * @param {Record<string, any>} data Arquivo.
     * @param {string[]} warnings Avisos.
     * @throws {ValidationError} Quando algum objeto é inválido.
     */
    importLayouts(data, warnings) {
        if (!Array.isArray(data.layouts) || data.layouts.length === 0) {
            this.importCollection('object', data.objects, warnings);
            this.syncActiveLayout();
            return;
        }
        this.layouts = data.layouts.slice(0, MAX_LAYOUTS).map((raw, index) => {
            /** @type {SceneObject[]} */
            const objects = [];
            this.importCollection('object', raw?.objects ?? [], warnings, objects);
            /** @type {string} */
            const name = typeof raw?.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim().slice(0, 80) : `Arrumação ${index + 1}`;
            return { id: typeof raw?.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : createId('layout'), name, objects };
        });
        /** @type {Layout} */
        const active = this.layouts.find((layout) => layout.id === data.activeLayoutId) ?? this.layouts[0];
        this.activeLayoutId = active.id;
        this.objects = active.objects.map((item) => ({ ...item }));
    }

    // #endregion
}
