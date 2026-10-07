/**
 * Geometria 2D no plano do piso (XZ), sem Three.js.
 *
 * Convenção de rotação igual à do Three.js: um vetor local (lx, lz) girado θ em torno de Y
 * vira (cos θ·lx + sen θ·lz, -sen θ·lx + cos θ·lz) no mundo.
 * Caixas orientadas usam o mesmo formato dos colisores: {cx, cz, hx, hz, cos, sin}.
 */
import { CIRCULATION_MIN, NON_COLLIDING_KINDS, OVERLAP_ALLOWED, OVERLAP_EXEMPT_KINDS } from './config.js';
import { degToRad } from './units.js';

/**
 * @typedef {{x: number, z: number}} Point
 * @typedef {{cx: number, cz: number, hx: number, hz: number, cos: number, sin: number, yMin?: number, yMax?: number, ref?: {type: string, id: string}|null}} OrientedBox
 * @typedef {{distance: number, from: Point, to: Point}} Clearance
 * @typedef {{ax: number, az: number, bx: number, bz: number}} Segment
 */

/**
 * Gira um vetor local para o mundo.
 * @param {number} lx X local.
 * @param {number} lz Z local.
 * @param {number} yaw Rotação em radianos.
 * @returns {Point} Vetor no mundo.
 */
export function rotateLocal(lx, lz, yaw) {
    /** @type {number} */
    const cos = Math.cos(yaw);
    /** @type {number} */
    const sin = Math.sin(yaw);
    return { x: cos * lx + sin * lz, z: -sin * lx + cos * lz };
}

/**
 * Cria uma caixa orientada.
 * @param {number} cx Centro X.
 * @param {number} cz Centro Z.
 * @param {number} hx Meia largura.
 * @param {number} hz Meia profundidade.
 * @param {number} yaw Rotação em radianos.
 * @returns {OrientedBox} Caixa.
 */
export function createBox(cx, cz, hx, hz, yaw) {
    return { cx, cz, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw) };
}

/**
 * Pegada (projeção no piso) de um objeto do estado.
 * @param {{x: number, z: number, width: number, depth: number, rotation: number}} item Objeto.
 * @returns {OrientedBox} Caixa da pegada.
 */
export function footprintOf(item) {
    return createBox(item.x, item.z, item.width / 2, item.depth / 2, degToRad(item.rotation));
}

/**
 * @param {OrientedBox} box Caixa.
 * @returns {Point[]} Os quatro cantos no mundo.
 */
export function boxCorners(box) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
        x: box.cx + box.cos * sx * box.hx + box.sin * sz * box.hz,
        z: box.cz - box.sin * sx * box.hx + box.cos * sz * box.hz
    }));
}

/**
 * Teste de sobreposição entre duas caixas orientadas (teorema do eixo separador).
 * Caixas que apenas se encostam não contam como sobrepostas.
 * @param {OrientedBox} a Primeira caixa.
 * @param {OrientedBox} b Segunda caixa.
 * @returns {boolean} Verdadeiro se houver sobreposição real.
 */
export function boxesOverlap(a, b) {
    /** @type {Array<[number, number]>} */
    const axes = [[a.cos, -a.sin], [a.sin, a.cos], [b.cos, -b.sin], [b.sin, b.cos]];
    /** @type {number} */
    const dx = b.cx - a.cx;
    /** @type {number} */
    const dz = b.cz - a.cz;
    for (const [ax, az] of axes) {
        /** @type {number} */
        const radiusA = a.hx * Math.abs(a.cos * ax - a.sin * az) + a.hz * Math.abs(a.sin * ax + a.cos * az);
        /** @type {number} */
        const radiusB = b.hx * Math.abs(b.cos * ax - b.sin * az) + b.hz * Math.abs(b.sin * ax + b.cos * az);
        if (Math.abs(dx * ax + dz * az) >= radiusA + radiusB - 1e-6) {
            return false;
        }
    }
    return true;
}

/**
 * Distância ao longo de um raio até uma caixa orientada (método das placas).
 * @param {number} ox Origem X.
 * @param {number} oz Origem Z.
 * @param {number} dx Direção X (unitária).
 * @param {number} dz Direção Z (unitária).
 * @param {OrientedBox} box Caixa.
 * @returns {number} Distância (0 se a origem estiver dentro) ou Infinity se não houver interseção à frente.
 */
export function rayBoxDistance(ox, oz, dx, dz, box) {
    /** @type {number} */
    const px = ox - box.cx;
    /** @type {number} */
    const pz = oz - box.cz;
    /** @type {number[]} */
    const origin = [box.cos * px - box.sin * pz, box.sin * px + box.cos * pz];
    /** @type {number[]} */
    const direction = [box.cos * dx - box.sin * dz, box.sin * dx + box.cos * dz];
    /** @type {number[]} */
    const half = [box.hx, box.hz];
    /** @type {number} */
    let tMin = -Infinity;
    /** @type {number} */
    let tMax = Infinity;
    for (let axis = 0; axis < 2; axis += 1) {
        if (Math.abs(direction[axis]) < 1e-12) {
            if (Math.abs(origin[axis]) > half[axis]) {
                return Infinity;
            }
            continue;
        }
        /** @type {number} */
        const t1 = (-half[axis] - origin[axis]) / direction[axis];
        /** @type {number} */
        const t2 = (half[axis] - origin[axis]) / direction[axis];
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
    }
    if (tMax < Math.max(tMin, 0)) {
        return Infinity;
    }
    return Math.max(tMin, 0);
}

/**
 * Mede o espaço livre nos quatro lados de uma pegada até o obstáculo mais próximo.
 * Cada lado é amostrado em três pontos (pontas e meio) para não ignorar obstáculos estreitos.
 * "Esquerda" e "direita" são do ponto de vista de quem olha para a frente do objeto (+Z local).
 * @param {OrientedBox} box Pegada.
 * @param {OrientedBox[]} obstacles Obstáculos.
 * @param {number} [maxDistance=20] Distância máxima considerada.
 * @returns {Record<'front'|'back'|'left'|'right', Clearance|null>} Folgas por lado.
 */
export function measureClearances(box, obstacles, maxDistance = 20) {
    /** @type {number} */
    const yaw = Math.atan2(box.sin, box.cos);
    /** @type {Record<string, {nx: number, nz: number, half: number, along: number, alongIsX: boolean}>} */
    const sides = {
        front: { nx: 0, nz: 1, half: box.hz, along: box.hx, alongIsX: true },
        back: { nx: 0, nz: -1, half: box.hz, along: box.hx, alongIsX: true },
        left: { nx: 1, nz: 0, half: box.hx, along: box.hz, alongIsX: false },
        right: { nx: -1, nz: 0, half: box.hx, along: box.hz, alongIsX: false }
    };
    /** @type {Record<string, Clearance|null>} */
    const result = {};
    for (const [name, side] of Object.entries(sides)) {
        /** @type {Point} */
        const direction = rotateLocal(side.nx, side.nz, yaw);
        /** @type {Clearance|null} */
        let best = null;
        for (const fraction of [-0.98, 0, 0.98]) {
            /** @type {number} */
            const offsetAlong = fraction * side.along;
            /** @type {Point} */
            const local = side.alongIsX
                ? { x: offsetAlong, z: side.nz * side.half }
                : { x: side.nx * side.half, z: offsetAlong };
            /** @type {Point} */
            const delta = rotateLocal(local.x, local.z, yaw);
            /** @type {Point} */
            const origin = { x: box.cx + delta.x, z: box.cz + delta.z };
            for (const obstacle of obstacles) {
                /** @type {number} */
                const distance = rayBoxDistance(origin.x, origin.z, direction.x, direction.z, obstacle);
                if (distance <= maxDistance && (best === null || distance < best.distance)) {
                    best = { distance, from: origin, to: { x: origin.x + direction.x * distance, z: origin.z + direction.z * distance } };
                }
            }
        }
        result[name] = best;
    }
    return /** @type {Record<'front'|'back'|'left'|'right', Clearance|null>} */ (result);
}

/**
 * Pontos e segmentos de encaixe derivados das paredes: cantos, pontas do eixo e as duas faces.
 * @param {Array<{x: number, z: number, length: number, thickness: number, rotation: number}>} walls Paredes.
 * @returns {{points: Point[], segments: Segment[]}} Alvos de encaixe.
 */
export function wallSnapGeometry(walls) {
    /** @type {Point[]} */
    const points = [];
    /** @type {Segment[]} */
    const segments = [];
    for (const wall of walls) {
        /** @type {number} */
        const yaw = degToRad(wall.rotation);
        /**
         * @param {number} lx X local.
         * @param {number} lz Z local.
         * @returns {Point} Ponto no mundo.
         */
        const at = (lx, lz) => {
            /** @type {Point} */
            const delta = rotateLocal(lx, lz, yaw);
            return { x: wall.x + delta.x, z: wall.z + delta.z };
        };
        /** @type {number} */
        const hl = wall.length / 2;
        /** @type {number} */
        const ht = wall.thickness / 2;
        for (const lz of [-ht, 0, ht]) {
            /** @type {Point} */
            const a = at(-hl, lz);
            /** @type {Point} */
            const b = at(hl, lz);
            points.push(a, b);
            segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
        }
    }
    return { points, segments };
}

/**
 * Projeta um ponto em um segmento.
 * @param {Point} p Ponto.
 * @param {Segment} s Segmento.
 * @returns {{point: Point, distance: number}} Ponto mais próximo e distância.
 */
export function projectOnSegment(p, s) {
    /** @type {number} */
    const vx = s.bx - s.ax;
    /** @type {number} */
    const vz = s.bz - s.az;
    /** @type {number} */
    const lengthSquared = vx * vx + vz * vz;
    /** @type {number} */
    const t = lengthSquared < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.z - s.az) * vz) / lengthSquared));
    /** @type {Point} */
    const point = { x: s.ax + vx * t, z: s.az + vz * t };
    return { point, distance: Math.hypot(p.x - point.x, p.z - point.z) };
}

/**
 * Encaixa um ponto no canto ou na face de parede mais próxima, se estiver dentro do limite.
 * Cantos têm prioridade sobre faces.
 * @param {Point} p Ponto do cursor.
 * @param {{points: Point[], segments: Segment[]}} targets Alvos de encaixe.
 * @param {number} threshold Distância máxima de encaixe.
 * @returns {{point: Point, kind: 'corner'|'face'|null}} Resultado.
 */
export function snapToWalls(p, targets, threshold) {
    /** @type {{point: Point, distance: number}|null} */
    let corner = null;
    for (const point of targets.points) {
        /** @type {number} */
        const distance = Math.hypot(p.x - point.x, p.z - point.z);
        if (distance <= threshold && (corner === null || distance < corner.distance)) {
            corner = { point, distance };
        }
    }
    if (corner !== null) {
        return { point: { ...corner.point }, kind: 'corner' };
    }
    /** @type {{point: Point, distance: number}|null} */
    let face = null;
    for (const segment of targets.segments) {
        /** @type {{point: Point, distance: number}} */
        const projection = projectOnSegment(p, segment);
        if (projection.distance <= threshold && (face === null || projection.distance < face.distance)) {
            face = projection;
        }
    }
    return face === null ? { point: { ...p }, kind: null } : { point: face.point, kind: 'face' };
}

/**
 * Área varrida pela folha de uma porta ao abrir, aproximada por um quadrado de lado igual à largura.
 * @param {{x: number, z: number, length: number, thickness: number, rotation: number}} wall Parede hospedeira.
 * @param {{offset: number, width: number, swing: number}} door Porta.
 * @returns {OrientedBox} Caixa da área de abertura.
 */
export function doorSwingBox(wall, door) {
    /** @type {number} */
    const yaw = degToRad(wall.rotation);
    /** @type {Point} */
    const delta = rotateLocal(door.offset - wall.length / 2, door.swing * (wall.thickness / 2 + door.width / 2), yaw);
    return createBox(wall.x + delta.x, wall.z + delta.z, door.width / 2, door.width / 2, yaw);
}

/**
 * @typedef {Object} LayoutIssue
 * @property {'overlap'|'door'|'usage'} type Categoria.
 * @property {string} message Texto para o usuário.
 * @property {string[]} ids Objetos envolvidos.
 */

/**
 * @typedef {Object} LayoutAnalysis
 * @property {LayoutIssue[]} issues Problemas encontrados.
 * @property {Set<string>} conflictIds Objetos que invadem outro objeto ou uma parede.
 * @property {Map<string, Set<'front'|'back'|'side'>>} usageFailures Lados cuja área de uso não é atendida.
 * @property {number} freeArea Piso livre aproximado (m²).
 */

/** Folga para que objetos apenas encostados (arredondados ao milímetro) não contem como sobrepostos. */
const OVERLAP_TOLERANCE = 0.005;

/** Obstáculos acima disso (forros, prateleiras altas) não reduzem a área de uso no piso. */
const USAGE_MAX_OBSTACLE_BASE = 1.2;

/**
 * Pegada real considerando o estado: um sofá retrátil aberto avança para a frente.
 * @param {{kind: string, x: number, z: number, width: number, depth: number, rotation: number, isOpen?: boolean, openDepth?: number}} item Objeto.
 * @returns {OrientedBox} Pegada efetiva.
 */
export function effectiveFootprint(item) {
    if (item.kind === 'sofa' && item.isOpen === true && (item.openDepth ?? 0) > item.depth) {
        /** @type {number} */
        const openDepth = /** @type {number} */ (item.openDepth);
        /** @type {number} */
        const yaw = degToRad(item.rotation);
        /** @type {Point} */
        const shift = rotateLocal(0, (openDepth - item.depth) / 2, yaw);
        return createBox(item.x + shift.x, item.z + shift.z, item.width / 2, openDepth / 2, yaw);
    }
    return footprintOf(item);
}

/**
 * @param {{kind: string, height: number}} item Objeto.
 * @returns {boolean} Verdadeiro se ocupa espaço físico relevante (exclui marcadores e tapetes).
 */
export function isSolid(item) {
    return !NON_COLLIDING_KINDS.has(item.kind) && item.height > 0.05;
}

/**
 * @param {any} item Objeto.
 * @param {number} [shrink=0] Redução das meias-dimensões (tolerância).
 * @returns {OrientedBox} Obstáculo com faixa de altura e referência.
 */
export function objectObstacle(item, shrink = 0) {
    /** @type {OrientedBox} */
    const box = effectiveFootprint(item);
    return { ...box, hx: Math.max(0.001, box.hx - shrink), hz: Math.max(0.001, box.hz - shrink), yMin: item.y, yMax: item.y + item.height, ref: { type: 'object', id: item.id } };
}

/**
 * @param {{kind: string}} a Objeto.
 * @param {{kind: string}} b Objeto.
 * @returns {boolean} Verdadeiro se a sobreposição entre os tipos é esperada.
 */
function overlapAllowed(a, b) {
    return OVERLAP_ALLOWED.some(([first, second]) => (a.kind === first && b.kind === second) || (a.kind === second && b.kind === first));
}

/**
 * @param {OrientedBox} a Caixa com faixa de altura.
 * @param {OrientedBox} b Caixa com faixa de altura.
 * @returns {boolean} Verdadeiro se as faixas de altura se cruzam (mais de 1 cm).
 */
function heightsOverlap(a, b) {
    return Math.min(a.yMax ?? Infinity, b.yMax ?? Infinity) - Math.max(a.yMin ?? -Infinity, b.yMin ?? -Infinity) > 0.01;
}

/**
 * Obstáculos que limitam o espaço livre de um objeto: estrutura e outros objetos sólidos no nível do piso.
 * @param {any} item Objeto medido.
 * @param {any[]} objects Objetos da arrumação.
 * @param {OrientedBox[]} structure Paredes, portas e janelas.
 * @returns {OrientedBox[]} Obstáculos.
 */
export function obstaclesFor(item, objects, structure) {
    return [
        ...structure.filter((box) => (box.yMax ?? Infinity) > 0.05 && (box.yMin ?? 0) < USAGE_MAX_OBSTACLE_BASE),
        ...objects
            .filter((other) => other.id !== item.id && isSolid(other) && other.y < USAGE_MAX_OBSTACLE_BASE && !overlapAllowed(item, other))
            .map((other) => objectObstacle(other))
    ];
}

/**
 * Retângulos das áreas de uso exigidas por um objeto (para desenhar no piso).
 * @param {any} item Objeto.
 * @returns {Array<{side: 'front'|'back'|'left'|'right', box: OrientedBox}>} Áreas.
 */
export function usageZones(item) {
    /** @type {OrientedBox} */
    const base = effectiveFootprint(item);
    /** @type {number} */
    const yaw = Math.atan2(base.sin, base.cos);
    /** @type {Array<{side: 'front'|'back'|'left'|'right', box: OrientedBox}>} */
    const zones = [];
    /**
     * @param {'front'|'back'|'left'|'right'} side Lado.
     * @param {number} lx Deslocamento local X do centro.
     * @param {number} lz Deslocamento local Z do centro.
     * @param {number} hx Meia largura.
     * @param {number} hz Meia profundidade.
     */
    const add = (side, lx, lz, hx, hz) => {
        /** @type {Point} */
        const delta = rotateLocal(lx, lz, yaw);
        zones.push({ side, box: createBox(base.cx + delta.x, base.cz + delta.z, hx, hz, yaw) });
    };
    if (item.usageFront > 0) {
        add('front', 0, base.hz + item.usageFront / 2, base.hx, item.usageFront / 2);
    }
    if (item.usageBack > 0) {
        add('back', 0, -base.hz - item.usageBack / 2, base.hx, item.usageBack / 2);
    }
    if (item.usageSide > 0) {
        add('left', base.hx + item.usageSide / 2, 0, item.usageSide / 2, base.hz);
        add('right', -base.hx - item.usageSide / 2, 0, item.usageSide / 2, base.hz);
    }
    return zones;
}

/**
 * Analisa uma arrumação: sobreposições, portas bloqueadas e áreas de uso não atendidas.
 * Trabalha com dados puros, então também serve para comparar arrumações que não estão na tela.
 * @param {{doors: any[], environment: {width: number, length: number}, getEntity: (type: any, id: string) => any}} state Projeto.
 * @param {any[]} objects Objetos da arrumação analisada.
 * @param {OrientedBox[]} structure Colisores de paredes, portas e janelas (com ref).
 * @returns {LayoutAnalysis} Resultado.
 */
export function analyzeLayout(state, objects, structure) {
    /** @type {LayoutIssue[]} */
    const issues = [];
    /** @type {Set<string>} */
    const conflictIds = new Set();
    /** @type {Map<string, Set<'front'|'back'|'side'>>} */
    const usageFailures = new Map();
    /** @type {any[]} */
    const solids = objects.filter(isSolid);
    /** @type {any[]} */
    const overlapCandidates = solids.filter((item) => !OVERLAP_EXEMPT_KINDS.has(item.kind));

    for (let i = 0; i < overlapCandidates.length; i += 1) {
        /** @type {OrientedBox} */
        const a = objectObstacle(overlapCandidates[i], OVERLAP_TOLERANCE);
        for (let j = i + 1; j < overlapCandidates.length; j += 1) {
            if (overlapAllowed(overlapCandidates[i], overlapCandidates[j])) {
                continue;
            }
            /** @type {OrientedBox} */
            const b = objectObstacle(overlapCandidates[j], OVERLAP_TOLERANCE);
            if (heightsOverlap(a, b) && boxesOverlap(a, b)) {
                conflictIds.add(overlapCandidates[i].id).add(overlapCandidates[j].id);
                issues.push({ type: 'overlap', message: `${overlapCandidates[i].name} invade ${overlapCandidates[j].name}.`, ids: [overlapCandidates[i].id, overlapCandidates[j].id] });
            }
        }
        for (const wallBox of structure) {
            if (wallBox.ref?.type !== 'wall' || !heightsOverlap(a, wallBox) || !boxesOverlap(a, wallBox)) {
                continue;
            }
            /** @type {string} */
            const wallName = state.getEntity('wall', wallBox.ref.id)?.name ?? 'uma parede';
            /** @type {string} */
            const message = `${overlapCandidates[i].name} atravessa ${wallName}.`;
            if (!issues.some((issue) => issue.message === message)) {
                conflictIds.add(overlapCandidates[i].id);
                issues.push({ type: 'overlap', message, ids: [overlapCandidates[i].id] });
            }
        }
    }

    for (const door of state.doors) {
        /** @type {any} */
        const wall = state.getEntity('wall', door.wallId);
        if (wall === null) {
            continue;
        }
        /** @type {OrientedBox} */
        const swing = doorSwingBox(wall, door);
        for (const item of solids) {
            if (item.y < door.height && boxesOverlap(swing, objectObstacle(item, OVERLAP_TOLERANCE))) {
                issues.push({ type: 'door', message: `${door.name} não abre por completo: a folha bate em ${item.name}.`, ids: [item.id] });
            }
        }
    }

    for (const item of objects) {
        if (!isSolid(item) || (item.usageFront <= 0 && item.usageBack <= 0 && item.usageSide <= 0)) {
            continue;
        }
        /** @type {Record<'front'|'back'|'left'|'right', Clearance|null>} */
        const clearances = measureClearances(effectiveFootprint(item), obstaclesFor(item, objects, structure), 6);
        /** @type {Set<'front'|'back'|'side'>} */
        const failed = new Set();
        /** @type {Array<['front'|'back', number, string]>} */
        const ends = [['front', item.usageFront, 'à frente'], ['back', item.usageBack, 'atrás']];
        for (const [side, required, label] of ends) {
            /** @type {Clearance|null} */
            const clearance = clearances[side];
            if (required > 0 && clearance !== null && clearance.distance < required - 0.005) {
                failed.add(side);
                issues.push({ type: 'usage', message: `${item.name}: ${Math.round(clearance.distance * 100)} cm livres ${label} (recomendado ${Math.round(required * 100)} cm).`, ids: [item.id] });
            }
        }
        if (item.usageSide > 0) {
            /** @type {number} */
            const best = Math.max(clearances.left?.distance ?? Infinity, clearances.right?.distance ?? Infinity);
            if (best < item.usageSide - 0.005) {
                failed.add('side');
                issues.push({ type: 'usage', message: `${item.name}: nenhuma lateral com ${Math.round(item.usageSide * 100)} cm livres (a maior tem ${Math.round(best * 100)} cm).`, ids: [item.id] });
            }
        }
        if (failed.size > 0) {
            usageFailures.set(item.id, failed);
        }
    }

    /** @type {number} */
    const occupied = solids.filter((item) => item.y < 0.3).reduce((sum, item) => {
        /** @type {OrientedBox} */
        const box = effectiveFootprint(item);
        return sum + 4 * box.hx * box.hz;
    }, 0);
    return { issues, conflictIds, usageFailures, freeArea: Math.max(0, state.environment.width * state.environment.length - occupied) };
}

/** Mantido para referência da v2: largura mínima genérica de passagem. */
export const GENERIC_PASSAGE = CIRCULATION_MIN;
