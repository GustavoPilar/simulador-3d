/**
 * Representação visual de objetos e do personagem.
 * Cada objeto é composto por peças simples que cabem exatamente na caixa largura × altura × profundidade
 * informada; uma caixa invisível com essas dimensões é usada para seleção e colisão.
 */
import * as THREE from 'three';

import { NON_COLLIDING_KINDS, STATEFUL_KINDS } from '../core/config.js';
import { degToRad, formatMeters } from '../core/units.js';
import { createTextSprite } from './labels.js';
import { MaterialLibrary } from './materials.js';

/**
 * @typedef {import('../core/state.js').SceneObject} SceneObject
 */

export class FurnitureFactory {
    // #region Construtores :: constructor()

    /**
     * @param {MaterialLibrary} materials Biblioteca de materiais.
     */
    constructor(materials) {
        /** @type {MaterialLibrary} */
        this.materials = materials;
        /** @type {Record<string, (group: THREE.Group, o: SceneObject) => void>} */
        this.builders = {
            bed: (group, o) => this.buildBed(group, o),
            sofa: (group, o) => this.buildSofa(group, o),
            table: (group, o) => this.buildTable(group, o),
            chair: (group, o) => this.buildChair(group, o),
            wardrobe: (group, o) => this.buildWardrobe(group, o),
            tv: (group, o) => this.buildTv(group, o),
            fridge: (group, o) => this.buildFridge(group, o),
            stove: (group, o) => this.buildStove(group, o),
            sink: (group, o) => this.buildSink(group, o),
            toilet: (group, o) => this.buildToilet(group, o),
            shower: (group, o) => this.buildShower(group, o),
            column: (group, o) => this.buildBlock(group, o),
            soffit: (group, o) => this.buildBlock(group, o),
            light: (group, o) => this.buildMarker(group, o, true),
            outlet: (group, o) => this.buildMarker(group, o, false),
            switch: (group, o) => this.buildMarker(group, o, false),
            water: (group, o) => this.buildMarker(group, o, false)
        };
    }

    // #endregion

    // #region Construção :: build(), buildMannequin()

    /**
     * @param {SceneObject} object Objeto do estado.
     * @returns {THREE.Group} Raiz posicionada (origem na base, centro do objeto).
     */
    build(object) {
        /** @type {THREE.Group} */
        const root = new THREE.Group();
        root.name = `object:${object.id}`;
        root.position.set(object.x, object.y, object.z);
        root.rotation.y = degToRad(object.rotation);
        root.userData.entityKey = `object:${object.id}`;

        /** @type {((group: THREE.Group, o: SceneObject) => void)|undefined} */
        const builder = this.builders[object.kind];
        if (builder !== undefined) {
            builder(root, object);
        } else {
            this.buildBlock(root, object);
        }

        // Sofá retrátil aberto ocupa mais piso: a caixa de colisão acompanha a parte que avança
        /** @type {number} */
        const depth = object.kind === 'sofa' && object.isOpen === true && (object.openDepth ?? 0) > object.depth ? /** @type {number} */ (object.openDepth) : object.depth;
        /** @type {THREE.Mesh} */
        const hitbox = new THREE.Mesh(new THREE.BoxGeometry(object.width, object.height, depth), this.materials.get('trim'));
        hitbox.visible = false;
        hitbox.position.set(0, object.height / 2, (depth - object.depth) / 2);
        hitbox.userData.selectable = { type: 'object', id: object.id };
        if (STATEFUL_KINDS.has(object.kind)) {
            hitbox.userData.interactive = { type: 'object', id: object.id };
        }
        // Pontos de instalação são apenas marcadores: não bloqueiam o personagem
        hitbox.userData.collider = !NON_COLLIDING_KINDS.has(object.kind);
        root.add(hitbox);
        return root;
    }

    /**
     * Boneco com as dimensões do personagem, usado como referência humana de escala no modo construção.
     * @param {{height: number, width: number, depth: number, spawnX: number, spawnZ: number, spawnRotation: number}} player Personagem.
     * @param {boolean} showLabel Exibir a altura acima da cabeça.
     * @returns {THREE.Group} Raiz do boneco.
     */
    buildMannequin(player, showLabel) {
        /** @type {THREE.Group} */
        const root = new THREE.Group();
        root.name = 'player';
        root.position.set(player.spawnX, 0, player.spawnZ);
        root.rotation.y = degToRad(player.spawnRotation);
        root.userData.entityKey = 'player:player';

        /** @type {number} */
        const h = player.height;
        /** @type {number} */
        const w = player.width;
        /** @type {number} */
        const d = player.depth;
        /** @type {number} */
        const legHeight = h * 0.47;
        /** @type {number} */
        const torsoHeight = h * 0.37;
        /** @type {number} */
        const headRadius = h * 0.065;

        for (const side of [-1, 1]) {
            this.part(root, w * 0.26, legHeight, d * 0.6, side * w * 0.17, 0, 0, this.materials.get('pants'));
            this.part(root, w * 0.13, h * 0.34, d * 0.45, side * (w / 2 - w * 0.065), legHeight + torsoHeight - h * 0.34, 0, this.materials.get('shirt'));
        }
        this.part(root, w * 0.72, torsoHeight, d, 0, legHeight, 0, this.materials.get('shirt'));
        this.part(root, h * 0.05, h * 0.03, h * 0.05, 0, legHeight + torsoHeight, 0, this.materials.get('skin'));

        /** @type {THREE.Mesh} */
        const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 20, 14), this.materials.get('skin'));
        head.position.set(0, h - headRadius, 0);
        head.castShadow = true;
        root.add(head);
        // Nariz indica para onde o personagem olha ao entrar no modo explorar
        this.part(root, 0.03, 0.03, 0.05, 0, h - headRadius - 0.015, headRadius - 0.01, this.materials.get('skin'));

        /** @type {THREE.Mesh} */
        const footprint = new THREE.Mesh(
            new THREE.CircleGeometry(Math.max(w, d) / 2, 32),
            new THREE.MeshBasicMaterial({ color: '#e2a83a', transparent: true, opacity: 0.35, depthWrite: false })
        );
        /** @type {THREE.Material} */
        const footprintMaterial = /** @type {THREE.Material} */ (footprint.material);
        footprintMaterial.userData.owned = true;
        footprint.rotation.x = -Math.PI / 2;
        footprint.position.y = 0.006;
        root.add(footprint);

        /** @type {THREE.Mesh} */
        const hitbox = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.materials.get('trim'));
        hitbox.visible = false;
        hitbox.position.y = h / 2;
        hitbox.userData.selectable = { type: 'player', id: 'player' };
        root.add(hitbox);

        if (showLabel) {
            /** @type {THREE.Sprite} */
            const label = createTextSprite(`Você, ${formatMeters(h)}`);
            label.position.set(0, h + 0.2, 0);
            root.add(label);
        }
        return root;
    }

    // #endregion

    // #region Móveis :: buildBed(), buildSofa(), buildTable(), buildChair(), buildWardrobe(), buildTv(), buildFridge(), buildStove(), buildSink(), buildToilet(), buildShower(), buildBlock()

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildBed(g, o) {
        /** @type {number} */
        const baseHeight = o.height * 0.45;
        this.part(g, o.width, baseHeight, o.depth, 0, 0, 0, this.materials.color(o.color));
        this.part(g, o.width - 0.04, o.height - baseHeight, o.depth - 0.06, 0, baseHeight, 0.01, this.materials.get('fabric'));
        /** @type {number} */
        const pillowCount = o.width > 1.1 ? 2 : 1;
        /** @type {number} */
        const pillowWidth = (o.width - 0.1) / pillowCount - 0.06;
        /** @type {number} */
        const pillowHeight = Math.min(0.06, o.height * 0.15);
        for (let index = 0; index < pillowCount; index += 1) {
            /** @type {number} */
            const x = -o.width / 2 + 0.05 + (index + 0.5) * ((o.width - 0.1) / pillowCount);
            this.part(g, pillowWidth, pillowHeight, Math.min(0.32, o.depth * 0.2), x, o.height - pillowHeight, -o.depth / 2 + Math.min(0.22, o.depth * 0.15), this.materials.shade('#e4dfd5', 0.05));
        }
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildSofa(g, o) {
        /** @type {THREE.MeshStandardMaterial} */
        const main = this.materials.color(o.color);
        /** @type {number} */
        const seatHeight = o.height * 0.5;
        /** @type {number} */
        const backDepth = Math.min(0.22, o.depth * 0.3);
        /** @type {number} */
        const armWidth = Math.min(0.18, o.width * 0.12);
        this.part(g, o.width, seatHeight * 0.6, o.depth, 0, 0, 0, main);
        this.part(g, o.width - 2 * armWidth, seatHeight * 0.4, o.depth - backDepth, 0, seatHeight * 0.6, backDepth / 2, this.materials.shade(o.color, 0.08));
        this.part(g, o.width, o.height, backDepth, 0, 0, -o.depth / 2 + backDepth / 2, main);
        for (const side of [-1, 1]) {
            this.part(g, armWidth, o.height * 0.68, o.depth, side * (o.width / 2 - armWidth / 2), 0, 0, main);
        }
        if (o.isOpen === true && (o.openDepth ?? 0) > o.depth) {
            // Parte retrátil puxada para a frente, na altura do assento
            /** @type {number} */
            const extension = /** @type {number} */ (o.openDepth) - o.depth;
            this.part(g, o.width - 2 * armWidth, seatHeight * 0.9, extension, 0, 0, o.depth / 2 + extension / 2, this.materials.shade(o.color, 0.08));
        }
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildTable(g, o) {
        /** @type {number} */
        const top = Math.min(0.04, o.height * 0.1);
        /** @type {number} */
        const leg = Math.min(0.06, o.width * 0.1, o.depth * 0.1);
        this.part(g, o.width, top, o.depth, 0, o.height - top, 0, this.materials.color(o.color));
        this.addLegs(g, o.width, o.depth, o.height - top, leg, this.materials.shade(o.color, -0.12));
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildChair(g, o) {
        /** @type {THREE.MeshStandardMaterial} */
        const main = this.materials.color(o.color);
        /** @type {number} */
        const seatHeight = Math.min(0.46, o.height * 0.52);
        /** @type {number} */
        const leg = Math.min(0.035, o.width * 0.1);
        this.part(g, o.width, 0.04, o.depth, 0, seatHeight - 0.04, 0, main);
        this.addLegs(g, o.width, o.depth, seatHeight - 0.04, leg, this.materials.shade(o.color, -0.1));
        this.part(g, o.width, o.height - seatHeight, 0.04, 0, seatHeight, -o.depth / 2 + 0.02, main);
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildWardrobe(g, o) {
        this.part(g, o.width, o.height, o.depth, 0, 0, 0, this.materials.color(o.color));
        if (o.isOpen === true) {
            /** @type {number} */
            const count = Math.max(1, Math.round(o.width / 0.5));
            /** @type {number} */
            const doorWidth = o.width / count;
            for (let index = 0; index < count; index += 1) {
                // Portas pares abrem pela esquerda e ímpares pela direita, como em armários de duas folhas
                /** @type {number} */
                const hingeX = index % 2 === 0 ? -o.width / 2 + index * doorWidth : -o.width / 2 + (index + 1) * doorWidth;
                this.addOpenLeaf(g, o, hingeX, doorWidth, this.materials.shade(o.color, -0.04));
            }
            return;
        }
        /** @type {number} */
        const doors = Math.max(1, Math.round(o.width / 0.5));
        /** @type {number} */
        const doorWidth = o.width / doors;
        for (let index = 0; index < doors; index += 1) {
            /** @type {number} */
            const left = -o.width / 2 + index * doorWidth;
            if (index > 0) {
                this.part(g, 0.006, o.height - 0.04, 0.004, left, 0.02, o.depth / 2 + 0.002, this.materials.get('dark'));
            }
            /** @type {number} */
            const handleX = index % 2 === 0 ? left + doorWidth - 0.05 : left + 0.05;
            this.part(g, 0.02, Math.min(0.25, o.height * 0.15), 0.02, handleX, o.height * 0.45, o.depth / 2 + 0.01, this.materials.get('metal'));
        }
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildTv(g, o) {
        /** @type {THREE.MeshStandardMaterial} */
        const dark = this.materials.color(o.color);
        /** @type {number} */
        const panelDepth = Math.min(0.06, o.depth);
        /** @type {number} */
        const standHeight = o.height * 0.12;
        this.part(g, o.width * 0.35, 0.02, o.depth, 0, 0, 0, dark);
        this.part(g, 0.06, standHeight, 0.04, 0, 0.02, 0, dark);
        this.part(g, o.width, o.height - standHeight - 0.02, panelDepth, 0, standHeight + 0.02, 0, dark);
        this.part(g, o.width - 0.03, o.height - standHeight - 0.05, 0.002, 0, standHeight + 0.035, panelDepth / 2 + 0.001, this.materials.get('screen'));
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildFridge(g, o) {
        this.part(g, o.width, o.height, o.depth, 0, 0, 0, this.materials.color(o.color));
        if (o.isOpen === true) {
            this.addOpenLeaf(g, o, -o.width / 2, o.width, this.materials.shade(o.color, -0.05));
            return;
        }
        this.part(g, o.width, 0.008, 0.004, 0, o.height * 0.68, o.depth / 2 + 0.002, this.materials.get('dark'));
        this.part(g, 0.025, Math.min(0.3, o.height * 0.15), 0.03, o.width / 2 - 0.06, o.height * 0.75, o.depth / 2 + 0.015, this.materials.get('metal'));
        this.part(g, 0.025, Math.min(0.45, o.height * 0.22), 0.03, o.width / 2 - 0.06, o.height * 0.38, o.depth / 2 + 0.015, this.materials.get('metal'));
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildStove(g, o) {
        /** @type {number} */
        const topHeight = Math.min(0.03, o.height * 0.05);
        this.part(g, o.width, o.height - topHeight, o.depth, 0, 0, 0, this.materials.color(o.color));
        this.part(g, o.width, topHeight, o.depth, 0, o.height - topHeight, 0, this.materials.get('dark'));
        this.part(g, o.width * 0.7, o.height * 0.35, 0.005, 0, o.height * 0.25, o.depth / 2 + 0.003, this.materials.get('dark'));
        /** @type {number} */
        const radius = Math.min(o.width, o.depth) * 0.1;
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                /** @type {THREE.Mesh} */
                const burner = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.01, 20), this.materials.get('metal'));
                burner.position.set(sx * o.width * 0.24, o.height - 0.002, sz * o.depth * 0.24);
                g.add(burner);
            }
        }
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildSink(g, o) {
        /** @type {number} */
        const counter = Math.min(0.04, o.height * 0.1);
        this.part(g, o.width, o.height - counter, o.depth - 0.03, 0, 0, -0.015, this.materials.color(o.color));
        this.part(g, o.width, counter, o.depth, 0, o.height - counter, 0, this.materials.get('stone'));
        this.part(g, Math.min(0.5, o.width * 0.5), 0.004, o.depth * 0.6, 0, o.height, 0.02, this.materials.get('metal'));
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildToilet(g, o) {
        /** @type {THREE.MeshStandardMaterial} */
        const main = this.materials.color(o.color);
        /** @type {number} */
        const seat = o.height * 0.52;
        /** @type {number} */
        const tankDepth = o.depth * 0.28;
        this.part(g, o.width * 0.6, seat * 0.85, o.depth * 0.55, 0, 0, o.depth * 0.05, main);
        this.part(g, o.width, seat * 0.15, o.depth - tankDepth, 0, seat * 0.85, tankDepth / 2, main);
        this.part(g, o.width, o.height - seat * 0.85, tankDepth, 0, seat * 0.85, -o.depth / 2 + tankDepth / 2, main);
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildShower(g, o) {
        /** @type {number} */
        const tray = 0.05;
        this.part(g, o.width, tray, o.depth, 0, 0, 0, this.materials.get('fabric'));
        this.part(g, o.width, o.height - tray, 0.01, 0, tray, o.depth / 2 - 0.005, this.materials.glass());
        this.part(g, 0.01, o.height - tray, o.depth, o.width / 2 - 0.005, tray, 0, this.materials.glass());
        this.part(g, 0.02, 0.35, 0.02, 0, o.height - 0.45, -o.depth / 2 + 0.03, this.materials.get('metal'));
        this.part(g, 0.2, 0.02, 0.2, 0, o.height - 0.45, -o.depth / 2 + 0.13, this.materials.get('metal'));
    }

    /** @param {THREE.Group} g @param {SceneObject} o */
    buildBlock(g, o) {
        /** @type {THREE.Mesh} */
        const block = this.part(g, o.width, o.height, o.depth, 0, 0, 0, this.materials.color(o.color));
        // Arestas escuras ajudam a perceber o volume de blocos lisos
        /** @type {THREE.LineSegments} */
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(block.geometry), this.materials.line('#3a2f24', 0.6));
        edges.position.copy(block.position);
        g.add(edges);
    }

    /**
     * Marcador de instalação (tomada, interruptor, ponto de luz ou de água).
     * @param {THREE.Group} g Raiz.
     * @param {SceneObject} o Objeto.
     * @param {boolean} glowing Emite luz própria (ponto de luz).
     */
    buildMarker(g, o, glowing) {
        /** @type {THREE.MeshStandardMaterial} */
        const material = glowing
            ? new THREE.MeshStandardMaterial({ color: o.color, emissive: o.color, emissiveIntensity: 0.8 })
            : this.materials.color(o.color);
        if (glowing) {
            material.userData.owned = true;
        }
        this.part(g, o.width, o.height, o.depth, 0, 0, 0, material);
        if (o.kind === 'outlet' || o.kind === 'switch') {
            // Detalhe frontal para diferenciar tomada de interruptor à distância
            /** @type {number} */
            const size = Math.min(o.width, o.height) * (o.kind === 'outlet' ? 0.5 : 0.35);
            this.part(g, size, o.kind === 'outlet' ? size : size * 1.6, 0.004, 0, o.height / 2 - (o.kind === 'outlet' ? size : size * 1.6) / 2, o.depth / 2 + 0.002, this.materials.get('dark'));
        }
    }

    // #endregion

    // #region Auxiliares :: addOpenLeaf(), part(), addLegs()

    /**
     * Folha de porta de móvel aberta a 90°, saindo da frente. Bloqueia a passagem no modo explorar.
     * @param {THREE.Group} g Raiz.
     * @param {SceneObject} o Objeto.
     * @param {number} hingeX Posição X da dobradiça.
     * @param {number} width Largura da folha.
     * @param {THREE.Material} material Material.
     */
    addOpenLeaf(g, o, hingeX, width, material) {
        /** @type {THREE.Mesh} */
        const leaf = this.part(g, 0.025, o.height - 0.04, width, hingeX, 0.02, o.depth / 2 + width / 2, material);
        leaf.userData.collider = true;
        leaf.userData.selectable = { type: 'object', id: o.id };
    }

    /**
     * Adiciona uma peça retangular apoiada em `y` (base), centralizada em x/z.
     * @param {THREE.Object3D} parent Pai.
     * @param {number} w Largura.
     * @param {number} h Altura.
     * @param {number} d Profundidade.
     * @param {number} x Centro X.
     * @param {number} y Base.
     * @param {number} z Centro Z.
     * @param {THREE.Material} material Material.
     * @returns {THREE.Mesh} Peça.
     */
    part(parent, w, h, d, x, y, z, material) {
        /** @type {THREE.Mesh} */
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.002, w), Math.max(0.002, h), Math.max(0.002, d)), material);
        mesh.position.set(x, y + Math.max(0.002, h) / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }

    /**
     * @param {THREE.Group} g Pai.
     * @param {number} width Largura total.
     * @param {number} depth Profundidade total.
     * @param {number} height Altura das pernas.
     * @param {number} size Seção da perna.
     * @param {THREE.Material} material Material.
     */
    addLegs(g, width, depth, height, size, material) {
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                this.part(g, size, height, size, sx * (width / 2 - size / 2), 0, sz * (depth / 2 - size / 2), material);
            }
        }
    }

    // #endregion
}
