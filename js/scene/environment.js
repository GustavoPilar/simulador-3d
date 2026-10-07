/**
 * Geometria base do ambiente: piso, terreno externo, teto, grade em metros e cotas.
 * As paredes externas são entidades comuns do estado e são construídas pelo WallBuilder.
 */
import * as THREE from 'three';

import { formatMeters } from '../core/units.js';
import { createDimensionLine } from './labels.js';
import { MaterialLibrary } from './materials.js';

/**
 * @typedef {Object} EnvironmentMeshes
 * @property {THREE.Group} group Piso, terreno, teto e grade.
 * @property {THREE.Mesh} ceiling Teto (visibilidade controlada pelo modo).
 * @property {THREE.Group} annotations Cotas do modo construção.
 */

export class EnvironmentBuilder {
    // #region Construtores :: constructor()

    /**
     * @param {MaterialLibrary} materials Biblioteca de materiais.
     */
    constructor(materials) {
        /** @type {MaterialLibrary} */
        this.materials = materials;
    }

    // #endregion

    // #region Construção :: build(), buildGrid(), buildAnnotations()

    /**
     * @param {{width: number, length: number, height: number, wallThickness: number}} env Dimensões internas.
     * @param {number} gridStep Espaçamento da grade fina em metros.
     * @returns {EnvironmentMeshes} Malhas criadas.
     */
    build(env, gridStep) {
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        group.name = 'environment';

        /** @type {THREE.Mesh} */
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(env.width, env.length), this.materials.get('floor'));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(env.width / 2, 0, env.length / 2);
        floor.receiveShadow = true;
        floor.userData.floor = true;
        group.add(floor);

        /** @type {number} */
        const groundSize = Math.max(env.width, env.length) * 4 + 40;
        /** @type {THREE.Mesh} */
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), this.materials.get('ground'));
        ground.rotation.x = -Math.PI / 2;
        // Levemente abaixo do piso para evitar conflito de profundidade
        ground.position.set(env.width / 2, -0.01, env.length / 2);
        ground.receiveShadow = true;
        ground.userData.floor = true;
        group.add(ground);

        /** @type {THREE.Mesh} */
        const ceiling = new THREE.Mesh(
            new THREE.PlaneGeometry(env.width + 2 * env.wallThickness, env.length + 2 * env.wallThickness),
            this.materials.get('ceiling')
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(env.width / 2, env.height, env.length / 2);
        // O teto não projeta sombra para que a luz principal continue iluminando o interior
        ceiling.castShadow = false;
        ceiling.visible = false;
        group.add(ceiling);

        group.add(this.buildGrid(env, gridStep));

        return { group, ceiling, annotations: this.buildAnnotations(env) };
    }

    /**
     * Cria a grade: linhas de 1 m sempre visíveis e, se escolhido, uma grade mais fina.
     * @param {{width: number, length: number}} env Dimensões internas.
     * @param {number} step Espaçamento fino.
     * @returns {THREE.Group} Grade.
     */
    buildGrid(env, step) {
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        group.name = 'grid';
        // Tamanho par e centro inteiro garantem que as linhas caiam exatamente em múltiplos do passo a partir da origem
        /** @type {number} */
        const size = 2 * Math.ceil(Math.max(env.width, env.length)) + 4;
        /** @type {number} */
        const centerX = Math.round(env.width / 2);
        /** @type {number} */
        const centerZ = Math.round(env.length / 2);

        /** @type {THREE.GridHelper} */
        const major = new THREE.GridHelper(size, size, '#5d6b75', '#5d6b75');
        major.material.transparent = true;
        major.material.opacity = 0.45;
        major.position.set(centerX, 0.003, centerZ);
        group.add(major);

        if (step < 1) {
            /** @type {THREE.GridHelper} */
            const minor = new THREE.GridHelper(size, Math.round(size / step), '#7f8b93', '#7f8b93');
            minor.material.transparent = true;
            minor.material.opacity = 0.18;
            minor.position.set(centerX, 0.002, centerZ);
            group.add(minor);
        }
        return group;
    }

    /**
     * Cotas de largura, comprimento e pé-direito.
     * @param {{width: number, length: number, height: number, wallThickness: number}} env Dimensões internas.
     * @returns {THREE.Group} Cotas.
     */
    buildAnnotations(env) {
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        group.name = 'annotations';
        /** @type {THREE.LineBasicMaterial} */
        const material = this.materials.line('#1b232b', 0.9, true);
        /** @type {number} */
        const gap = env.wallThickness + 0.45;

        group.add(createDimensionLine(
            new THREE.Vector3(0, 0.02, -gap),
            new THREE.Vector3(env.width, 0.02, -gap),
            new THREE.Vector3(0, 0, 1),
            formatMeters(env.width),
            material
        ));
        group.add(createDimensionLine(
            new THREE.Vector3(-gap, 0.02, 0),
            new THREE.Vector3(-gap, 0.02, env.length),
            new THREE.Vector3(1, 0, 0),
            formatMeters(env.length),
            material
        ));
        group.add(createDimensionLine(
            new THREE.Vector3(-gap, 0, -gap),
            new THREE.Vector3(-gap, env.height, -gap),
            new THREE.Vector3(1, 0, 0),
            formatMeters(env.height),
            material
        ));
        return group;
    }

    // #endregion
}
