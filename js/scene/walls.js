/**
 * Paredes com aberturas. Em vez de operações booleanas (CSG), a parede é dividida em blocos
 * ao redor de cada porta/janela: mais simples, estável e cada bloco vira um colisor de caixa.
 */
import * as THREE from 'three';

import { degToRad } from '../core/units.js';
import { MaterialLibrary } from './materials.js';

/**
 * @typedef {import('../core/state.js').Wall} Wall
 * @typedef {import('../core/state.js').Door} Door
 * @typedef {import('../core/state.js').WindowOpening} WindowOpening
 */

/**
 * @typedef {Object} WallBuildResult
 * @property {THREE.Group} group Raiz da parede (posicionada e girada).
 * @property {Map<string, THREE.Object3D>} openingRoots Raízes das aberturas, por chave "tipo:id".
 */

/** Largura dos alizares (molduras) ao redor das aberturas. */
const TRIM_WIDTH = 0.05;

export class WallBuilder {
    // #region Construtores :: constructor()

    /**
     * @param {MaterialLibrary} materials Biblioteca de materiais.
     */
    constructor(materials) {
        /** @type {MaterialLibrary} */
        this.materials = materials;
    }

    // #endregion

    // #region Construção :: build(), buildSegments(), buildDoor(), buildWindow()

    /**
     * @param {Wall} wall Parede.
     * @param {Array<{type: 'door'|'window', data: Door|WindowOpening}>} openings Aberturas da parede.
     * @returns {WallBuildResult} Malhas criadas.
     */
    build(wall, openings) {
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        group.name = `wall:${wall.id}`;
        group.position.set(wall.x, wall.y, wall.z);
        group.rotation.y = degToRad(wall.rotation);
        group.userData.entityKey = `wall:${wall.id}`;

        this.buildSegments(group, wall, openings);

        /** @type {Map<string, THREE.Object3D>} */
        const openingRoots = new Map();
        for (const opening of openings) {
            /** @type {THREE.Group} */
            const root = opening.type === 'door'
                ? this.buildDoor(wall, /** @type {Door} */ (opening.data))
                : this.buildWindow(wall, /** @type {WindowOpening} */ (opening.data));
            group.add(root);
            openingRoots.set(`${opening.type}:${opening.data.id}`, root);
        }
        return { group, openingRoots };
    }

    /**
     * Cria os blocos sólidos da parede: trechos inteiros entre aberturas, peitoris e vergas.
     * @param {THREE.Group} group Raiz da parede.
     * @param {Wall} wall Parede.
     * @param {Array<{type: 'door'|'window', data: Door|WindowOpening}>} openings Aberturas.
     */
    buildSegments(group, wall, openings) {
        /** @type {THREE.MeshStandardMaterial} */
        const material = this.materials.get(wall.perimeter ? 'perimeterWall' : 'wall');
        /** @type {number} */
        const half = wall.length / 2;
        /** @type {Array<{start: number, end: number, bottom: number, top: number}>} */
        const spans = openings
            .map((opening) => {
                /** @type {number} */
                const bottom = opening.type === 'door' ? 0 : /** @type {WindowOpening} */ (opening.data).sillHeight;
                return {
                    start: -half + opening.data.offset - opening.data.width / 2,
                    end: -half + opening.data.offset + opening.data.width / 2,
                    bottom,
                    top: bottom + opening.data.height
                };
            })
            .sort((a, b) => a.start - b.start);

        /**
         * @param {number} x0 Início no X local.
         * @param {number} x1 Fim no X local.
         * @param {number} y0 Base.
         * @param {number} y1 Topo.
         */
        const addBlock = (x0, x1, y0, y1) => {
            // Blocos degenerados aparecem quando aberturas se tocam ou chegam ao topo da parede
            if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) {
                return;
            }
            /** @type {THREE.Mesh} */
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, wall.thickness), material);
            mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.selectable = { type: 'wall', id: wall.id };
            mesh.userData.collider = true;
            group.add(mesh);
        };

        /** @type {number} */
        let cursor = -half;
        for (const span of spans) {
            addBlock(cursor, Math.max(cursor, span.start), 0, wall.height);
            addBlock(span.start, span.end, 0, Math.min(span.bottom, wall.height));
            addBlock(span.start, span.end, Math.max(span.top, 0), wall.height);
            cursor = Math.max(cursor, span.end);
        }
        addBlock(cursor, half, 0, wall.height);
    }

    /**
     * Porta: alizares, folha articulada na dobradiça e maçanetas.
     * @param {Wall} wall Parede hospedeira.
     * @param {Door} door Porta.
     * @returns {THREE.Group} Raiz da porta (filha da parede).
     */
    buildDoor(wall, door) {
        /** @type {THREE.Group} */
        const root = new THREE.Group();
        root.name = `door:${door.id}`;
        root.position.set(door.offset - wall.length / 2, 0, 0);
        root.userData.entityKey = `door:${door.id}`;
        this.addTrim(root, door.width, 0, door.height, wall.thickness, wall.height, false);

        /** @type {number} */
        const hingeSide = door.hinge === 'left' ? -1 : 1;
        /** @type {THREE.Group} */
        const pivot = new THREE.Group();
        pivot.position.set(hingeSide * door.width / 2, 0, 0);
        // Ângulo de abertura: a folha gira 90° para o lado escolhido da parede (+Z ou -Z local)
        pivot.rotation.y = door.isOpen ? hingeSide * door.swing * (Math.PI / 2) : 0;
        root.add(pivot);

        /** @type {number} */
        const leafWidth = Math.max(0.05, door.width - 0.01);
        /** @type {number} */
        const leafHeight = Math.max(0.05, door.height - 0.01);
        /** @type {THREE.Mesh} */
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, leafHeight, door.thickness), this.materials.get('door'));
        leaf.position.set(-hingeSide * door.width / 2, leafHeight / 2, 0);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        leaf.userData.selectable = { type: 'door', id: door.id };
        leaf.userData.interactive = { type: 'door', id: door.id };
        leaf.userData.collider = true;
        pivot.add(leaf);

        /** @type {number} */
        const handleY = Math.min(1.0, leafHeight * 0.48);
        for (const side of [1, -1]) {
            /** @type {THREE.Mesh} */
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.03), this.materials.get('metal'));
            handle.position.set(-hingeSide * (door.width - 0.12), handleY, side * (door.thickness / 2 + 0.025));
            pivot.add(handle);
        }
        return root;
    }

    /**
     * Janela: caixilho, vidro e uma caixa invisível usada para seleção e colisão.
     * @param {Wall} wall Parede hospedeira.
     * @param {WindowOpening} item Janela.
     * @returns {THREE.Group} Raiz da janela (filha da parede).
     */
    buildWindow(wall, item) {
        /** @type {THREE.Group} */
        const root = new THREE.Group();
        root.name = `window:${item.id}`;
        root.position.set(item.offset - wall.length / 2, item.sillHeight, 0);
        root.userData.entityKey = `window:${item.id}`;

        /** @type {THREE.MeshStandardMaterial} */
        const frameMaterial = this.materials.get('trim');
        /** @type {number} */
        const frame = 0.05;
        /** @type {number} */
        const depth = Math.min(0.07, wall.thickness);
        /** @type {Array<[number, number, number, number]>} */
        const bars = [
            [item.width, frame, 0, frame / 2],
            [item.width, frame, 0, item.height - frame / 2],
            [frame, item.height, -item.width / 2 + frame / 2, item.height / 2],
            [frame, item.height, item.width / 2 - frame / 2, item.height / 2]
        ];
        if (item.width > 0.8) {
            bars.push([frame * 0.8, item.height, 0, item.height / 2]);
        }
        for (const [w, h, x, y] of bars) {
            /** @type {THREE.Mesh} */
            const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), frameMaterial);
            bar.position.set(x, y, 0);
            bar.castShadow = true;
            root.add(bar);
        }

        /** @type {THREE.Mesh} */
        const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, item.width - 2 * frame), Math.max(0.01, item.height - 2 * frame), 0.01), this.materials.glass());
        glass.position.set(0, item.height / 2, 0);
        glass.renderOrder = 10;
        root.add(glass);

        // A caixa invisível facilita o clique e impede atravessar janelas que chegam ao piso
        /** @type {THREE.Mesh} */
        const hitbox = new THREE.Mesh(new THREE.BoxGeometry(item.width, item.height, wall.thickness), this.materials.get('trim'));
        hitbox.visible = false;
        hitbox.position.set(0, item.height / 2, 0);
        hitbox.userData.selectable = { type: 'window', id: item.id };
        hitbox.userData.collider = true;
        root.add(hitbox);

        if (item.sillHeight > 0.02) {
            this.addSillLedge(root, item.width, wall.thickness);
        }
        return root;
    }

    // #endregion

    // #region Detalhes :: addTrim(), addSillLedge()

    /**
     * Adiciona alizares nas duas faces da parede ao redor de uma abertura.
     * @param {THREE.Group} root Raiz da abertura.
     * @param {number} width Largura da abertura.
     * @param {number} bottom Base relativa à raiz.
     * @param {number} height Altura da abertura.
     * @param {number} thickness Espessura da parede.
     * @param {number} wallHeight Altura da parede (o alizar superior não pode ultrapassá-la).
     * @param {boolean} includeBottom Desenhar também a moldura inferior.
     */
    addTrim(root, width, bottom, height, thickness, wallHeight, includeBottom) {
        /** @type {THREE.MeshStandardMaterial} */
        const material = this.materials.get('trim');
        /** @type {number} */
        const depth = thickness + 0.02;
        /** @type {number} */
        const topWidth = Math.min(TRIM_WIDTH, Math.max(0, wallHeight - bottom - height));
        /** @type {Array<[number, number, number, number]>} */
        const pieces = [
            [TRIM_WIDTH, height + topWidth, -width / 2 - TRIM_WIDTH / 2, bottom + (height + topWidth) / 2],
            [TRIM_WIDTH, height + topWidth, width / 2 + TRIM_WIDTH / 2, bottom + (height + topWidth) / 2]
        ];
        if (topWidth > 0.005) {
            pieces.push([width + 2 * TRIM_WIDTH, topWidth, 0, bottom + height + topWidth / 2]);
        }
        if (includeBottom) {
            pieces.push([width + 2 * TRIM_WIDTH, TRIM_WIDTH, 0, bottom - TRIM_WIDTH / 2]);
        }
        for (const [w, h, x, y] of pieces) {
            /** @type {THREE.Mesh} */
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), material);
            mesh.position.set(x, y, 0);
            root.add(mesh);
        }
    }

    /**
     * Pequeno parapeito sob a janela, para diferenciá-la visualmente de um simples recorte.
     * @param {THREE.Group} root Raiz da janela.
     * @param {number} width Largura da janela.
     * @param {number} thickness Espessura da parede.
     */
    addSillLedge(root, width, thickness) {
        /** @type {THREE.Mesh} */
        const ledge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.03, thickness + 0.06), this.materials.get('stone'));
        ledge.position.set(0, -0.015, 0);
        ledge.castShadow = true;
        root.add(ledge);
    }

    // #endregion
}
