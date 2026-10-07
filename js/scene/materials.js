/**
 * Materiais compartilhados entre reconstruções da cena.
 * Reaproveitá-los evita recompilar shaders e permite descartar apenas as geometrias a cada reconstrução.
 */
import * as THREE from 'three';

/** Cores fixas da cena. */
const PALETTE = Object.freeze({
    wall: '#ece8df',
    perimeterWall: '#e3ddd1',
    floor: '#cdb796',
    ground: '#b9c0b4',
    ceiling: '#f4f2ed',
    trim: '#fbfaf7',
    door: '#a77b52',
    metal: '#9aa3ab',
    dark: '#30353a',
    screen: '#0d1520',
    fabric: '#e4dfd5',
    stone: '#b9b6ae',
    pants: '#3c4a5e',
    shirt: '#e2a83a',
    skin: '#d7ad89'
});

export class MaterialLibrary {
    // #region Construtores :: constructor()

    constructor() {
        /** @type {Map<string, THREE.Material>} */
        this.cache = new Map();
        /** @type {THREE.Plane[]} Planos de corte aplicados aos materiais da cena (corte horizontal). */
        this.clippingPlanes = [];
    }

    // #endregion

    // #region Materiais :: get(), color(), shade(), glass(), line()

    /**
     * Material padrão nomeado da paleta.
     * @param {keyof typeof PALETTE} name Nome da cor.
     * @returns {THREE.MeshStandardMaterial} Material.
     */
    get(name) {
        return this.color(PALETTE[name]);
    }

    /**
     * Material fosco de uma cor arbitrária (cacheado por cor).
     * @param {string} hex Cor no formato #rrggbb.
     * @returns {THREE.MeshStandardMaterial} Material.
     */
    color(hex) {
        /** @type {string} */
        const key = `solid:${hex}`;
        if (!this.cache.has(key)) {
            this.cache.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.0, clippingPlanes: this.clippingPlanes }));
        }
        return /** @type {THREE.MeshStandardMaterial} */ (this.cache.get(key));
    }

    /**
     * Variação mais clara ou mais escura de uma cor.
     * @param {string} hex Cor base.
     * @param {number} lightness Deslocamento de luminosidade (-1 a 1).
     * @returns {THREE.MeshStandardMaterial} Material.
     */
    shade(hex, lightness) {
        /** @type {THREE.Color} */
        const color = new THREE.Color(hex);
        color.offsetHSL(0, 0, lightness);
        return this.color(`#${color.getHexString()}`);
    }

    /**
     * Material de vidro translúcido.
     * @returns {THREE.MeshStandardMaterial} Material.
     */
    glass() {
        if (!this.cache.has('glass')) {
            this.cache.set('glass', new THREE.MeshStandardMaterial({
                color: '#a9d3e6',
                transparent: true,
                opacity: 0.28,
                roughness: 0.05,
                metalness: 0.1,
                depthWrite: false,
                clippingPlanes: this.clippingPlanes
            }));
        }
        return /** @type {THREE.MeshStandardMaterial} */ (this.cache.get('glass'));
    }

    /**
     * Material de linha.
     * @param {string} hex Cor.
     * @param {number} [opacity=1] Opacidade.
     * @param {boolean} [onTop=false] Desenhar por cima da geometria (cotas).
     * @returns {THREE.LineBasicMaterial} Material.
     */
    line(hex, opacity = 1, onTop = false) {
        /** @type {string} */
        const key = `line:${hex}:${opacity}:${onTop}`;
        if (!this.cache.has(key)) {
            /** @type {THREE.LineBasicMaterial} */
            const material = new THREE.LineBasicMaterial({
                color: hex,
                transparent: opacity < 1 || onTop,
                opacity,
                depthTest: !onTop,
                clippingPlanes: onTop ? [] : this.clippingPlanes
            });
            // Cotas desenhadas por cima nunca são cortadas
            material.userData.noClip = onTop;
            this.cache.set(key, material);
        }
        return /** @type {THREE.LineBasicMaterial} */ (this.cache.get(key));
    }

    /**
     * Variante translúcida de um material (aparência "mais opaca/transparente" no modo construção).
     * @param {THREE.Material} material Material original.
     * @param {number} opacity Opacidade de 0 a 1.
     * @returns {THREE.Material} Variante cacheada.
     */
    transparent(material, opacity) {
        if (material.userData.owned === true) {
            return material;
        }
        /** @type {string} */
        const key = `transparent:${material.uuid}:${opacity}`;
        if (!this.cache.has(key)) {
            /** @type {THREE.Material} */
            const variant = material.clone();
            variant.transparent = true;
            variant.opacity = material.opacity * opacity;
            variant.depthWrite = false;
            variant.clippingPlanes = this.clippingPlanes;
            variant.userData = { ...material.userData };
            this.cache.set(key, variant);
        }
        return /** @type {THREE.Material} */ (this.cache.get(key));
    }

    /**
     * Aplica (ou remove) planos de corte em todos os materiais da biblioteca.
     * @param {THREE.Plane[]} planes Planos; lista vazia desliga o corte.
     */
    setClipping(planes) {
        /** @type {boolean} */
        const changed = planes.length !== this.clippingPlanes.length;
        this.clippingPlanes = planes;
        for (const material of this.cache.values()) {
            if (material.userData.noClip === true) {
                continue;
            }
            material.clippingPlanes = planes;
            if (changed) {
                // Ligar ou desligar o corte troca o programa do shader
                material.needsUpdate = true;
            }
        }
    }

    // #endregion
}

/**
 * Libera recursos de GPU de uma subárvore. Materiais compartilhados são preservados;
 * apenas materiais marcados com userData.owned (rótulos, por exemplo) são descartados.
 * @param {THREE.Object3D} root Raiz a descartar.
 */
export function disposeObject(root) {
    root.traverse((child) => {
        /** @type {any} */
        const node = child;
        if (node.geometry !== undefined) {
            node.geometry.dispose();
        }
        if (node.material !== undefined && node.material.userData?.owned === true) {
            // Texturas cacheadas (planta de fundo) sobrevivem às reconstruções
            if (node.material.userData.keepMap !== true) {
                node.material.map?.dispose();
            }
            node.material.dispose();
        }
    });
}
