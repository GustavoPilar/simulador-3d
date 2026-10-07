/**
 * Sobreposições temporárias do modo construção: folgas do objeto selecionado até os obstáculos.
 */
import * as THREE from 'three';

import { boxCorners } from '../core/geometry.js';
import { formatMeters } from '../core/units.js';
import { createTextSprite } from './labels.js';
import { disposeObject } from './materials.js';

/** Folgas menores que isso são tratadas como "encostado" e não são desenhadas. */
const TOUCH_TOLERANCE = 0.005;

export class ClearanceOverlay {
    // #region Construtores :: constructor()

    /**
     * @param {THREE.Scene} scene Cena.
     */
    constructor(scene) {
        /** @type {THREE.Group} */
        this.group = new THREE.Group();
        this.group.name = 'clearances';
        scene.add(this.group);
    }

    // #endregion

    // #region Desenho :: show(), clear(), setVisible()

    /**
     * Desenha uma linha com a medida para cada lado com folga finita.
     * @param {Record<string, import('../core/geometry.js').Clearance|null>} clearances Folgas por lado.
     * @param {number} height Altura das linhas (m).
     */
    show(clearances, height) {
        this.clear();
        for (const clearance of Object.values(clearances)) {
            if (clearance === null || clearance.distance < TOUCH_TOLERANCE) {
                continue;
            }
            /** @type {THREE.Vector3} */
            const from = new THREE.Vector3(clearance.from.x, height, clearance.from.z);
            /** @type {THREE.Vector3} */
            const to = new THREE.Vector3(clearance.to.x, height, clearance.to.z);
            /** @type {THREE.LineBasicMaterial} */
            const material = new THREE.LineBasicMaterial({ color: '#ff7a00', depthTest: false, transparent: true });
            material.userData.owned = true;
            /** @type {THREE.Line} */
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material);
            line.renderOrder = 1002;
            this.group.add(line);
            /** @type {THREE.Sprite} */
            const label = createTextSprite(formatMeters(clearance.distance), { scale: 0.85, background: '#ffd9b3' });
            label.position.copy(from).add(to).multiplyScalar(0.5);
            this.group.add(label);
        }
    }

    /**
     * Remove todas as linhas.
     */
    clear() {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            disposeObject(child);
        }
    }

    /**
     * @param {boolean} visible Visibilidade.
     */
    setVisible(visible) {
        this.group.visible = visible;
    }

    // #endregion
}

export class LayoutOverlay {
    // #region Construtores :: constructor()

    /**
     * @param {THREE.Scene} scene Cena.
     */
    constructor(scene) {
        /** @type {THREE.Group} */
        this.group = new THREE.Group();
        this.group.name = 'layout-overlay';
        scene.add(this.group);
    }

    // #endregion

    // #region Desenho :: show(), clear(), outline()

    /**
     * Desenha áreas de uso (verde = atendida, vermelho = não atendida) e contornos dos objetos em conflito.
     * @param {{zones: Array<{box: import('../core/geometry.js').OrientedBox, ok: boolean}>, conflicts: import('../core/geometry.js').OrientedBox[]}} data Dados.
     */
    show(data) {
        this.clear();
        for (const zone of data.zones) {
            /** @type {THREE.MeshBasicMaterial} */
            const material = new THREE.MeshBasicMaterial({ color: zone.ok ? '#2f9e6b' : '#d64545', transparent: true, opacity: 0.22, depthWrite: false });
            material.userData.owned = true;
            /** @type {THREE.Mesh} */
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * zone.box.hx, 2 * zone.box.hz), material);
            plane.rotation.x = -Math.PI / 2;
            /** @type {THREE.Group} */
            const holder = new THREE.Group();
            holder.position.set(zone.box.cx, 0.007, zone.box.cz);
            holder.rotation.y = Math.atan2(zone.box.sin, zone.box.cos);
            holder.add(plane);
            this.group.add(holder);
            this.group.add(this.outline(zone.box, 0.008, zone.ok ? '#2f9e6b' : '#d64545', false));
        }
        for (const box of data.conflicts) {
            this.group.add(this.outline(box, 0.02, '#e03131', true));
            this.group.add(this.outline(box, box.yMax ?? 0.02, '#e03131', true));
        }
    }

    /**
     * Remove os desenhos.
     */
    clear() {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            disposeObject(child);
        }
    }

    /**
     * @param {import('../core/geometry.js').OrientedBox} box Caixa.
     * @param {number} y Altura.
     * @param {string} color Cor.
     * @param {boolean} onTop Desenhar por cima de tudo.
     * @returns {THREE.LineLoop} Contorno.
     */
    outline(box, y, color, onTop) {
        /** @type {THREE.LineBasicMaterial} */
        const material = new THREE.LineBasicMaterial({ color, depthTest: !onTop, transparent: true });
        material.userData.owned = true;
        /** @type {THREE.LineLoop} */
        const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(boxCorners(box).map((point) => new THREE.Vector3(point.x, y, point.z))), material);
        loop.renderOrder = onTop ? 1003 : 2;
        return loop;
    }

    // #endregion
}
