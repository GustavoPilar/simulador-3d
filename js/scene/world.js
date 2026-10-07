/**
 * Converte o estado do projeto em objetos 3D. A cena inteira é reconstruída a cada alteração:
 * com dezenas de elementos isso leva poucos milissegundos e elimina erros de sincronização parcial.
 */
import * as THREE from 'three';

import { createBoxCollider } from '../core/collision.js';
import { rotateLocal } from '../core/geometry.js';
import { ProjectState } from '../core/state.js';
import { degToRad, formatArea, formatMeters } from '../core/units.js';
import { EnvironmentBuilder } from './environment.js';
import { createTextSprite } from './labels.js';
import { disposeObject, MaterialLibrary } from './materials.js';
import { FurnitureFactory } from './objects.js';
import { SceneManager } from './scene.js';
import { WallBuilder } from './walls.js';

/**
 * @typedef {import('../core/collision.js').BoxCollider} BoxCollider
 */

export class WorldBuilder {
    // #region Construtores :: constructor()

    /**
     * @param {SceneManager} sceneManager Gerenciador da cena.
     */
    constructor(sceneManager) {
        /** @type {SceneManager} */
        this.sceneManager = sceneManager;
        /** @type {MaterialLibrary} */
        this.materials = new MaterialLibrary();
        /** @type {EnvironmentBuilder} */
        this.environmentBuilder = new EnvironmentBuilder(this.materials);
        /** @type {WallBuilder} */
        this.wallBuilder = new WallBuilder(this.materials);
        /** @type {FurnitureFactory} */
        this.furnitureFactory = new FurnitureFactory(this.materials);

        /** @type {THREE.Group} Elementos físicos (aparecem nos dois modos e geram colisão). */
        this.content = new THREE.Group();
        this.content.name = 'content';
        /** @type {THREE.Group} Auxiliares do modo construção (cotas, cômodos, boneco). */
        this.helpers = new THREE.Group();
        this.helpers.name = 'helpers';
        sceneManager.scene.add(this.content, this.helpers);

        /** @type {Map<string, THREE.Object3D>} */
        this.entityRoots = new Map();
        /** @type {THREE.Mesh[]} */
        this.selectables = [];
        /** @type {THREE.Mesh[]} */
        this.interactives = [];
        /** @type {THREE.Mesh[]} */
        this.floors = [];
        /** @type {THREE.Mesh|null} */
        this.ceiling = null;
        /** @type {'build'|'explore'} */
        this.mode = 'build';
        /** @type {boolean} */
        this.ceilingEnabled = true;
        /** @type {{key: string, texture: THREE.Texture}|null} Textura da planta, reaproveitada entre reconstruções. */
        this.underlayTexture = null;
        /** @type {import('../core/collision.js').BoxCollider[]} */
        this.colliders = [];
        /** @type {THREE.Object3D[]} Raízes com aparência própria no modo construção (oculto/translúcido). */
        this.styledRoots = [];
        /** @type {number|null} Altura do corte horizontal no modo construção. */
        this.sectionHeight = null;
        /** @type {Map<string, {opacity: number, hidden: boolean}>} Aparência por elemento (para as tampas do corte). */
        this.styleById = new Map();
        /** @type {Map<string, string>} Cor de cada objeto (tampas do corte). */
        this.objectColors = new Map();
        /** @type {THREE.Group} Tampas do corte: preenchem paredes e móveis cortados, como o hachurado de uma planta. */
        this.sectionCaps = new THREE.Group();
        this.sectionCaps.name = 'section-caps';
        sceneManager.scene.add(this.sectionCaps);
    }

    // #endregion

    // #region Reconstrução :: rebuild(), clear(), buildRoom(), collectMeshes()

    /**
     * Reconstrói toda a cena a partir do estado.
     * @param {ProjectState} state Projeto.
     */
    rebuild(state) {
        this.clear();
        /** @type {boolean} */
        const showLabels = state.settings.showLabels;

        /** @type {import('./environment.js').EnvironmentMeshes} */
        const env = this.environmentBuilder.build(state.environment, state.settings.gridStep);
        this.content.add(env.group);
        this.ceiling = env.ceiling;
        if (showLabels) {
            this.helpers.add(env.annotations);
        }

        for (const wall of state.walls) {
            /** @type {import('./walls.js').WallBuildResult} */
            const result = this.wallBuilder.build(wall, state.getOpenings(wall.id));
            this.content.add(result.group);
            this.entityRoots.set(`wall:${wall.id}`, result.group);
            this.registerStyle(result.group, wall);
            for (const [key, root] of result.openingRoots) {
                this.entityRoots.set(key, root);
            }
            if (showLabels && !wall.perimeter) {
                this.helpers.add(this.buildWallLabel(wall));
            }
        }

        this.objectColors = new Map(state.objects.map((item) => [item.id, item.color]));
        for (const object of state.objects) {
            /** @type {THREE.Group} */
            const root = this.furnitureFactory.build(object);
            this.content.add(root);
            this.entityRoots.set(`object:${object.id}`, root);
            this.registerStyle(root, object);
        }

        for (const room of state.rooms) {
            /** @type {THREE.Group} */
            const root = this.buildRoom(room, showLabels);
            this.helpers.add(root);
            this.entityRoots.set(`room:${room.id}`, root);
        }

        for (const door of state.doors) {
            /** @type {any} */
            const wall = state.getEntity('wall', door.wallId);
            if (wall !== null) {
                this.helpers.add(this.buildDoorSwing(wall, door));
            }
        }

        if (state.underlay !== null && state.underlay.visible) {
            this.helpers.add(this.buildUnderlay(state.underlay));
        }

        /** @type {THREE.Group} */
        const mannequin = this.furnitureFactory.buildMannequin(state.player, showLabels);
        this.helpers.add(mannequin);
        this.entityRoots.set('player:player', mannequin);

        this.collectMeshes();
        this.colliders = this.extractColliders();
        this.sceneManager.fitLights(state.environment);
        this.ceilingEnabled = state.settings.showCeiling;
        this.sectionHeight = state.settings.sectionCut ? state.settings.sectionHeight : null;
        this.setMode(this.mode);
    }

    /**
     * Remove e descarta os objetos da reconstrução anterior.
     */
    clear() {
        for (const group of [this.content, this.helpers]) {
            for (const child of [...group.children]) {
                group.remove(child);
                disposeObject(child);
            }
        }
        this.entityRoots.clear();
        this.styledRoots = [];
        this.styleById = new Map();
        this.selectables = [];
        this.interactives = [];
        this.floors = [];
        this.ceiling = null;
    }

    /**
     * Cômodo: área colorida no piso com nome e área em m².
     * @param {import('../core/state.js').Room} room Cômodo.
     * @param {boolean} showLabel Exibir nome e área.
     * @returns {THREE.Group} Raiz do cômodo.
     */
    buildRoom(room, showLabel) {
        /** @type {THREE.Group} */
        const root = new THREE.Group();
        root.name = `room:${room.id}`;
        root.position.set(room.x, 0, room.z);
        root.userData.entityKey = `room:${room.id}`;

        /** @type {THREE.MeshBasicMaterial} */
        const material = new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.38, depthWrite: false });
        material.userData.owned = true;
        /** @type {THREE.Mesh} */
        const area = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.length), material);
        area.rotation.x = -Math.PI / 2;
        area.position.y = 0.004;
        area.userData.selectable = { type: 'room', id: room.id };
        root.add(area);

        /** @type {THREE.LineSegments} */
        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(room.width, room.length)),
            this.materials.line(room.color, 1)
        );
        outline.rotation.x = -Math.PI / 2;
        outline.position.y = 0.006;
        root.add(outline);

        if (showLabel) {
            /** @type {THREE.Sprite} */
            const label = createTextSprite(`${room.name}  ${formatArea(room.width * room.length)}`, { background: '#fbfaf7', scale: 0.9 });
            label.position.set(0, 0.35, 0);
            root.add(label);
        }
        return root;
    }

    /**
     * Rótulo com o comprimento da parede, acima do seu centro.
     * @param {import('../core/state.js').Wall} wall Parede.
     * @returns {THREE.Sprite} Rótulo.
     */
    buildWallLabel(wall) {
        /** @type {THREE.Sprite} */
        const label = createTextSprite(formatMeters(wall.length));
        label.position.set(wall.x, wall.y + wall.height + 0.2, wall.z);
        return label;
    }

    /**
     * Arco de abertura da porta desenhado no piso, como nas plantas.
     * @param {import('../core/state.js').Wall} wall Parede hospedeira.
     * @param {import('../core/state.js').Door} door Porta.
     * @returns {THREE.Line} Arco e folha aberta.
     */
    buildDoorSwing(wall, door) {
        /** @type {number} */
        const yaw = degToRad(wall.rotation);
        /** @type {number} */
        const hingeSide = door.hinge === 'left' ? -1 : 1;
        /** @type {number} */
        const hingeU = door.offset - wall.length / 2 + hingeSide * door.width / 2;
        /** @type {number} */
        const openAngle = hingeSide * door.swing * (Math.PI / 2);
        /** @type {THREE.Vector3[]} */
        const points = [];
        /**
         * @param {number} lx X local da parede.
         * @param {number} lz Z local da parede.
         * @returns {THREE.Vector3} Ponto no mundo, rente ao piso.
         */
        const toWorld = (lx, lz) => {
            /** @type {{x: number, z: number}} */
            const delta = rotateLocal(lx, lz, yaw);
            return new THREE.Vector3(wall.x + delta.x, 0.012, wall.z + delta.z);
        };
        // Folha aberta (da dobradiça até a ponta) seguida do arco até a posição fechada
        points.push(toWorld(hingeU, 0));
        for (let step = 0; step <= 24; step += 1) {
            /** @type {number} */
            const angle = openAngle * (1 - step / 24);
            /** @type {number} */
            const lx = -hingeSide * door.width * Math.cos(angle);
            /** @type {number} */
            const lz = hingeSide * door.width * Math.sin(angle);
            points.push(toWorld(hingeU + lx, lz));
        }
        /** @type {THREE.Line} */
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.materials.line('#59666e', 0.75));
        line.name = `door-swing:${door.id}`;
        return line;
    }

    /**
     * Imagem da planta deitada no piso, na escala calibrada.
     * @param {import('../core/state.js').Underlay} underlay Planta de fundo.
     * @returns {THREE.Group} Grupo posicionado.
     */
    buildUnderlay(underlay) {
        if (this.underlayTexture === null || this.underlayTexture.key !== underlay.dataUrl) {
            this.underlayTexture?.texture.dispose();
            /** @type {THREE.Texture} */
            const texture = new THREE.TextureLoader().load(underlay.dataUrl);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            this.underlayTexture = { key: underlay.dataUrl, texture };
        }
        /** @type {number} */
        const height = (underlay.width * underlay.pixelHeight) / underlay.pixelWidth;
        /** @type {THREE.MeshBasicMaterial} */
        const material = new THREE.MeshBasicMaterial({
            map: this.underlayTexture.texture,
            transparent: true,
            opacity: underlay.opacity / 100,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -2
        });
        material.userData.owned = true;
        material.userData.keepMap = true;
        /** @type {THREE.Mesh} */
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(underlay.width, height), material);
        // Deitada no piso: o topo da imagem aponta para -Z, que é o "para cima" da vista Planta
        plane.rotation.x = -Math.PI / 2;
        plane.renderOrder = 1;
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        group.name = 'underlay';
        group.position.set(underlay.x, 0.0015, underlay.z);
        group.rotation.y = degToRad(underlay.rotation);
        group.scale.set(underlay.flipX ? -1 : 1, 1, underlay.flipZ ? -1 : 1);
        group.add(plane);
        return group;
    }

    /**
     * Atualiza as listas de malhas selecionáveis, interativas e de piso.
     */
    collectMeshes() {
        for (const group of [this.content, this.helpers]) {
            group.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) {
                    return;
                }
                if (child.userData.selectable !== undefined) {
                    this.selectables.push(child);
                }
                if (child.userData.interactive !== undefined) {
                    this.interactives.push(child);
                }
                if (child.userData.floor === true) {
                    this.floors.push(child);
                }
            });
        }
    }

    // #endregion

    // #region Consultas :: getRoot(), setMode(), extractColliders()

    /**
     * @param {string} type Tipo da entidade.
     * @param {string} id Identificador.
     * @returns {THREE.Object3D|null} Raiz 3D da entidade.
     */
    getRoot(type, id) {
        return this.entityRoots.get(`${type}:${id}`) ?? null;
    }

    /**
     * Ajusta a visibilidade de auxiliares e teto conforme o modo.
     * @param {'build'|'explore'} mode Modo.
     */
    setMode(mode) {
        this.mode = mode;
        this.helpers.visible = mode === 'build';
        if (this.ceiling !== null) {
            this.ceiling.visible = mode === 'explore' && this.ceilingEnabled;
        }
        /** @type {boolean} */
        const building = mode === 'build';
        this.materials.setClipping(building && this.sectionHeight !== null ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), this.sectionHeight)] : []);
        this.applyBuildStyles(building);
        this.buildSectionCaps(building ? this.sectionHeight : null);
    }

    /**
     * Desenha as tampas do corte horizontal: sem elas, paredes cortadas ficariam ocas vistas de cima.
     * @param {number|null} height Altura do corte (null remove as tampas).
     */
    buildSectionCaps(height) {
        for (const child of [...this.sectionCaps.children]) {
            this.sectionCaps.remove(child);
            disposeObject(child);
        }
        if (height === null) {
            return;
        }
        for (const box of this.colliders) {
            if (box.yMin >= height || box.yMax <= height || box.ref === null || box.ref === undefined) {
                continue;
            }
            /** @type {{opacity: number, hidden: boolean}} */
            const style = this.styleById.get(box.ref.id) ?? { opacity: 100, hidden: false };
            if (style.hidden) {
                continue;
            }
            /** @type {string} */
            const color = box.ref.type === 'object' ? (this.objectColors.get(box.ref.id) ?? '#8d969c') : box.ref.type === 'window' ? '#9fc3d6' : '#2b3238';
            /** @type {THREE.MeshBasicMaterial} */
            const material = new THREE.MeshBasicMaterial({ color, transparent: style.opacity < 100, opacity: style.opacity / 100, toneMapped: false });
            material.userData.owned = true;
            /** @type {THREE.Mesh} */
            const cap = new THREE.Mesh(new THREE.PlaneGeometry(2 * box.hx, 2 * box.hz), material);
            cap.rotation.x = -Math.PI / 2;
            /** @type {THREE.Group} */
            const holder = new THREE.Group();
            holder.position.set(box.cx, height - 0.002, box.cz);
            holder.rotation.y = Math.atan2(box.sin, box.cos);
            holder.add(cap);
            this.sectionCaps.add(holder);
        }
    }

    /**
     * Guarda a aparência de construção de uma raiz (só quando difere do normal).
     * @param {THREE.Object3D} root Raiz da entidade.
     * @param {{opacity?: number, hidden?: boolean}} entity Entidade.
     */
    registerStyle(root, entity) {
        /** @type {number} */
        const opacity = entity.opacity ?? 100;
        if (opacity >= 100 && entity.hidden !== true) {
            return;
        }
        root.userData.style = { opacity, hidden: entity.hidden === true };
        this.styledRoots.push(root);
        if (typeof (/** @type {any} */ (entity)).id === 'string') {
            this.styleById.set(/** @type {any} */ (entity).id, root.userData.style);
        }
    }

    /**
     * Aplica ou desfaz ocultação e translucidez. No modo explorar tudo aparece como é de verdade.
     * @param {boolean} active Verdadeiro no modo construção.
     */
    applyBuildStyles(active) {
        for (const root of this.styledRoots) {
            /** @type {{opacity: number, hidden: boolean}} */
            const style = root.userData.style;
            root.visible = !(active && style.hidden);
            root.traverse((child) => {
                /** @type {any} */
                const node = child;
                if (node.material === undefined || Array.isArray(node.material)) {
                    return;
                }
                if (node.userData.baseMaterial === undefined) {
                    node.userData.baseMaterial = node.material;
                }
                node.material = active && style.opacity < 100
                    ? this.materials.transparent(node.userData.baseMaterial, style.opacity / 100)
                    : node.userData.baseMaterial;
            });
        }
    }

    /**
     * Gera colisores de caixa a partir das malhas marcadas com userData.collider.
     * Todos os elementos giram apenas em Y, então a rotação mundial se reduz a um ângulo (yaw).
     * @returns {BoxCollider[]} Colisores.
     */
    extractColliders() {
        this.content.updateMatrixWorld(true);
        /** @type {BoxCollider[]} */
        const colliders = [];
        /** @type {THREE.Vector3} */
        const position = new THREE.Vector3();
        /** @type {THREE.Quaternion} */
        const quaternion = new THREE.Quaternion();
        /** @type {THREE.Euler} */
        const euler = new THREE.Euler();
        this.content.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || child.userData.collider !== true) {
                return;
            }
            /** @type {{width: number, height: number, depth: number}} */
            const size = /** @type {THREE.BoxGeometry} */ (child.geometry).parameters;
            child.getWorldPosition(position);
            child.getWorldQuaternion(quaternion);
            euler.setFromQuaternion(quaternion, 'YXZ');
            colliders.push(createBoxCollider(position.x, position.z, size.width / 2, size.depth / 2, euler.y, position.y - size.height / 2, position.y + size.height / 2, child.userData.selectable ?? null));
        });
        return colliders;
    }

    // #endregion
}
