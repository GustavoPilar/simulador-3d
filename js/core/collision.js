/**
 * Colisões simples e estáveis para o controlador em primeira pessoa.
 *
 * O corpo do personagem é tratado como um cilindro vertical (círculo no plano XZ + faixa de altura).
 * Obstáculos são caixas orientadas apenas em Y (paredes, móveis, folhas de porta), o que cobre
 * todos os elementos da aplicação. Este módulo não depende do Three.js para poder ser testado no Node.
 */

/**
 * @typedef {Object} BoxCollider
 * @property {number} cx Centro X.
 * @property {number} cz Centro Z.
 * @property {number} hx Meia largura no X local.
 * @property {number} hz Meia profundidade no Z local.
 * @property {number} cos Cosseno da rotação em Y.
 * @property {number} sin Seno da rotação em Y.
 * @property {number} yMin Base.
 * @property {number} yMax Topo.
 * @property {{type: string, id: string}|null} [ref] Elemento de origem (para ignorar o próprio objeto em medições).
 */

/**
 * @typedef {Object} Bounds
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 */

/**
 * Cria um colisor de caixa.
 * @param {number} cx Centro X.
 * @param {number} cz Centro Z.
 * @param {number} hx Meia largura.
 * @param {number} hz Meia profundidade.
 * @param {number} yaw Rotação em Y (radianos, mesma convenção do Three.js).
 * @param {number} yMin Base.
 * @param {number} yMax Topo.
 * @param {{type: string, id: string}|null} [ref=null] Elemento de origem.
 * @returns {BoxCollider} Colisor.
 */
export function createBoxCollider(cx, cz, hx, hz, yaw, yMin, yMax, ref = null) {
    return { cx, cz, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), yMin, yMax, ref };
}

/**
 * Converte um ponto do mundo para o espaço local da caixa.
 * Na convenção do Three.js, local -> mundo é x = cos·lx + sen·lz e z = -sen·lx + cos·lz; aqui aplicamos a inversa.
 * @param {number} px X do mundo.
 * @param {number} pz Z do mundo.
 * @param {BoxCollider} box Caixa.
 * @returns {{lx: number, lz: number}} Coordenadas locais.
 */
function toLocal(px, pz, box) {
    /** @type {number} */
    const dx = px - box.cx;
    /** @type {number} */
    const dz = pz - box.cz;
    return { lx: box.cos * dx - box.sin * dz, lz: box.sin * dx + box.cos * dz };
}

/**
 * Converte um ponto local da caixa para o mundo.
 * @param {number} lx X local.
 * @param {number} lz Z local.
 * @param {BoxCollider} box Caixa.
 * @returns {{x: number, z: number}} Coordenadas do mundo.
 */
function toWorld(lx, lz, box) {
    return { x: box.cx + box.cos * lx + box.sin * lz, z: box.cz - box.sin * lx + box.cos * lz };
}

/**
 * Verifica se um círculo toca a projeção XZ de uma caixa.
 * @param {number} px Centro X do círculo.
 * @param {number} pz Centro Z do círculo.
 * @param {number} radius Raio.
 * @param {BoxCollider} box Caixa.
 * @returns {boolean} Verdadeiro se houver contato.
 */
export function circleOverlapsBox(px, pz, radius, box) {
    /** @type {{lx: number, lz: number}} */
    const local = toLocal(px, pz, box);
    /** @type {number} */
    const dx = local.lx - Math.max(-box.hx, Math.min(box.hx, local.lx));
    /** @type {number} */
    const dz = local.lz - Math.max(-box.hz, Math.min(box.hz, local.lz));
    return dx * dx + dz * dz < radius * radius;
}

/**
 * Empurra um círculo para fora de uma caixa pelo menor caminho.
 * @param {number} px Centro X do círculo.
 * @param {number} pz Centro Z do círculo.
 * @param {number} radius Raio.
 * @param {BoxCollider} box Caixa.
 * @returns {{x: number, z: number, hit: boolean}} Nova posição e se houve contato.
 */
export function pushCircleOutOfBox(px, pz, radius, box) {
    /** @type {{lx: number, lz: number}} */
    const local = toLocal(px, pz, box);
    /** @type {number} */
    let lx = local.lx;
    /** @type {number} */
    let lz = local.lz;
    /** @type {number} */
    const qx = Math.max(-box.hx, Math.min(box.hx, lx));
    /** @type {number} */
    const qz = Math.max(-box.hz, Math.min(box.hz, lz));
    /** @type {number} */
    const dx = lx - qx;
    /** @type {number} */
    const dz = lz - qz;
    /** @type {number} */
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= radius * radius) {
        return { x: px, z: pz, hit: false };
    }
    if (distanceSquared > 1e-12) {
        /** @type {number} */
        const distance = Math.sqrt(distanceSquared);
        /** @type {number} */
        const push = radius - distance;
        lx += (dx / distance) * push;
        lz += (dz / distance) * push;
    } else {
        // Centro dentro da caixa: sai pela face mais próxima
        /** @type {number} */
        const penetrationX = box.hx - Math.abs(lx);
        /** @type {number} */
        const penetrationZ = box.hz - Math.abs(lz);
        if (penetrationX < penetrationZ) {
            lx = (lx >= 0 ? 1 : -1) * (box.hx + radius);
        } else {
            lz = (lz >= 0 ? 1 : -1) * (box.hz + radius);
        }
    }
    /** @type {{x: number, z: number}} */
    const world = toWorld(lx, lz, box);
    return { x: world.x, z: world.z, hit: true };
}

export class CollisionWorld {
    // #region Construtores :: constructor()

    constructor() {
        /** @type {BoxCollider[]} */
        this.colliders = [];
        /** @type {Bounds|null} */
        this.bounds = null;
    }

    // #endregion

    // #region Configuração :: setColliders(), setBounds()

    /**
     * @param {BoxCollider[]} colliders Lista de obstáculos.
     */
    setColliders(colliders) {
        this.colliders = colliders;
    }

    /**
     * Define um limite de segurança (área interna do ambiente) que o personagem nunca ultrapassa.
     * @param {Bounds|null} bounds Limites.
     */
    setBounds(bounds) {
        this.bounds = bounds;
    }

    // #endregion

    // #region Consultas :: resolve(), getGroundHeight(), blocksBody()

    /**
     * Resolve a posição horizontal do corpo contra todos os obstáculos.
     * @param {{x: number, z: number}} position Posição dos pés (alterada no lugar).
     * @param {number} radius Raio do corpo.
     * @param {number} feetY Altura dos pés.
     * @param {number} height Altura do corpo.
     * @param {number} stepHeight Obstáculos com topo abaixo de pés + degrau não bloqueiam.
     * @returns {boolean} Verdadeiro se houve alguma colisão.
     */
    resolve(position, radius, feetY, height, stepHeight) {
        /** @type {boolean} */
        let collided = false;
        // Algumas iterações resolvem cantos onde duas caixas empurram em direções diferentes
        for (let iteration = 0; iteration < 3; iteration += 1) {
            /** @type {boolean} */
            let moved = false;
            for (const box of this.colliders) {
                if (!this.blocksBody(box, feetY, height, stepHeight)) {
                    continue;
                }
                /** @type {{x: number, z: number, hit: boolean}} */
                const result = pushCircleOutOfBox(position.x, position.z, radius, box);
                if (result.hit) {
                    position.x = result.x;
                    position.z = result.z;
                    moved = true;
                    collided = true;
                }
            }
            if (!moved) {
                break;
            }
        }
        if (this.bounds !== null) {
            /** @type {Bounds} */
            const b = this.bounds;
            if (b.maxX - b.minX > 2 * radius) {
                position.x = Math.min(b.maxX - radius, Math.max(b.minX + radius, position.x));
            }
            if (b.maxZ - b.minZ > 2 * radius) {
                position.z = Math.min(b.maxZ - radius, Math.max(b.minZ + radius, position.z));
            }
        }
        return collided;
    }

    /**
     * Calcula a altura do chão sob o corpo: o piso (0) ou o topo de um obstáculo baixo o suficiente para pisar.
     * @param {number} x Centro X.
     * @param {number} z Centro Z.
     * @param {number} radius Raio.
     * @param {number} feetY Altura atual dos pés.
     * @param {number} stepHeight Degrau máximo.
     * @returns {number} Altura do chão.
     */
    getGroundHeight(x, z, radius, feetY, stepHeight) {
        /** @type {number} */
        let ground = 0;
        for (const box of this.colliders) {
            if (box.yMax <= feetY + stepHeight + 1e-6 && box.yMax > ground && circleOverlapsBox(x, z, radius * 0.7, box)) {
                ground = box.yMax;
            }
        }
        return ground;
    }

    /**
     * @param {BoxCollider} box Obstáculo.
     * @param {number} feetY Altura dos pés.
     * @param {number} height Altura do corpo.
     * @param {number} stepHeight Degrau máximo.
     * @returns {boolean} Verdadeiro se o obstáculo ocupa a faixa de altura do corpo.
     */
    blocksBody(box, feetY, height, stepHeight) {
        return box.yMax > feetY + stepHeight && box.yMin < feetY + height;
    }

    // #endregion
}
